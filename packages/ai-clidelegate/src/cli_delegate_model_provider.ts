/**
 * @module CliDelegateModelProvider
 * @path packages/ai-clidelegate/src/cli_delegate_model_provider.ts
 * @description IModelProvider implementation that drives a headless claude/opencode CLI
 * subprocess instead of a direct HTTP API call, so RequestAnalyzer/PlanWriter's
 * planning/analysis calls bill against a subscription (flat-rate) instead of a metered
 * API key — the same auth posture CliDelegateStrategy already gives the code-editing
 * step (packages/execution/src/strategies/cli_delegate_strategy.ts).
 *
 * Multi-turn: IModelOptions.conversationId, when passed, resumes the same underlying
 * claude/opencode session across calls sharing that id — the same --resume/--session
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
 * subscription login when both are present in the environment.
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
 * it, the identical prompt returned text-only and left the file untouched).
 *
 * Plan schema normalization (opencode only): because edit/bash/task are denied, opencode's
 * planning response has no real tool-calling to anchor it, so its freehand plan JSON can
 * use tool names outside McpToolName — see opencode_plan_schema_adapter.ts for the
 * live-traced root cause and the normalization applied to every non-claude response
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
  SESSION_FLAG_JSON_SCHEMA,
  SESSION_FLAG_MODEL,
  SESSION_FLAG_OUTPUT_FORMAT,
  SESSION_FLAG_PRINT,
  SESSION_FLAG_RESUME,
  SESSION_FLAG_SESSION_ID,
  SESSION_OUTPUT_FORMAT_JSON,
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

/** Env vars stripped from every spawn so a subscription login wins over metered API billing. */
const STRIPPED_AUTH_ENV_KEYS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
];

/** Placeholder for an absent sessionId/conversationId in the diagnostic generate-start log. */
const UNSET_LOG_LABEL = "none";

function buildDelegateEnv(): Record<string, string> {
  const env = Deno.env.toObject();
  for (const key of STRIPPED_AUTH_ENV_KEYS) {
    delete env[key];
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
 * Drives a headless claude/opencode CLI subprocess to satisfy IModelProvider.generate().
 * Not CliDelegateStrategy — this is the AI-layer provider consumed by RequestAnalyzer/
 * PlanWriter/any IModelProvider caller, not the per-plan-step execution strategy.
 */
export class CliDelegateModelProvider implements IModelProvider {
  public readonly id: string;
  private readonly run: IRunCliDelegateProcess;
  private readonly isClaude: boolean;
  private opencodeReadOnlyConfigPath: Promise<string> | undefined;
  /** conversationId -> captured session id, for --resume/--session continuity. */
  private readonly sessionIds = new Map<string, string>();
  /** Cached result of the claude version probe for --json-schema support. null = not yet probed. */
  private jsonSchemaVersionSupported: boolean | null = null;
  private readonly probeVersion: typeof probeDelegateVersion;

  constructor(private readonly options: ICliDelegateModelProviderOptions) {
    this.id = options.id ?? `${options.tool}-${options.model}`;
    this.run = options.run ?? defaultRun;
    this.isClaude = options.tool === SessionToolSchema.enum["claude-code"];
    this.probeVersion = options.probeVersion ??
      ((...args: Parameters<typeof probeDelegateVersion>) => probeDelegateVersion(...args));
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalContext>): Promise<IGenerateResult> {
    const conversationId = options?.conversationId;
    const sessionId = conversationId ? this.sessionIds.get(conversationId) : undefined;
    const jsonSchema = options?.jsonSchema;
    const args = this.isClaude
      ? await this.buildClaudeArgs(prompt, sessionId, jsonSchema)
      : this.buildOpencodeArgs(prompt, sessionId);
    const env = buildDelegateEnv();
    if (!this.isClaude) {
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
      const capturedSessionId = this.isClaude
        ? extractClaudeSessionId(result.stdout)
        : extractOpencodeSessionId(result.stdout);
      if (capturedSessionId) this.sessionIds.set(conversationId, capturedSessionId);
    }

    const parsed = parseDelegateStdout(result.stdout, this.options.tool);
    console.log(
      `[CliDelegateModelProvider] lastText preview: ${JSON.stringify((parsed.lastText ?? "").slice(0, 300))}`,
    );
    // opencode's read-only planning calls (edit/bash/task denied above) have no real
    // tool-calling to anchor their output, so a freehand plan JSON can use tool names
    // outside McpToolName (see opencode_plan_schema_adapter.ts) — normalize before this
    // reaches PlanAdapter/plan_schema.ts validation. No-op for claude (not affected) and
    // for any response that isn't a plan JSON object (adapter leaves it unchanged).
    const content = this.isClaude ? parsed.lastText : adaptOpencodePlanJson(parsed.lastText).json;
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
