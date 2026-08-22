/**
 * @module CliDelegateModelProvider
 * @path packages/ai-clidelegate/src/cli_delegate_model_provider.ts
 * @description IModelProvider implementation that drives a headless claude/opencode/codex
 * subprocess instead of a direct HTTP API call, so RequestAnalyzer/PlanWriter's
 * planning/analysis calls bill against a subscription (flat-rate) instead of a metered
 * API key — the same auth posture CliDelegateStrategy already gives the code-editing
 * step (packages/execution/src/strategies/cli_delegate_strategy.ts).
 *
 * Multi-turn: IModelOptions.conversationId, when passed, resumes the same underlying
 * claude/opencode/codex session across calls sharing that id — the same --resume/--session
 * mechanism CliDelegateStrategy uses, applied here because this provider is
 * constructed ONCE at daemon startup and reused for every request's whole lifetime
 * (apps/daemon/main.ts), so plan-generation retries for the SAME request (via
 * AgentRunner.run(), RequestProcessor's feedback retry) must not silently start a
 * fresh, context-less session each call — verified live: without this, a claude
 * plan-generation retry lost track of the actual bug being fixed and second-guessed
 * an earlier (real) permission denial as a hallucination. Without a conversationId,
 * calls stay fully stateless (no --resume/--session), matching direct one-shot
 * callers like RequestAnalyzer.
 *
 * Auth: ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are stripped from the spawned CLI's
 * environment so a Claude Pro/Max subscription login is used instead of metered billing
 * — Claude Code's documented auth precedence always prefers an API key over a
 * subscription login when both are present in the environment. OPENAI_API_KEY and
 * CODEX_API_KEY are stripped the same way (Phase 166) so a ChatGPT Codex subscription
 * login wins over a metered key.
 *
 * Read-only enforcement: this provider is consumed for TEXT-COMPLETION analysis/planning
 * calls (RequestAnalyzer/PlanWriter), not file edits — CliDelegateStrategy's own edit
 * step is the only place file writes should happen. claude's default (non-interactive
 * `-p`) permission mode already auto-denies Edit/Write without any extra flag (verified
 * live: a forced "make the edit" prompt returned `permission_denials: [{tool_name:
 * "Edit"}]` and left the file untouched). opencode's default is the opposite — every
 * tool (edit, write, bash) is "allow" unless a config says otherwise — so every opencode
 * call gets an OPENCODE_CONFIG env var pointing at a generated config denying
 * edit/bash/task (verified live: without it, opencode edited a file mid-"analysis"; with
 * it, the identical prompt returned text-only and left the file untouched). codex needs no
 * generated config file — `--sandbox read-only` (Phase 166) pins the same safe posture as
 * a plain CLI flag, since codex's sandbox has no confirmed default to rely on instead.
 *
 * Plan schema normalization (opencode only): because edit/bash/task are denied, opencode's
 * planning response has no real tool-calling to anchor it, so its freehand plan JSON can
 * use tool names outside McpToolName — see opencode_plan_schema_adapter.ts for the
 * live-traced root cause and the normalization applied to every opencode response
 * before it is returned to the caller (RequestAnalyzer/PlanWriter).
 * @architectural-layer AI
 * @related-files [packages/ai-clidelegate/src/cli_delegate_provider_factory.ts, packages/ai-clidelegate/src/opencode_plan_schema_adapter.ts, packages/execution/src/strategies/cli_delegate_strategy.ts, packages/session/src/delegate_return_parser.ts]
 */

import type { IGenerateResult } from "@exaix/ai/providers";
import { ModelProviderError } from "@exaix/ai/providers";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import { OpencodePermissionValueSchema } from "@exaix/schemas/opencode_config.ts";
import type { OpencodePermissionValue } from "@exaix/schemas/opencode_config.ts";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";
import { probeDelegateVersion } from "@exaix/session/delegate_version_probe.ts";
import type { JSONValue } from "@exaix/core";
import { SafeSubprocess } from "@exaix/core";
import {
  DEFAULT_RUNTIME_PATH,
  MINIMUM_VERSION_CLAUDE_CODE_JSON_SCHEMA,
  SESSION_FLAG_FORMAT,
  SESSION_FLAG_JSON,
  SESSION_FLAG_JSON_SCHEMA,
  SESSION_FLAG_MODEL,
  SESSION_FLAG_OUTPUT_FORMAT,
  SESSION_FLAG_OUTPUT_SCHEMA,
  SESSION_FLAG_PRINT,
  SESSION_FLAG_RESUME,
  SESSION_FLAG_SANDBOX,
  SESSION_FLAG_SESSION_ID,
  SESSION_FLAG_SKIP_GIT_REPO_CHECK,
  SESSION_OUTPUT_FORMAT_JSON,
  SESSION_SANDBOX_READ_ONLY,
  SESSION_SUBCMD_EXEC,
  SESSION_SUBCMD_RESUME,
  SESSION_SUBCMD_RUN,
} from "@exaix/core";
import { join } from "@std/path";
import { DEFAULT_CLI_DELEGATE_TIMEOUT_MS } from "./constants.ts";
import { adaptOpencodePlanJson } from "./opencode_plan_schema_adapter.ts";

/** Result of running the headless CLI subprocess (subset of SafeSubprocess.run's shape). */
export interface ICliDelegateProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable subprocess runner seam — defaults to SafeSubprocess.run in production. */
export type IRunCliDelegateProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number; clearEnv?: boolean },
) => Promise<ICliDelegateProcessResult>;

export interface ICliDelegateModelProviderOptions {
  /** Which headless CLI tool to invoke. */
  tool: SessionTool;
  /** Bare binary name or absolute path — never shell-interpolated. */
  bin: string;
  /** Model passed via --model. */
  model: string;
  /** Working directory the CLI subprocess runs in. */
  cwd: string;
  /** Subprocess timeout in milliseconds. Defaults to DEFAULT_CLI_DELEGATE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Custom provider id. Defaults to "<tool>-<model>". */
  id?: string;
  /** Defaults to SafeSubprocess.run. Overridden in tests to avoid real subprocess execution. */
  run?: IRunCliDelegateProcess;
  /** Version probe function for --json-schema support. Defaults to probeDelegateVersion. Overridden in tests. */
  probeVersion?: typeof probeDelegateVersion;
}

/**
 * Top-level `permission` block (not the agent-scoped shape
 * packages/session/src/opencode_permission_generator.ts uses for CliDelegateStrategy's
 * real file-editing delegate calls) — applies via OPENCODE_CONFIG with no --agent flag
 * needed, confirmed by a live probe.
 */
export interface IOpencodeReadOnlyPermissionConfig {
  permission: {
    read?: OpencodePermissionValue;
    grep?: OpencodePermissionValue;
    glob?: OpencodePermissionValue;
    edit: OpencodePermissionValue;
    bash: OpencodePermissionValue;
    task: OpencodePermissionValue;
  };
}

/**
 * Parent env vars safe to forward to a spawned CLI-delegate subprocess. GAP-14 (Phase 167
 * post-gap-analysis): the prior implementation was a 7-pattern denylist starting from the
 * daemon's FULL ambient environment, which forwarded any secret-shaped var the denylist
 * didn't happen to name (AWS/GitHub/Google/NPM/DB credentials, the SSH agent socket, and
 * this same daemon's own OPENROUTER_API_KEY). An allowlist is the only model that stays
 * safe as new secrets are added to the daemon's own environment over time — consistent
 * with packages/session/src/supervised_launch.ts:sanitizeChildEnv, the Mode-3
 * session-delegate path's env builder for the identical threat (spawning an untrusted
 * headless CLI delegate).
 */
const ALLOWED_PARENT_ENV_KEYS: readonly string[] = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];

/**
 * Variables whose name implies a secret — defense-in-depth on top of the allowlist above,
 * not the sole control. None of ALLOWED_PARENT_ENV_KEYS matches today; this guards a future
 * allowlist addition from accidentally admitting a secret-shaped name.
 */
const SECRET_ENV_PATTERN = /API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY/i;

/** Env var name prefixes Deno's scoped `--allow-run=<bin>` permission (the daemon's own
 *  posture — DAEMON_SPAWN_RUN_BINARIES is a name allowlist, never unscoped) refuses to
 *  forward to a spawned child: `Deno.errors.NotCapable: Requires --allow-run permissions
 *  to spawn subprocess with <VAR> environment variable. Alternatively, spawn with the
 *  environment variable unset.` These vars instruct the dynamic linker to load arbitrary
 *  shared libraries into the child. None of ALLOWED_PARENT_ENV_KEYS matches today; this is
 *  an orthogonal, defense-in-depth guard against a future allowlist addition colliding with
 *  this prefix — preserved from the pre-allowlist fix that discovered it live proving Phase
 *  167 Step 3's forced-ReAct Codex evidence on a workstation with LD_LIBRARY_PATH set.
 */
const DYNAMIC_LINKER_ENV_PREFIXES: readonly string[] = ["LD_", "DYLD_"];

/** Placeholder for an absent sessionId/conversationId in the diagnostic generate-start log. */
const UNSET_LOG_LABEL = "none";

/** Tool identifiers compared at each of generate()'s three-way dispatch sites. */
const TOOL_CLAUDE_CODE = SessionToolSchema.enum["claude-code"];
const TOOL_CODEX = SessionToolSchema.enum.codex;

function buildDelegateEnv(): Record<string, string> {
  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {};
  for (const key of ALLOWED_PARENT_ENV_KEYS) {
    const value = parentEnv[key];
    if (value === undefined) continue;
    if (SECRET_ENV_PATTERN.test(key)) continue;
    if (DYNAMIC_LINKER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

const defaultRun: IRunCliDelegateProcess = (command, args, options) => SafeSubprocess.run(command, args, options);

const OPENCODE_PERMISSION_DENY = OpencodePermissionValueSchema.enum.deny;

/**
 * Read-only config for plan-generation calls. edit/bash/task are denied and no
 * tools are explicitly allowed — opencode falls back to plain text mode (not
 * ReAct tool loop), so the model outputs a clean plan string instead of getting
 * confused by read-only tool permissions.
 *
 * Phase 155 Step 2 originally added read/grep/glob here to keep opencode in
 * ReAct mode, but that caused the model to see tools it could use, triggering
 * prose output instead of structured plans. Reverted: plan generation needs
 * text output, not tool interaction.
 */
function buildOpencodeReadOnlyConfig(): IOpencodeReadOnlyPermissionConfig {
  return {
    permission: {
      edit: OPENCODE_PERMISSION_DENY,
      bash: OPENCODE_PERMISSION_DENY,
      task: OPENCODE_PERMISSION_DENY,
    },
  };
}

/**
 * Written once per provider instance (not per call) — the config never changes. Written
 * under cwd (the daemon's own writable scope), not the OS tempdir: Deno.makeTempFile()
 * defaults there, and a daemon process only holds --allow-write for its sandbox/portal
 * tree — verified live: "Requires write access to <TMP>, run again with the --allow-write
 * flag" when this wrote outside cwd.
 */
async function writeOpencodeReadOnlyConfig(cwd: string): Promise<string> {
  const dir = join(cwd, DEFAULT_RUNTIME_PATH, "tmp");
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `opencode-readonly-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(path, JSON.stringify(buildOpencodeReadOnlyConfig(), null, 2));
  return path;
}

/**
 * Writes codex's `--output-schema` payload to a temp JSON file. Uses the same cwd-scoped
 * `Deno.mkdir`/tmp-dir pattern as writeOpencodeReadOnlyConfig above — NOT bare
 * `Deno.makeTempFile()`, which defaults to the OS tempdir a daemon process does not hold
 * `--allow-write` for (see that function's doc comment for the live-verified failure).
 * generate()'s finally block removes this file once the subprocess exits, so it never
 * accumulates across calls.
 */
async function writeCodexSchemaTempFile(cwd: string, jsonSchema: Record<string, JSONValue>): Promise<string> {
  const dir = join(cwd, DEFAULT_RUNTIME_PATH, "tmp");
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `codex-schema-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(path, JSON.stringify(jsonSchema));
  return path;
}

/**
 * Extract claude's top-level `session_id` field from a plain `--output-format json`
 * response (a single JSON object, not the stream-json event sequence
 * CliDelegateStrategy parses via cli_delegate_stream_parser.ts).
 */
function extractClaudeSessionId(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed.session_id === "string" ? parsed.session_id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract opencode's top-level `sessionID` field from the first parseable JSONL
 * event line — every event carries it (verified via a live CLI probe, 2026-07-20).
 * Mirrors CliDelegateStrategy's extractOpencodeSessionId (packages/execution/src/
 * strategies/cli_delegate_strategy.ts) — kept as a local copy rather than shared,
 * matching that module's own precedent of extracting session ids outside
 * parseDelegateStdout's shared parsing contract.
 */
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

/**
 * Extract codex's `thread_id` from its `thread.started` JSONL event line — documented as
 * the first line of `codex exec --json` output, but scanned like extractOpencodeSessionId
 * above rather than assumed, for the same defensive-parsing reason.
 */
function extractCodexSessionId(stdout: string): string | undefined {
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line.trim());
      if (
        typeof parsed === "object" && parsed !== null && parsed.type === "thread.started" &&
        typeof parsed.thread_id === "string"
      ) {
        return parsed.thread_id;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Drives a headless claude/opencode CLI subprocess to satisfy IModelProvider.generate().
 * Not CliDelegateStrategy — this is the AI-layer provider consumed by RequestAnalyzer/
 * PlanWriter/any IModelProvider caller, not the per-plan-step execution strategy.
 */
export class CliDelegateModelProvider implements IModelProvider {
  public readonly id: string;
  private readonly run: IRunCliDelegateProcess;
  private opencodeReadOnlyConfigPath: Promise<string> | undefined;
  /** conversationId -> captured session id, for --resume/--session continuity. */
  private readonly sessionIds = new Map<string, string>();
  /** Cached result of the claude version probe for --json-schema support. null = not yet probed. */
  private jsonSchemaVersionSupported: boolean | null = null;
  private readonly probeVersion: typeof probeDelegateVersion;

  constructor(private readonly options: ICliDelegateModelProviderOptions) {
    this.id = options.id ?? `${options.tool}-${options.model}`;
    this.run = options.run ?? defaultRun;
    this.probeVersion = options.probeVersion ??
      ((...args: Parameters<typeof probeDelegateVersion>) => probeDelegateVersion(...args));
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalContext>): Promise<IGenerateResult> {
    const conversationId = options?.conversationId;
    const sessionId = conversationId ? this.sessionIds.get(conversationId) : undefined;
    const jsonSchema = options?.jsonSchema;
    const args = await this.buildArgsForTool(prompt, sessionId, jsonSchema);

    const env = buildDelegateEnv();
    if (!this.isTextPassthroughTool()) {
      this.opencodeReadOnlyConfigPath ??= writeOpencodeReadOnlyConfig(this.options.cwd);
      env.OPENCODE_CONFIG = await this.opencodeReadOnlyConfigPath;
    }

    const startedAt = Date.now();
    console.log(
      `[CliDelegateModelProvider] generate start: model=${this.options.model} promptLen=${prompt.length} ` +
        `hasContentTag=${prompt.includes("<content>")} sessionId=${sessionId ?? UNSET_LOG_LABEL} ` +
        `conversationId=${conversationId ?? UNSET_LOG_LABEL}`,
    );

    let result: ICliDelegateProcessResult;
    try {
      result = await this.run(this.options.bin, args, {
        cwd: this.options.cwd,
        env,
        clearEnv: true,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
      });
    } catch (error) {
      console.log(
        `[CliDelegateModelProvider] generate threw after ${Date.now() - startedAt}ms: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ModelProviderError(
        `CliDelegateModelProvider could not run '${this.options.bin}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        this.id,
      );
    } finally {
      // codex's --output-schema temp file (buildCodexArgs) must never accumulate across
      // calls, whether the subprocess succeeded or failed.
      await this.cleanupCodexSchemaTempFile(args);
    }
    console.log(
      `[CliDelegateModelProvider] generate exited: code=${result.code} durationMs=${Date.now() - startedAt} ` +
        `stdoutLen=${result.stdout.length} stderrLen=${result.stderr.length}`,
    );

    if (result.code !== 0) {
      throw new ModelProviderError(
        `CliDelegateModelProvider '${this.options.bin}' exited with code ${result.code}: ${result.stderr.trim()}`,
        this.id,
      );
    }

    if (conversationId && !sessionId) {
      const capturedSessionId = this.extractSessionIdForTool(result.stdout);
      if (capturedSessionId) this.sessionIds.set(conversationId, capturedSessionId);
    }

    const parsed = parseDelegateStdout(result.stdout, this.options.tool);
    console.log(
      `[CliDelegateModelProvider] lastText preview: ${JSON.stringify((parsed.lastText ?? "").slice(0, 300))}`,
    );
    // opencode's read-only planning calls (edit/bash/task denied above) have no real
    // tool-calling to anchor their output, so a freehand plan JSON can use tool names
    // outside McpToolName (see opencode_plan_schema_adapter.ts) — normalize before this
    // reaches PlanAdapter/plan_schema.ts validation. No-op for claude/codex (not affected)
    // and for any response that isn't a plan JSON object (adapter leaves it unchanged).
    const content = this.isTextPassthroughTool() ? parsed.lastText : adaptOpencodePlanJson(parsed.lastText).json;
    return {
      content,
      usage: {
        promptTokens: parsed.tokenStats.input,
        completionTokens: parsed.tokenStats.output,
        totalTokens: parsed.tokenStats.total,
      },
      model: this.options.model,
      provider: this.options.tool,
      cost_usd: parsed.costUsd ?? 0,
    };
  }

  /** claude and codex both return plain text directly; only opencode needs the plan-JSON adapter. */
  private isTextPassthroughTool(): boolean {
    return this.options.tool === TOOL_CLAUDE_CODE || this.options.tool === TOOL_CODEX;
  }

  private async buildArgsForTool(
    prompt: string,
    sessionId: Opt<string, Reason.TraceAbsent>,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<string[]> {
    if (this.options.tool === TOOL_CLAUDE_CODE) return await this.buildClaudeArgs(prompt, sessionId, jsonSchema);
    if (this.options.tool === TOOL_CODEX) return await this.buildCodexArgs(prompt, sessionId, jsonSchema);
    return this.buildOpencodeArgs(prompt, sessionId);
  }

  private extractSessionIdForTool(stdout: string): string | undefined {
    if (this.options.tool === TOOL_CLAUDE_CODE) return extractClaudeSessionId(stdout);
    if (this.options.tool === TOOL_CODEX) return extractCodexSessionId(stdout);
    return extractOpencodeSessionId(stdout);
  }

  /** Removes buildCodexArgs' --output-schema temp file; a no-op for every other tool. */
  private async cleanupCodexSchemaTempFile(args: string[]): Promise<void> {
    if (this.options.tool !== TOOL_CODEX) return;
    const schemaFlagIndex = args.indexOf(SESSION_FLAG_OUTPUT_SCHEMA);
    if (schemaFlagIndex === -1) return;
    const schemaPath = args[schemaFlagIndex + 1];
    await Deno.remove(schemaPath).catch((error) => {
      console.warn(`[CliDelegateModelProvider] failed to remove codex schema temp file '${schemaPath}': ${error}`);
    });
  }

  private async buildClaudeArgs(
    prompt: string,
    sessionId: Opt<string, Reason.TraceAbsent>,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<string[]> {
    const resumeFlag = sessionId ? [SESSION_FLAG_RESUME, sessionId] : [];
    const jsonSchemaFlag: string[] = [];
    if (jsonSchema) {
      if (this.jsonSchemaVersionSupported === null) {
        const probeResult = await this.probeVersion(
          this.options.bin,
          MINIMUM_VERSION_CLAUDE_CODE_JSON_SCHEMA,
        );
        this.jsonSchemaVersionSupported = probeResult.supported;
        if (!probeResult.supported) {
          console.warn(
            `[CliDelegateModelProvider] ${this.options.bin} version ${probeResult.version} below ` +
              `${MINIMUM_VERSION_CLAUDE_CODE_JSON_SCHEMA}; --json-schema not available, falling back to ` +
              `--output-format json only. ${probeResult.warning ?? ""}`,
          );
        }
      }
      if (this.jsonSchemaVersionSupported) {
        jsonSchemaFlag.push(SESSION_FLAG_JSON_SCHEMA, JSON.stringify(jsonSchema));
      }
    }
    return [
      SESSION_FLAG_PRINT,
      prompt,
      SESSION_FLAG_OUTPUT_FORMAT,
      SESSION_OUTPUT_FORMAT_JSON,
      SESSION_FLAG_MODEL,
      this.options.model,
      ...resumeFlag,
      ...jsonSchemaFlag,
    ];
  }

  /**
   * Builds `codex exec --json --model <m> --sandbox read-only --skip-git-repo-check
   * [resume <id>] [--output-schema <path>] <prompt>`. `--sandbox read-only` is always passed
   * explicitly (Design Decisions — no confirmed CLI default to rely on instead).
   * `--skip-git-repo-check` is always passed too: this provider spawns codex from
   * `config.system.root` (the daemon's own data root), which is never a Git repository, and
   * codex refuses to run outside a trusted/Git directory without this flag (live-verified,
   * Phase 167 Step 3) — it only bypasses that precondition, not the sandbox permission model.
   * `resume` and `--output-schema` cannot combine on one codex invocation (OpenAI docs) —
   * resume continuity wins; the schema flag is dropped with a warning.
   */
  private async buildCodexArgs(
    prompt: string,
    sessionId: Opt<string, Reason.TraceAbsent>,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<string[]> {
    const resumeArgs = sessionId ? [SESSION_SUBCMD_RESUME, sessionId] : [];
    const schemaArgs: string[] = [];
    if (jsonSchema) {
      if (sessionId) {
        console.warn(
          `[CliDelegateModelProvider] codex resume ${sessionId} and --output-schema cannot ` +
            `combine on one invocation; dropping --output-schema to preserve session continuity.`,
        );
      } else {
        const schemaPath = await writeCodexSchemaTempFile(this.options.cwd, jsonSchema);
        schemaArgs.push(SESSION_FLAG_OUTPUT_SCHEMA, schemaPath);
      }
    }
    return [
      SESSION_SUBCMD_EXEC,
      SESSION_FLAG_JSON,
      SESSION_FLAG_MODEL,
      this.options.model,
      SESSION_FLAG_SANDBOX,
      SESSION_SANDBOX_READ_ONLY,
      SESSION_FLAG_SKIP_GIT_REPO_CHECK,
      ...resumeArgs,
      ...schemaArgs,
      prompt,
    ];
  }

  private buildOpencodeArgs(prompt: string, sessionId: Opt<string, Reason.TraceAbsent>): string[] {
    const sessionFlag = sessionId ? [SESSION_FLAG_SESSION_ID, sessionId] : [];
    return [
      SESSION_SUBCMD_RUN,
      SESSION_FLAG_FORMAT,
      SESSION_OUTPUT_FORMAT_JSON,
      SESSION_FLAG_MODEL,
      this.options.model,
      ...sessionFlag,
      prompt,
    ];
  }
}
