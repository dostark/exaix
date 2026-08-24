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
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/strategies/cli_delegate_stream_parser.ts, packages/session/src/delegate_return_parser.ts, packages/session/src/claude_permission_flags.ts]
 */

import { isAbsolute, relative } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type IAgentFileBlueprint } from "../agent_orchestrator.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
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

/** Resolves a portal alias to its absolute checkout path. Backed by AgentOrchestrator.getPortalConfig. */
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
}

const defaultRun: IRunCliDelegateProcess = (command, args, options) => SafeSubprocess.run(command, args, options);

/** Env vars stripped from every CLI-delegate spawn so a Claude Pro/Max subscription login wins over metered API billing (see module doc's Auth section). */
const STRIPPED_AUTH_ENV_KEYS: readonly string[] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** The delegate's OWN subscription auth (Claude Code OAuth) — the one non-allowlisted
 *  ambient var it genuinely needs, distinct from Exaix's provider secrets. Re-added to the
 *  launch env explicitly (never via the ambient parent). */
const DELEGATE_OAUTH_ENV_KEY = "CLAUDE_CODE_OAUTH_TOKEN";

// git status read used by detectGitChanges() to surface the delegate's real writes as
// files_changed. Kept LOCAL (not imported from @exaix/git) so a strategy file does not reach
// into a low-level constants module — CODE_STYLE.md §15; values mirror git_audit_service's.
const GIT_CMD_STATUS = "status";
const GIT_FLAG_PORCELAIN = "--porcelain";
const GIT_FLAG_UNTRACKED_FILES_ALL = "--untracked-files=all";
const GIT_STATUS_TIMEOUT_MS = 30_000;

/**
 * Build the spawn env via the SHARED child-env policy (`buildAllowlistChildEnv`,
 * allowlist mode): only the safe parent keys (PATH/HOME/LANG/LC_ALL/TERM/TMPDIR) plus the
 * deliberate PWD override and the delegate's own OAuth subscription auth reach the
 * subprocess. Ambient secrets (OPENROUTER_API_KEY, cloud/VCS/SSH credentials) and proxy
 * vars are excluded — the delegate is a foreign agent and must run fail-closed (GAP-28).
 * The prior inherit mode forwarded the daemon's full secret stack, which the shared policy
 * reserves for first-party tools only.
 * Deno.Command's `cwd` option changes the OS-level working directory the subprocess
 * is spawned into, but does NOT update a `PWD` env var inherited via
 * Deno.env.toObject() — the daemon's own PWD (wherever it was originally launched
 * from) otherwise leaks through unchanged. opencode's CLI resolves relative tool-call
 * paths against process.env.PWD rather than the kernel cwd (live-verified: a write
 * meant for a worktree checkout landed in the daemon's own launch directory instead),
 * so PWD must always be kept in sync with the real spawn cwd.
 */
function buildDelegateEnv(portalPath: string): Record<string, string> {
  const launchEnv: Record<string, string> = { PWD: portalPath };
  const oauth = Deno.env.get(DELEGATE_OAUTH_ENV_KEY);
  if (oauth !== undefined) {
    launchEnv[DELEGATE_OAUTH_ENV_KEY] = oauth;
  }
  const env = buildAllowlistChildEnv(launchEnv, Deno.env.toObject());
  for (const key of STRIPPED_AUTH_ENV_KEYS) delete env[key];
  return env;
}

/**
 * opencode's tool_use events report an ABSOLUTE filePath (verified via a live CLI
 * probe); claude's parsed toolPaths is always empty today. GitAuditService's
 * unauthorized-change check compares files_changed against `git status --porcelain`
 * output, which is always portal-relative — an unnormalized absolute path never
 * matches, so every real write gets reverted as a false-positive security violation.
 */
function toPortalRelativePaths(paths: string[], portalPath: string): string[] {
  return paths.map((path) => isAbsolute(path) ? relative(portalPath, path) : path);
}

/**
 * CliDelegateStrategy implements agent-step execution by driving a headless CLI
 * tool (claude / opencode) instead of calling IModelProvider directly. Not the
 * async, durable-wait gate delegation used by SessionDelegateService/
 * HeadlessSessionLauncher — this runs synchronously, once per plan step,
 * within the normal AgentOrchestrator.executeStep flow.
 */
export class CliDelegateStrategy implements IExecutionStrategy {
  public readonly name = ExecutionStrategyName.CLI_DELEGATE;
  private readonly run: IRunCliDelegateProcess;
  /** Session id per plan (trace_id), captured from the first step's response and resumed on every later step. Shape is identical for both tools; only the flag name differs. */
  private readonly sessionIds = new Map<string, string>();

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
    const isClaude = this.deps.tool === SessionToolSchema.enum["claude-code"];

    const parsed: ICliDelegateParsedOutcome = isClaude
      ? await this.runClaudeStep(context.trace_id, objective, portalPath)
      : await this.runOpencodeStep(context.trace_id, objective, portalPath);

    const reportedPaths = toPortalRelativePaths(parsed.toolPaths, portalPath);
    // claude's parsed toolPaths is empty today (its print-mode stream emits no per-turn
    // tool_use lines), so the delegate's REAL writes would be invisible to the step audit and
    // every legitimate change flagged as a false-positive security violation — which fails the
    // plan, the plan never reaches Archive, and the scenario's wait-for-execution-completion
    // times out. Fall back to the worktree's actual `git status` changes when the stream
    // reported nothing, so the real writes become the step's authorized files_changed.
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
  ): Promise<ICliDelegateParsedOutcome> {
    const sessionId = this.sessionIds.get(traceId);
    const args = this.buildClaudeArgs(objective, sessionId);

    let result: ICliDelegateProcessResult;
    try {
      result = await this.run(this.deps.bin, args, {
        cwd: portalPath,
        env: buildDelegateEnv(portalPath),
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
        `CLI delegate '${this.deps.bin}' exited with code ${result.code}: ${result.stderr.trim()}`,
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
  }

  private async runOpencodeStep(
    traceId: string,
    objective: string,
    portalPath: string,
  ): Promise<ICliDelegateParsedOutcome> {
    const sessionId = this.sessionIds.get(traceId);
    const args = this.buildOpencodeArgs(objective, sessionId);

    let result: ICliDelegateProcessResult;
    try {
      result = await this.run(this.deps.bin, args, {
        cwd: portalPath,
        env: buildDelegateEnv(portalPath),
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
        `CLI delegate '${this.deps.bin}' exited with code ${result.code}: ${result.stderr.trim()}`,
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }

    const capturedSessionId = extractOpencodeSessionId(result.stdout);
    if (capturedSessionId && !sessionId) {
      this.sessionIds.set(traceId, capturedSessionId);
    }

    return parseDelegateStdout(result.stdout, this.deps.tool);
  }

  /**
   * Detect the delegate's REAL worktree writes via `git status --porcelain` — used when the
   * CLI tool's stream reported no tool paths (claude), so the step audit sees the actual
   * changes as authorized files_changed instead of flagging every write as a false-positive
   * security violation. Mirrors git_audit_service's own status read (same flags/timeout).
   * The git command constants are kept LOCAL rather than imported from @exaix/git so a
   * strategy file does not reach into a low-level constants module (CODE_STYLE.md §15).
   */
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

  /**
   * On a trace's first turn, lead with the whole plan (context.full_plan) so the
   * CLI session orients on the complete task before ever seeing an isolated,
   * ReAct-shaped step fragment — a fresh session handed only "Tools: read_file"
   * has no coherent goal to act on. Later turns in the same resumed session
   * already carry that orientation in conversation history, so they only need
   * the current step's fragment (context.plan) to know what to do next.
   */
  private buildObjective(blueprint: IAgentFileBlueprint, context: IExecutionContext, isFirstTurn: boolean): string {
    const taskSection = isFirstTurn && context.full_plan
      ? `TASK: ${context.request}\n\nFULL PLAN:\n${context.full_plan}\n\nBEGIN WITH THE FIRST STEP BELOW.`
      : `TASK: ${context.request}`;
    return `${blueprint.systemPrompt}\n\n${taskSection}\n\nPLAN STEP: ${context.plan}`;
  }

  private buildClaudeArgs(objective: string, sessionId: Opt<string, Reason.TraceAbsent>): string[] {
    const modelFlag = this.deps.model ? [SESSION_FLAG_MODEL, this.deps.model] : [];
    const resumeFlag = sessionId ? [SESSION_FLAG_RESUME, sessionId] : [];
    return [
      SESSION_FLAG_PRINT,
      objective,
      SESSION_FLAG_OUTPUT_FORMAT,
      SESSION_INPUT_FORMAT_STREAM_JSON,
      SESSION_FLAG_VERBOSE,
      ...modelFlag,
      ...resumeFlag,
      ...deriveClaudeToolFlags(),
    ];
  }

  private buildOpencodeArgs(objective: string, sessionId: Opt<string, Reason.TraceAbsent>): string[] {
    const modelFlag = this.deps.model ? [SESSION_FLAG_MODEL, this.deps.model] : [];
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

  /** No-op: both tools are cold-spawned per step with no persistent process to tear down; kept so AgentOrchestrator.dispose()'s call site needs no branching. */
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
