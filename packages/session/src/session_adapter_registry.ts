/**
 * @module SessionAdapterRegistry
 * @path packages/session/src/session_adapter_registry.ts
 * @description Strategy-pattern registry of per-tool session adapters (mirrors the
 *   provider/factory pattern). One configurable BuiltinSessionAdapter backs all five
 *   shipped tools; Codex is headless-only, Claude Code/OpenCode also support
 *   supervised launch, and IDE tools are advisory-only. Launch construction is
 *   hardened per GAP-4: bare binary + discrete argv, token-budget env only.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/session/src/i_session_adapter.ts, packages/schemas/src/session_delegate.ts]
 */

import { dirname } from "@std/path";
import {
  SESSION_BIN_CLAUDE_CODE,
  SESSION_BIN_CODEX,
  SESSION_BIN_CURSOR,
  SESSION_BIN_OPENCODE,
  SESSION_BIN_VSCODE,
  SESSION_ENV_MAX_INPUT_TOKENS,
  SESSION_ENV_MAX_OUTPUT_TOKENS,
  SESSION_ENV_MAX_TOTAL_TOKENS,
  SESSION_FLAG_BRIEF,
  SESSION_FLAG_FORMAT,
  SESSION_FLAG_JSON,
  SESSION_FLAG_MAX_TOTAL_TOKENS,
  SESSION_FLAG_MODEL,
  SESSION_FLAG_OUTPUT_FORMAT,
  SESSION_FLAG_PRINT,
  SESSION_FLAG_SANDBOX,
  SESSION_OUTPUT_FORMAT_JSON,
  SESSION_SANDBOX_READ_ONLY,
  SESSION_SUBCMD_EXEC,
  SESSION_SUBCMD_RUN,
} from "@exaix/core/types";
import {
  SESSION_GATE_DECISIONS,
  SessionLaunchModeSchema,
  SessionReturnSchema,
} from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionLaunchMode, SessionReturn, SessionTool } from "@exaix/schemas/session_delegate.ts";
import type { ISessionAdapter, ISessionLaunch } from "./i_session_adapter.ts";

/** Build the additive, non-secret token-budget environment for a launch. */
function budgetEnv(brief: SessionBrief): Record<string, string> {
  return {
    [SESSION_ENV_MAX_INPUT_TOKENS]: String(brief.token_budget.max_input_tokens),
    [SESSION_ENV_MAX_OUTPUT_TOKENS]: String(brief.token_budget.max_output_tokens),
    [SESSION_ENV_MAX_TOTAL_TOKENS]: String(brief.token_budget.max_total_tokens),
  };
}

/** The `claude` and `codex` CLIs reject a provider-prefixed model id, unlike the brief's required `provider:model` form. */
function stripProviderPrefix(model: string): string {
  return model.slice(model.indexOf(":") + 1);
}

/** A single configurable adapter covering every built-in tool. `supportsSupervised` also selects the argv shape: CLI tools pass the brief + budget flags, IDE tools open the workspace folder. The brief's free-text fields are never placed on the command line (GAP-4) — only the brief file path, numeric budget, and cwd. */
export class BuiltinSessionAdapter implements ISessionAdapter {
  constructor(
    readonly tool: SessionTool,
    private readonly bin: string,
    readonly supportsSupervised: boolean,
    readonly supportsHeadless: boolean,
  ) {}

  buildLaunch(brief: SessionBrief, mode: SessionLaunchMode, briefPath: string): ISessionLaunch {
    if (mode === SessionLaunchModeSchema.enum.supervised && !this.supportsSupervised) {
      throw new Error(`Session tool '${this.tool}' does not support supervised launch`);
    }
    if (mode === SessionLaunchModeSchema.enum.headless) {
      if (!this.supportsHeadless) {
        throw new Error(`Session tool '${this.tool}' does not support headless launch`);
      }
      if (this.tool === "claude-code") {
        const claudeModelFlag = brief.model ? [SESSION_FLAG_MODEL, stripProviderPrefix(brief.model)] : [];
        return {
          command: this.bin,
          args: [
            SESSION_FLAG_PRINT,
            brief.objective,
            SESSION_FLAG_OUTPUT_FORMAT,
            SESSION_OUTPUT_FORMAT_JSON,
            ...claudeModelFlag,
          ],
          cwd: brief.worktree_path ?? dirname(briefPath),
          env: budgetEnv(brief),
        };
      }
      if (this.tool === "codex") {
        const codexModelFlag = brief.model ? [SESSION_FLAG_MODEL, stripProviderPrefix(brief.model)] : [];
        // GAP-16 (Phase 167 post-gap-analysis): the base launch is never fully sandbox-unconstrained, independent of harden_permissions — resolveHardenedLaunch widens this to workspace-write only for the code_changes gate when harden_permissions=true (see SessionDelegateService.resolveHardenedLaunch).
        return {
          command: this.bin,
          args: [
            SESSION_SUBCMD_EXEC,
            SESSION_FLAG_JSON,
            ...codexModelFlag,
            SESSION_FLAG_SANDBOX,
            SESSION_SANDBOX_READ_ONLY,
            brief.objective,
          ],
          cwd: brief.worktree_path ?? dirname(briefPath),
          env: budgetEnv(brief),
        };
      }
      // opencode headless — opencode run supports --format json, not --output-format Phase 150 LIVE-RT: prepareBrief requires provider:model (colon) but opencode --model uses provider/model (slash). Convert here. Also pass --dir so opencode resolves relative paths against the worktree, not the project's git root (which is the portal checkout).
      const opencodeWorkDir = brief.worktree_path ?? dirname(briefPath);
      const opencodeModelFlag = brief.model ? [SESSION_FLAG_MODEL, brief.model.replace(":", "/")] : [];
      const opencodeDirFlag = ["--dir", opencodeWorkDir];
      return {
        command: this.bin,
        args: [
          SESSION_SUBCMD_RUN,
          SESSION_FLAG_FORMAT,
          SESSION_OUTPUT_FORMAT_JSON,
          ...opencodeDirFlag,
          ...opencodeModelFlag,
          brief.objective,
        ],
        cwd: opencodeWorkDir,
        env: budgetEnv(brief),
      };
    }
    const cwd = brief.worktree_path ?? dirname(briefPath);
    const args = this.supportsSupervised
      ? [
        SESSION_FLAG_BRIEF,
        briefPath,
        SESSION_FLAG_MAX_TOTAL_TOKENS,
        String(brief.token_budget.max_total_tokens),
      ]
      : [cwd];
    return { command: this.bin, args, cwd, env: budgetEnv(brief) };
  }

  synthesizeReturn(brief: SessionBrief, pathsTouched: string[]): SessionReturn {
    const decision = SESSION_GATE_DECISIONS[brief.gate][0];
    return SessionReturnSchema.parse({
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision,
      summary: `Synthesized ${decision} return for ${this.tool} at the ${brief.gate} gate.`,
      paths_touched: pathsTouched,
      token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });
  }
}

/** Strategy registry resolving a SessionTool to its launch adapter. */
export class SessionAdapterRegistry {
  private readonly adapters = new Map<SessionTool, ISessionAdapter>();

  register(adapter: ISessionAdapter): void {
    this.adapters.set(adapter.tool, adapter);
  }

  has(tool: SessionTool): boolean {
    return this.adapters.has(tool);
  }

  list(): SessionTool[] {
    return [...this.adapters.keys()];
  }

  resolve(tool: SessionTool): ISessionAdapter {
    const adapter = this.adapters.get(tool);
    if (!adapter) {
      throw new Error(`No session adapter registered for tool '${tool}'`);
    }
    return adapter;
  }
}

/** Registry pre-loaded with the five shipped adapters. */
export function createDefaultSessionAdapterRegistry(): SessionAdapterRegistry {
  const registry = new SessionAdapterRegistry();
  registry.register(new BuiltinSessionAdapter("claude-code", SESSION_BIN_CLAUDE_CODE, true, true));
  registry.register(new BuiltinSessionAdapter("opencode", SESSION_BIN_OPENCODE, true, true));
  registry.register(new BuiltinSessionAdapter("codex", SESSION_BIN_CODEX, false, true));
  registry.register(new BuiltinSessionAdapter("cursor", SESSION_BIN_CURSOR, false, false));
  registry.register(new BuiltinSessionAdapter("vscode", SESSION_BIN_VSCODE, false, false));
  return registry;
}
