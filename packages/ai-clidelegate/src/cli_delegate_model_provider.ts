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
import { buildAllowlistChildEnv } from "@exaix/core/helpers/child_env.ts";
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

/** Top-level `permission` block (distinct from the agent-scoped shape used by CliDelegateStrategy) — applies via OPENCODE_CONFIG with no --agent flag needed. */
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

/** Builds the CLI-delegate subprocess env via the shared allowlist-mode child-env policy — an allowlist, not a denylist, since a denylist can't be proven to never forward a newly-added secret-shaped var. */
function buildDelegateEnv(): Record<string, string> {
  return buildAllowlistChildEnv({}, Deno.env.toObject());
}

/** Placeholder for an absent sessionId/conversationId in the diagnostic generate-start log. */
const UNSET_LOG_LABEL = "none";

/** Cap on how much of a failing CLI's raw stdout an error message quotes. */
const ERROR_STDOUT_PREVIEW_MAX_CHARS = 2000;

/** Tool identifiers compared at each of generate()'s three-way dispatch sites. */
const TOOL_CLAUDE_CODE = SessionToolSchema.enum["claude-code"];
const TOOL_CODEX = SessionToolSchema.enum.codex;

const defaultRun: IRunCliDelegateProcess = (command, args, options) => SafeSubprocess.run(command, args, options);

const OPENCODE_PERMISSION_DENY = OpencodePermissionValueSchema.enum.deny;

/** Read-only config for plan-generation calls: edit/bash/task denied, no tools allowed. Do not add read/grep/glob — that switches opencode into ReAct tool mode, producing prose instead of a plan string. */
function buildOpencodeReadOnlyConfig(): IOpencodeReadOnlyPermissionConfig {
  return {
    permission: {
      edit: OPENCODE_PERMISSION_DENY,
      bash: OPENCODE_PERMISSION_DENY,
      task: OPENCODE_PERMISSION_DENY,
    },
  };
}

/** Written once per provider instance (not per call), under cwd not the OS tempdir — the daemon process only holds --allow-write for its sandbox/portal tree. */
async function writeOpencodeReadOnlyConfig(cwd: string): Promise<string> {
  const dir = join(cwd, DEFAULT_RUNTIME_PATH, "tmp");
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `opencode-readonly-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(path, JSON.stringify(buildOpencodeReadOnlyConfig(), null, 2));
  return path;
}

/** Extracts claude's top-level `session_id` from a plain `--output-format json` response
 * (a single JSON object, not the stream-json event sequence cli_delegate_stream_parser.ts parses). */
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

/** Extracts opencode's top-level `sessionID` from the first parseable JSONL event line — every event carries it. Kept as a local copy rather than importing CliDelegateStrategy's identical helper. */
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

/** Extracts codex's `thread_id` from the `thread.started` JSONL event line — documented as
 * line 1 of `codex exec --json` output but scanned defensively rather than assumed. */
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

/** Drives a headless claude/opencode CLI subprocess to satisfy IModelProvider.generate().
 * Distinct from CliDelegateStrategy: consumed by RequestAnalyzer/PlanWriter, not a per-plan-step execution strategy. */
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
        `CliDelegateModelProvider '${this.options.bin}' exited with code ${result.code}: stderr=${
          result.stderr.trim() || "(empty)"
        } stdout=${result.stdout.trim().slice(0, ERROR_STDOUT_PREVIEW_MAX_CHARS) || "(empty)"}`,
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
    // opencode's read-only planning calls have no real tool-calling to anchor output, so a
    // freehand plan JSON can use tool names outside McpToolName — normalize before PlanAdapter
    // validation. No-op for claude/codex and for non-plan-JSON responses.
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

  /** Builds `codex exec --json --sandbox read-only --skip-git-repo-check [resume] [--output-schema] <prompt>`.
   * `--skip-git-repo-check` is required since this spawns codex from `config.system.root`, never a Git repo.
   * `resume` and `--output-schema` cannot combine (OpenAI docs); resume wins, schema flag drops with a warning. */
  private buildCodexArgs(
    prompt: string,
    sessionId: Opt<string, Reason.TraceAbsent>,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): string[] {
    const resumeArgs = sessionId ? [SESSION_SUBCMD_RESUME, sessionId] : [];
    // codex 0.147.0's --output-schema requires OpenAI strict-mode schemas (no anyOf/oneOf, every
    // property required) that Exaix's zod-to-json-schema output doesn't satisfy, causing
    // `invalid_json_schema` (400). Dropped for codex; PlanAdapter enforces the shape instead.
    if (jsonSchema) {
      console.warn(
        `[CliDelegateModelProvider] codex --output-schema is dropped (codex requires strict-mode ` +
          `schemas; PlanAdapter enforces the plan shape after <content> extraction).`,
      );
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
