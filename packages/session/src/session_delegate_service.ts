/**
 * @module SessionDelegateService
 * @path packages/session/src/session_delegate_service.ts
 * @description Phase 106 Step 3 — materializes the session brief and resolves
 *   launches. Generates the single-use resume token (GAP-2), validates every
 *   path field against traversal/null-byte (GAP-5), and writes brief.json
 *   atomically (write tmp + rename). Package-pure: no Config/DB/EventLogger.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas, @exaix/core, @exaix/tool-runtime]
 * @related-files [packages/session/src/i_session_delegate.ts, packages/session/src/session_adapter_registry.ts]
 */

import { dirname, join } from "@std/path";
import {
  DOGFOOD_DEVELOPER_IDENTITY_ID,
  MINIMUM_VERSION_CLAUDE_CODE,
  MINIMUM_VERSION_OPENCODE,
  PROVIDER_ANTHROPIC,
  PROVIDER_OLLAMA,
  PROVIDER_OPENROUTER,
  SESSION_DEFAULT_DEADLINE_HOURS,
  TIME_MS_PER_HOUR,
} from "@exaix/core/types";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type {
  SessionBrief,
  SessionDelegateConfig,
  SessionLaunchMode,
  SessionTool,
} from "@exaix/schemas/session_delegate.ts";
import { PathSecurity } from "@exaix/tool-runtime";
import type { PathResolver } from "@exaix/portal";
import type { ISessionLaunch } from "./i_session_adapter.ts";
import type { SessionAdapterRegistry } from "./session_adapter_registry.ts";
import type {
  IHardenedLaunchResult,
  IPrepareBriefInput,
  ISessionClock,
  ISessionDelegateService,
  ISessionPathSafety,
} from "./i_session_delegate.ts";
import { deriveClaudeToolFlags } from "./claude_permission_flags.ts";
import { generateOpencodePermissionConfig } from "./opencode_permission_generator.ts";
import { probeDelegateVersion } from "./delegate_version_probe.ts";

/** Dependencies for SessionDelegateService (constructor DI, all Config-free). */
export interface ISessionDelegateServiceDeps {
  registry: SessionAdapterRegistry;
  clock: ISessionClock;
  /** Absolute Session/ directory under which {traceId}/brief.json is written. */
  sessionDir: string;
  /** Defaults to defaultSessionPathSafety. */
  pathSafety?: ISessionPathSafety;
  /**
   * PathResolver for resolving @Runtime paths for generated permission configs
   * (Phase 128 R3 Step 5). Required when harden_permissions is true.
   * Optional to avoid breaking existing callers that don't use permission
   * hardening.
   */
  pathResolver?: PathResolver;
}

const BRIEF_FILE = "brief.json";
const RESUME_TOKEN_ENTROPY_BYTES = 32; // 256-bit suffix (GAP-2)
const TOOL_OPENCODE = "opencode";
const TOOL_CLAUDE_CODE = "claude-code";

/** System wall-clock implementation of the clock seam. */
export const systemClock: ISessionClock = { now: () => new Date() };

/**
 * Config-free path-safety helper. Rejects null bytes explicitly (PathSecurity
 * strips them silently) before delegating traversal detection to PathSecurity.
 */
export const defaultSessionPathSafety: ISessionPathSafety = {
  normalize(path: string): string {
    if (path.includes("\x00")) {
      throw new Error("path field contains a null byte");
    }
    return PathSecurity.normalizePath(path);
  },
};

/**
 * Generate a single-use resume token: a UUID plus a 256-bit random suffix
 * (GAP-2). Bound to a trace + gate in the wait record, compared in constant time
 * at resume, and never reused.
 */
export function generateResumeToken(): string {
  const bytes = new Uint8Array(RESUME_TOKEN_ENTROPY_BYTES);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${crypto.randomUUID()}.${suffix}`;
}

export class SessionDelegateService implements ISessionDelegateService {
  private readonly pathSafety: ISessionPathSafety;

  constructor(private readonly deps: ISessionDelegateServiceDeps) {
    this.pathSafety = deps.pathSafety ?? defaultSessionPathSafety;
  }

  /** Absolute path of the brief for a trace. */
  briefPathFor(traceId: string): string {
    return join(this.deps.sessionDir, traceId, BRIEF_FILE);
  }

  async prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief> {
    // Model must be a resolved provider:model string — model_size is not accepted
    if (input.model && !input.model.includes(":")) {
      throw new Error(
        `model must be pre-resolved provider:model string, got "${input.model}"`,
      );
    }

    const artifactRef = this.pathSafety.normalize(input.artifactRef);
    const permittedPaths = input.permittedPaths.map((p) => this.pathSafety.normalize(p));
    if (input.contextCardRef !== undefined) {
      this.pathSafety.normalize(input.contextCardRef);
    }

    const deadline = input.deadline ??
      new Date(this.deps.clock.now().getTime() + SESSION_DEFAULT_DEADLINE_HOURS * TIME_MS_PER_HOUR).toISOString();

    const brief = SessionBriefSchema.parse({
      trace_id: input.traceId,
      gate: input.gate,
      tool: input.tool,
      objective: input.objective,
      model: input.model,
      artifact_ref: artifactRef,
      context_card_ref: input.contextCardRef,
      acceptance_criteria: input.acceptanceCriteria ?? [],
      permitted_paths: permittedPaths,
      worktree_path: input.worktreePath,
      token_budget: input.tokenBudget,
      resume_token: generateResumeToken(),
      deadline,
    });

    const briefPath = this.briefPathFor(input.traceId);
    await Deno.mkdir(dirname(briefPath), { recursive: true });
    const tmp = `${briefPath}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(brief, null, 2));
    await Deno.rename(tmp, briefPath);
    return brief;
  }

  resolveLaunch(brief: SessionBrief, mode: SessionLaunchMode): ISessionLaunch {
    return this.deps.registry
      .resolve(brief.tool)
      .buildLaunch(brief, mode, this.briefPathFor(brief.trace_id));
  }

  async resolveHardenedLaunch(
    brief: SessionBrief,
    mode: SessionLaunchMode,
    _config: SessionDelegateConfig,
  ): Promise<IHardenedLaunchResult> {
    const adapter = this.deps.registry.resolve(brief.tool);
    const launch = adapter.buildLaunch(brief, mode, this.briefPathFor(brief.trace_id));

    const minVersion = brief.tool === TOOL_OPENCODE ? MINIMUM_VERSION_OPENCODE : MINIMUM_VERSION_CLAUDE_CODE;
    // Pass the (empty) default deps explicitly: deps is a test-injection seam, so
    // naming it here keeps the optional-params check satisfied without changing
    // behaviour (the default is `{}`).
    const probeResult = await probeDelegateVersion(launch.command, minVersion, {});
    const versionWarning = probeResult.supported ? undefined : probeResult.warning;

    let agentNameMismatch = false;

    if (brief.tool === TOOL_OPENCODE) {
      if (!this.deps.pathResolver) {
        throw new Error(
          "resolveHardenedLaunch requires pathResolver in deps for OpenCode permission config generation",
        );
      }
      const permConfig = await generateOpencodePermissionConfig(
        brief.permitted_paths,
        brief.worktree_path ?? dirname(this.briefPathFor(brief.trace_id)),
        this.deps.pathResolver,
        brief.trace_id,
      );
      launch.configPath = permConfig.configPath;
      agentNameMismatch = permConfig.agentKey !== DOGFOOD_DEVELOPER_IDENTITY_ID;
    } else if (brief.tool === TOOL_CLAUDE_CODE) {
      const flags = deriveClaudeToolFlags(brief);
      launch.args.push(...flags);
    }

    return { launch, agentNameMismatch, versionWarning };
  }

  resolveDelegateEnv(
    config: SessionDelegateConfig,
    tool: SessionTool,
    providerApiKey: string,
  ): Record<string, string> {
    if (!config.provider) return {};

    const { name, base_url } = config.provider;

    if (name === PROVIDER_OPENROUTER) {
      if (tool === TOOL_OPENCODE) {
        return { OPENROUTER_API_KEY: providerApiKey };
      }
      if (tool === TOOL_CLAUDE_CODE) {
        return {
          ANTHROPIC_BASE_URL: base_url ?? "https://openrouter.ai/api",
          ANTHROPIC_AUTH_TOKEN: providerApiKey,
          ANTHROPIC_API_KEY: "",
        };
      }
      return {};
    }

    if (name === PROVIDER_ANTHROPIC) {
      return { ANTHROPIC_API_KEY: providerApiKey };
    }

    if (name === PROVIDER_OLLAMA) {
      return {};
    }

    return {};
  }
}
