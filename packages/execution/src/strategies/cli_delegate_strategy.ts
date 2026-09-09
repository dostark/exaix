/**
 * @module CliDelegateStrategy
 * @path packages/execution/src/strategies/cli_delegate_strategy.ts
 * @description Per-step execution strategy that runs the agent step through a
 * headless CLI tool (claude/opencode) instead of a direct IModelProvider call.
 * Selected via IAgentFileBlueprint.capabilities including
 * ExecutionStrategyName.CLI_DELEGATE — an alternative to ReActLoopStrategy, not a
 * fallback for it. When the configured binary cannot be spawned, this strategy
 * throws (AgentExecutionErrorType.CONFIGURATION_ERROR); it never silently falls
 * back to the API path — reverting to direct API execution is a deliberate
 * capabilities/config edit, not a runtime decision.
 *
 * Multi-turn mechanism: both tools use a cold subprocess spawn per plan step,
 * resuming the prior turn's conversation via a captured session id —
 * `claude -p <objective> --resume <session_id>` and `opencode run --session
 * <session_id>`, respectively. This is Claude Code's officially documented
 * multi-turn pattern (CLI reference: `--resume <session_id_or_name>`); an
 * earlier design kept one claude process alive across a whole plan via
 * `--input-format stream-json` stdin streaming, which worked in a live trial
 * but is not a documented/supported protocol, so it was replaced with the
 * supported `--resume` flow to match opencode's existing shape.
 *
 * Auth: ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are deliberately stripped
 * from the spawned CLI's environment (see buildDelegateEnv) so a Claude
 * Pro/Max subscription login (~/.claude/.credentials.json or
 * CLAUDE_CODE_OAUTH_TOKEN) is used instead of metered API billing — Claude
 * Code's documented auth precedence always prefers an API key over a
 * subscription login when both are present in the environment.
 *
 * Permissions: claude-code turns pass --permission-mode acceptEdits and
 * --allowedTools (via deriveClaudeToolFlags, shared with session_delegate's
 * hardened launch) so the CLI can write files without an interactive
 * approval prompt it can never answer headlessly.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/cli_delegate_stream_parser.ts, packages/session/src/delegate_return_parser.ts, packages/session/src/claude_permission_flags.ts]
 */

import { isAbsolute, join, relative } from "@std/path";
import type { IDogfoodContextConnection, IDogfoodContextPort, Opt, Reason } from "@exaix/core/types";
import { ContextConnectionCloseReason } from "@exaix/core/types";
import {
  buildClaudeMcpConfig,
  buildOpencodeMcpFragment,
  claudeMcpAllowedToolEntries,
  toMcpConnectionInput,
} from "@exaix/session/dogfood_mcp_config.ts";
import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type IAgentFileBlueprint } from "../agent_composer.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";
import { deriveClaudeToolFlags } from "@exaix/session/claude_permission_flags.ts";
import { buildAllowlistChildEnv } from "@exaix/core/helpers/child_env.ts";
import { SafeSubprocess, SubprocessError } from "@exaix/core";
import {
  AgentExecutionErrorType,
  CLI_DELEGATE_TURN_TIMEOUT_MS,
  ExecutionStrategyName,
  SESSION_FLAG_FORMAT,
  SESSION_FLAG_MODEL,
  SESSION_FLAG_OUTPUT_FORMAT,
  SESSION_FLAG_PRINT,
  SESSION_FLAG_RESUME,
  SESSION_FLAG_SESSION_ID,
  SESSION_FLAG_VERBOSE,
  SESSION_INPUT_FORMAT_STREAM_JSON,
  SESSION_OUTPUT_FORMAT_JSON,
  SESSION_SUBCMD_RUN,
} from "@exaix/core";
import { parseCliDelegateStreamTurn } from "./cli_delegate_stream_parser.ts";

/** The subset of a parsed CLI-delegate outcome execute() actually consumes — satisfied by both claude's ICliDelegateTurnResult and opencode's IDelegateParsedReturn. */
interface ICliDelegateParsedOutcome {
  lastText: string;
  tokenStats: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheCreation?: number;
    reasoning?: number;
  };
  costUsd: number | undefined;
  toolPaths: string[];
}

/** Result of running the headless CLI subprocess (subset of SafeSubprocess.run's shape). */
export interface ICliDelegateProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable subprocess runner seam — defaults to SafeSubprocess.run in production. Used for both tools' cold-spawn-per-step calls. */
export type IRunCliDelegateProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number; clearEnv?: boolean },
) => Promise<ICliDelegateProcessResult>;

/** Resolves a portal alias to its absolute checkout path. Backed by AgentComposer.getPortalConfig. */
export type IResolvePortalPath = (portalAlias: string) => string | undefined;

/** Dependencies for CliDelegateStrategy (constructor DI, config-free). */
export interface ICliDelegateStrategyDeps {
  /** Which headless CLI tool to invoke. */
  tool: SessionTool;
  /** Bare binary name or absolute path — never shell-interpolated. */
  bin: string;
  /** Resolves options.portal to the absolute checkout the CLI tool runs in. */
  resolvePortalPath: IResolvePortalPath;
  /** Optional model override (headless `--model <model>`). */
  model?: string;
  /** Defaults to SafeSubprocess.run. Overridden in tests to avoid real subprocess execution. */
  run?: IRunCliDelegateProcess;
  /** Optional dogfood bounded-context port. Absent for every non-dogfood/disabled-config
   *  caller, which preserves the existing objective byte-for-byte. A failure here aborts
   *  the launch — it never silently falls back to the unaugmented objective. */
  contextPort?: Opt<IDogfoodContextPort, Reason.OptionalDependency>;
}

const defaultRun: IRunCliDelegateProcess = (command, args, options) => SafeSubprocess.run(command, args, options);

/** Cap on how much of a failing CLI's raw stdout an error message quotes. */
const ERROR_STDOUT_PREVIEW_MAX_CHARS = 2000;

// deps.model may arrive "provider:model"-prefixed (ModelResolver convention); claude/opencode
// reject that on --model with a 404 (live-verified). Neither tool's own model names use a colon.
function stripProviderPrefix(model: string): string {
  const separatorIndex = model.indexOf(":");
  return separatorIndex === -1 ? model : model.slice(separatorIndex + 1);
}

/** Truncated, never-empty preview of a CLI's raw stdout for an error message — the daemon's
 *  own JSON error body (e.g. a 404 model-not-found response) lives here, not in stderr. */
function stdoutPreview(stdout: string): string {
  return stdout.trim().slice(0, ERROR_STDOUT_PREVIEW_MAX_CHARS) || "(empty)";
}

/** Env vars stripped from every CLI-delegate spawn so a Claude Pro/Max subscription login wins over metered API billing (see module doc's Auth section). */
const STRIPPED_AUTH_ENV_KEYS: readonly string[] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** The delegate's OWN subscription auth (Claude Code OAuth) — the one non-allowlisted
 *  ambient var it genuinely needs, distinct from Exaix's provider secrets. Re-added to the
 *  launch env explicitly (never via the ambient parent). */
const DELEGATE_OAUTH_ENV_KEY = "CLAUDE_CODE_OAUTH_TOKEN";

// Used by detectGitChanges(). Kept LOCAL (not imported from @exaix/git) so a strategy
// file does not reach into a low-level constants module; values mirror git_audit_service's.
const GIT_CMD_STATUS = "status";
const GIT_FLAG_PORCELAIN = "--porcelain";
const GIT_FLAG_UNTRACKED_FILES_ALL = "--untracked-files=all";
const GIT_STATUS_TIMEOUT_MS = 30_000;

/** Uses the SHARED allowlist child-env policy: ambient secrets and proxy vars are
 *  excluded, fail-closed. The dogfood context bearer value is injected after that
 *  filter runs, exactly like DELEGATE_OAUTH_ENV_KEY above it. */
function buildDelegateEnv(
  portalPath: string,
  connection?: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
  opencodeMcpConfigPath?: Opt<string, Reason.OptionalContext>,
): Record<string, string> {
  // Deno.Command's `cwd` changes the OS-level spawn directory but does NOT update the
  // inherited `PWD` env var — opencode resolves relative tool-call paths against
  // process.env.PWD, not the kernel cwd, so PWD must be kept in sync with it.
  const launchEnv: Record<string, string> = { PWD: portalPath };
  const oauth = Deno.env.get(DELEGATE_OAUTH_ENV_KEY);
  if (oauth !== undefined) {
    launchEnv[DELEGATE_OAUTH_ENV_KEY] = oauth;
  }
  const env = buildAllowlistChildEnv(launchEnv, Deno.env.toObject());
  for (const key of STRIPPED_AUTH_ENV_KEYS) delete env[key];
  if (connection) {
    env[connection.bearerEnvVar] = connection.bearerToken;
  }
  if (opencodeMcpConfigPath) {
    env.OPENCODE_CONFIG = opencodeMcpConfigPath;
  }
  return env;
}

/** opencode's tool_use events report an ABSOLUTE filePath, but GitAuditService's
 *  unauthorized-change check compares files_changed against portal-relative `git status`
 *  output — an unnormalized path never matches, so a real write reverts as a false-positive. */
function toPortalRelativePaths(paths: string[], portalPath: string): string[] {
  return paths.map((path) => isAbsolute(path) ? relative(portalPath, path) : path);
}

/** Drives a headless CLI tool (claude/opencode) instead of calling IModelProvider
 *  directly. Not the async, durable-wait gate delegation used by SessionDelegateService/
 *  HeadlessSessionLauncher — this runs synchronously, once per plan step. */
export class CliDelegateStrategy implements IExecutionStrategy {
  public readonly name = ExecutionStrategyName.CLI_DELEGATE;
  private readonly run: IRunCliDelegateProcess;
  /** Session id per plan (trace_id), captured from the first step's response and resumed on every later step. Shape is identical for both tools; only the flag name differs. */
  private readonly sessionIds = new Map<string, string>();
  /** Turn counter per plan (trace_id) for dogfood context records — a fresh capture per
   *  turn, independent of the resumed CLI session's own history. */
  private readonly turnCounts = new Map<string, number>();

  constructor(private readonly deps: ICliDelegateStrategyDeps) {
    this.run = deps.run ?? defaultRun;
  }

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    const startTime = Date.now();
    const portalPath = this.deps.resolvePortalPath(options.portal);
    if (!portalPath) {
      throw new AgentExecutionError(
        `CLI delegate strategy could not resolve portal path for '${options.portal}'`,
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }
    const isFirstTurn = !this.sessionIds.has(context.trace_id);
    const objective = this.buildObjective(blueprint, context, isFirstTurn);
    const { objective: finalObjective, recordId, connection } = await this.applyDogfoodContext(objective, context);
    const isClaude = this.deps.tool === SessionToolSchema.enum["claude-code"];

    let parsed: ICliDelegateParsedOutcome;
    try {
      parsed = isClaude
        ? await this.runClaudeStep(context.trace_id, finalObjective, portalPath, connection)
        : await this.runOpencodeStep(context.trace_id, finalObjective, portalPath, connection);
    } finally {
      await this.closeDogfoodContext(recordId);
    }

    const reportedPaths = toPortalRelativePaths(parsed.toolPaths, portalPath);
    // claude's print-mode stream emits no per-turn tool_use lines, so parsed.toolPaths is
    // always empty — fall back to actual `git status` changes so real writes still become
    // the step's authorized files_changed, instead of reverting as a false-positive.
    const filesChanged = reportedPaths.length > 0 ? reportedPaths : await this.detectGitChanges(portalPath);

    const executionTimeMs = Date.now() - startTime;

    return {
      branch: "",
      commit_sha: "0".repeat(40),
      files_changed: filesChanged,
      description: parsed.lastText || context.plan,
      tool_calls: parsed.toolPaths.length,
      execution_time_ms: executionTimeMs,
      usage: {
        prompt_tokens: parsed.tokenStats.input,
        completion_tokens: parsed.tokenStats.output,
        cost_usd: parsed.costUsd ?? 0,
        cache_read_tokens: parsed.tokenStats.cacheRead,
        cache_creation_tokens: parsed.tokenStats.cacheCreation,
        reasoning_tokens: parsed.tokenStats.reasoning,
        // parsed.costUsd here is always the real figure the CLI tool itself reported
        // (total_cost_usd / part.cost), never an Exaix estimate.
        cost_source: "tracked",
      },
    };
  }

  private async runClaudeStep(
    traceId: string,
    objective: string,
    portalPath: string,
    connection: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
  ): Promise<ICliDelegateParsedOutcome> {
    const sessionId = this.sessionIds.get(traceId);
    const mcpConfig = connection ? await this.writeClaudeMcpConfigFile(connection, portalPath) : undefined;
    try {
      const args = this.buildClaudeArgs(objective, sessionId, connection, mcpConfig?.configPath);

      let result: ICliDelegateProcessResult;
      try {
        result = await this.run(this.deps.bin, args, {
          cwd: portalPath,
          env: buildDelegateEnv(portalPath, connection),
          clearEnv: true,
          timeoutMs: CLI_DELEGATE_TURN_TIMEOUT_MS,
        });
      } catch (error) {
        throw new AgentExecutionError(
          `CLI delegate strategy could not run '${this.deps.bin}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          AgentExecutionErrorType.CONFIGURATION_ERROR,
          error instanceof SubprocessError ? error : undefined,
        );
      }

      if (result.code !== 0) {
        throw new AgentExecutionError(
          `CLI delegate '${this.deps.bin}' exited with code ${result.code}: stderr=${
            result.stderr.trim() || "(empty)"
          } stdout=${stdoutPreview(result.stdout)}`,
          AgentExecutionErrorType.CONFIGURATION_ERROR,
        );
      }

      const turn = parseCliDelegateStreamTurn(result.stdout.split("\n"));
      if (turn.sessionId && !sessionId) {
        this.sessionIds.set(traceId, turn.sessionId);
      }
      if (turn.isError) {
        throw new AgentExecutionError(
          `CLI delegate '${this.deps.bin}' turn returned an error: ${turn.lastText}`,
          AgentExecutionErrorType.CONFIGURATION_ERROR,
        );
      }
      return turn;
    } finally {
      await mcpConfig?.cleanup();
    }
  }

  private async runOpencodeStep(
    traceId: string,
    objective: string,
    portalPath: string,
    connection: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
  ): Promise<ICliDelegateParsedOutcome> {
    const sessionId = this.sessionIds.get(traceId);
    const mcpConfig = connection ? await this.writeOpencodeMcpConfigFile(connection, portalPath) : undefined;
    try {
      const args = this.buildOpencodeArgs(objective, sessionId);

      let result: ICliDelegateProcessResult;
      try {
        result = await this.run(this.deps.bin, args, {
          cwd: portalPath,
          env: buildDelegateEnv(portalPath, connection, mcpConfig?.configPath),
          clearEnv: true,
          timeoutMs: CLI_DELEGATE_TURN_TIMEOUT_MS,
        });
      } catch (error) {
        throw new AgentExecutionError(
          `CLI delegate strategy could not run '${this.deps.bin}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          AgentExecutionErrorType.CONFIGURATION_ERROR,
          error instanceof SubprocessError ? error : undefined,
        );
      }

      if (result.code !== 0) {
        throw new AgentExecutionError(
          `CLI delegate '${this.deps.bin}' exited with code ${result.code}: stderr=${
            result.stderr.trim() || "(empty)"
          } stdout=${stdoutPreview(result.stdout)}`,
          AgentExecutionErrorType.CONFIGURATION_ERROR,
        );
      }

      const capturedSessionId = extractOpencodeSessionId(result.stdout);
      if (capturedSessionId && !sessionId) {
        this.sessionIds.set(traceId, capturedSessionId);
      }

      return parseDelegateStdout(result.stdout, this.deps.tool);
    } finally {
      await mcpConfig?.cleanup();
    }
  }

  /** Fallback for when the CLI tool's stream reported no tool paths (claude); mirrors
   *  git_audit_service's own status read (same flags/timeout). */
  private async detectGitChanges(portalPath: string): Promise<string[]> {
    try {
      const result = await SafeSubprocess.run(
        "git",
        [GIT_CMD_STATUS, GIT_FLAG_PORCELAIN, GIT_FLAG_UNTRACKED_FILES_ALL],
        {
          cwd: portalPath,
          timeoutMs: GIT_STATUS_TIMEOUT_MS,
        },
      );
      if (result.code !== 0) return [];
      return result.stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => line.slice(3).trim());
    } catch {
      return [];
    }
  }

  /** First turn leads with the whole plan (context.full_plan) so the CLI session orients
   *  on the complete task before seeing an isolated step fragment. Later turns in the same
   *  resumed session already carry that orientation in conversation history. */
  private buildObjective(blueprint: IAgentFileBlueprint, context: IExecutionContext, isFirstTurn: boolean): string {
    const taskSection = isFirstTurn && context.full_plan
      ? `TASK: ${context.request}\n\nFULL PLAN:\n${context.full_plan}\n\nBEGIN WITH THE FIRST STEP BELOW.`
      : `TASK: ${context.request}`;
    return `${blueprint.systemPrompt}\n\n${taskSection}\n\nPLAN STEP: ${context.plan}`;
  }

  /** Absent contextPort (every non-dogfood/disabled-config caller) returns `objective`
   *  unchanged — byte-for-byte existing behavior. A prepare() failure aborts the launch;
   *  it never silently falls back to the unaugmented objective. */
  private async applyDogfoodContext(
    objective: string,
    context: IExecutionContext,
  ): Promise<{ objective: string; recordId?: string; connection?: IDogfoodContextConnection }> {
    if (!this.deps.contextPort) return { objective };

    const turn = this.turnCounts.get(context.trace_id) ?? 0;
    this.turnCounts.set(context.trace_id, turn + 1);

    try {
      const handle = await this.deps.contextPort.prepare({
        executionTraceId: context.trace_id,
        parentTraceId: context.trace_id,
        stepId: String(context.step_number ?? 0),
        sequence: context.step_number ?? 1,
        turn,
        attempt: 1,
        surface: "cli_delegate",
        model: this.deps.model ?? "",
        originalPrompt: objective,
        queryText: objective,
        acceptanceCriteria: [],
      });
      return { objective: handle.prompt, recordId: handle.recordId, connection: handle.connection };
    } catch (error) {
      throw new AgentExecutionError(
        `dogfood context assembly failed: ${error instanceof Error ? error.message : String(error)}`,
        AgentExecutionErrorType.CONFIGURATION_ERROR,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Closes the connection this turn opened (if any) — never throws, so a close failure
   *  cannot mask the turn's own real success/failure result. */
  private async closeDogfoodContext(recordId: Opt<string, Reason.OptionalContext>): Promise<void> {
    if (!recordId || !this.deps.contextPort) return;
    try {
      await this.deps.contextPort.close(recordId, ContextConnectionCloseReason.COMPLETED);
    } catch {
      // Best-effort revoke; the connection also expires on its own TTL.
    }
  }

  /** Per-turn config in the already-authorized portal root, removed after the subprocess exits.
   *  This avoids broadening the daemon's write permission to the OS temp directory. */
  private async writeClaudeMcpConfigFile(
    connection: IDogfoodContextConnection,
    portalPath: string,
  ): Promise<{ configPath: string; cleanup: () => Promise<void> }> {
    const dir = await Deno.makeTempDir({ dir: portalPath, prefix: ".exaix-dogfood-mcp-" });
    const configPath = join(dir, "claude_mcp_config.json");
    const config = buildClaudeMcpConfig(toMcpConnectionInput(connection));
    try {
      await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch (error) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
      throw error;
    }
    return { configPath, cleanup: () => Deno.remove(dir, { recursive: true }).catch(() => {}) };
  }

  private async writeOpencodeMcpConfigFile(
    connection: IDogfoodContextConnection,
    portalPath: string,
  ): Promise<{ configPath: string; cleanup: () => Promise<void> }> {
    const dir = await Deno.makeTempDir({ dir: portalPath, prefix: ".exaix-dogfood-mcp-" });
    const configPath = join(dir, "opencode_config.json");
    const config = { mcp: buildOpencodeMcpFragment(toMcpConnectionInput(connection)) };
    try {
      await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch (error) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
      throw error;
    }
    return { configPath, cleanup: () => Deno.remove(dir, { recursive: true }).catch(() => {}) };
  }

  private buildClaudeArgs(
    objective: string,
    sessionId: Opt<string, Reason.TraceAbsent>,
    connection: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
    mcpConfigPath: Opt<string, Reason.OptionalContext>,
  ): string[] {
    const modelFlag = this.deps.model ? [SESSION_FLAG_MODEL, stripProviderPrefix(this.deps.model)] : [];
    const resumeFlag = sessionId ? [SESSION_FLAG_RESUME, sessionId] : [];
    const extraAllowedTools = connection ? claudeMcpAllowedToolEntries(toMcpConnectionInput(connection)) : undefined;
    const mcpFlags = connection && mcpConfigPath ? ["--mcp-config", mcpConfigPath, "--strict-mcp-config"] : [];
    return [
      SESSION_FLAG_PRINT,
      objective,
      SESSION_FLAG_OUTPUT_FORMAT,
      SESSION_INPUT_FORMAT_STREAM_JSON,
      SESSION_FLAG_VERBOSE,
      ...modelFlag,
      ...resumeFlag,
      ...deriveClaudeToolFlags(undefined, extraAllowedTools),
      ...mcpFlags,
    ];
  }

  private buildOpencodeArgs(objective: string, sessionId: Opt<string, Reason.TraceAbsent>): string[] {
    const modelFlag = this.deps.model ? [SESSION_FLAG_MODEL, stripProviderPrefix(this.deps.model)] : [];
    const sessionFlag = sessionId ? [SESSION_FLAG_SESSION_ID, sessionId] : [];
    return [
      SESSION_SUBCMD_RUN,
      SESSION_FLAG_FORMAT,
      SESSION_OUTPUT_FORMAT_JSON,
      ...modelFlag,
      ...sessionFlag,
      objective,
    ];
  }

  /** No-op: both tools are cold-spawned per step with no persistent process to tear down; kept so AgentComposer.dispose()'s call site needs no branching. */
  dispose(): void {
    this.sessionIds.clear();
  }
}

/** Extract opencode's top-level `sessionID` field from the first parseable JSONL event, if present. */
function extractOpencodeSessionId(stdout: string): string | undefined {
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line.trim());
      if (typeof parsed === "object" && parsed !== null && typeof parsed.sessionID === "string") {
        return parsed.sessionID;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
