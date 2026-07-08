/**
 * @module ConfigTools
 * @path packages-team/mcp-server/config_tools.ts
 * @description MCP tools for reading and validating Exaix configuration — get,
 *   validate, diff, get-provenance, set (staging), and apply operations.
 * @architectural-layer MCP
 * @ungrounded
 * @related-files [packages-team/mcp-server/tools.ts, packages/mcp/src/manifest.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { type JSONValue, MCP_CONTENT_TYPE_STRUCTURED_DATA, ToolErrorCode } from "@exaix/core";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { ConfigPathBlockedError, createConfigAdapter, resolveTier } from "@exaix/core/config";
import type { ConfigValue, IConfigAdapter } from "@exaix/core/config";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import { join } from "@std/path";

function serializeStructuredData(value: object): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

// ── Staging state for ConfigSet/Apply (Step 6) ──────────────────────────
interface IPendingChange {
  key: string;
  value: JSONValue;
  timeoutId: ReturnType<typeof setTimeout>;
}

const pendingChanges: IPendingChange[] = [];
const AUTO_DISCARD_TIMEOUT_MS = 60_000;
const CONFIG_APPLY_STATUS_APPLIED = "applied";
const CONFIG_APPLY_STATUS_ERROR = "error";
/** Tool-name label passed to formatToolError for ConfigSetTool error responses. */
const CONFIG_SET_TOOL_NAME = "config_set";

function addPendingChange(key: string, value: JSONValue): void {
  const timeoutId = setTimeout(() => {
    const idx = pendingChanges.findIndex((c) => c.key === key && c.value === value);
    if (idx >= 0) pendingChanges.splice(idx, 1);
  }, AUTO_DISCARD_TIMEOUT_MS);
  pendingChanges.push({ key, value, timeoutId });
}

function drainPendingChanges(): Array<{ key: string; value: JSONValue }> {
  const drained: Array<{ key: string; value: JSONValue }> = [];
  for (const change of pendingChanges.splice(0)) {
    clearTimeout(change.timeoutId);
    drained.push({ key: change.key, value: change.value });
  }
  return drained;
}

/** Exposed for tests only — resets the staging queue. */
export function _resetPendingChangesForTest(): void {
  for (const change of pendingChanges.splice(0)) {
    clearTimeout(change.timeoutId);
  }
}

/** Exposed for tests only — drains and returns the staged changes (clears timers). */
export function _drainPendingChangesForTest(): Array<{ key: string; value: JSONValue }> {
  return drainPendingChanges();
}

function classifyConfigError(error: Error | string | JSONValue): ToolErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("not found") || message.includes("no such")) return ToolErrorCode.NOT_FOUND;
  if (message.includes("invalid") || message.includes("required") || message.includes("must")) {
    return ToolErrorCode.INVALID_ARGS;
  }
  return ToolErrorCode.EXECUTION_FAILED;
}

/**
 * Read-only MCP tool for reading a single config key.
 */
export class ConfigGetTool extends ToolHandler {
  private adapter: IConfigAdapter | null = null;

  constructor(
    context: ICliApplicationContext,
    permissions?: IPortalPermissionsChecker,
    logger?: IEventLogger,
  ) {
    super(context, permissions, logger);
  }

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      this.adapter = createConfigAdapter(configDbPath);
    }
    return this.adapter;
  }

  execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const key = args.key as string;
    if (!key) {
      return Promise.resolve(this.formatToolError(
        "config_get",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        ToolErrorCode.INVALID_ARGS,
        "Missing required argument: key",
        {},
      ));
    }

    try {
      const value = this.getAdapter().get(key);
      if (value === undefined) {
        return Promise.resolve(this.formatToolError(
          "config_get",
          DEFAULT_MCP_IDENTITY_ID,
          DEFAULT_MCP_IDENTITY_ID,
          ToolErrorCode.NOT_FOUND,
          `Config key not found: ${key}`,
          { key },
        ));
      }

      return Promise.resolve({
        content: [
          { type: "text", text: JSON.stringify({ key, value }, null, 2) },
          { type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data: serializeStructuredData({ key, value }) },
        ],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Promise.resolve(this.formatToolError(
        "config_get",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        { key },
      ));
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_get",
      description:
        "Read the current effective value of a single Exaix configuration key. Read-only; safe for dynamic execution. Use to inspect current config without starting the daemon. Returns the resolved value (override → registry default).",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Configuration key path (e.g. ai.timeout_ms)",
          },
        },
        required: ["key"],
      },
    };
  }
}

/**
 * Read-only MCP tool for validating all config keys against registry metadata.
 */
export class ConfigValidateTool extends ToolHandler {
  private adapter: IConfigAdapter | null = null;

  constructor(
    context: ICliApplicationContext,
    permissions?: IPortalPermissionsChecker,
    logger?: IEventLogger,
  ) {
    super(context, permissions, logger);
  }

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      this.adapter = createConfigAdapter(configDbPath);
    }
    return this.adapter;
  }

  execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    try {
      const report = this.getAdapter().validate();
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: report.valid
              ? "All config keys are valid."
              : `Validation found ${report.issues.length} issue(s):\n${
                report.issues.map((i) => `  ${i.path}: ${i.message} (${i.code})`).join("\n")
              }`,
          },
          { type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data: serializeStructuredData(report) },
        ],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Promise.resolve(this.formatToolError(
        "config_validate",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        {},
      ));
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_validate",
      description:
        "Validate all registered configuration keys against their registry metadata (type, min, max, enum). Read-only; safe for dynamic execution. Use to confirm config is well-formed before applying changes or starting the daemon. Returns a validation report with any constraint violations.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };
  }
}

/**
 * Read-only MCP tool for comparing effective values against registry defaults.
 */
export class ConfigDiffTool extends ToolHandler {
  private adapter: IConfigAdapter | null = null;

  constructor(
    context: ICliApplicationContext,
    permissions?: IPortalPermissionsChecker,
    logger?: IEventLogger,
  ) {
    super(context, permissions, logger);
  }

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      this.adapter = createConfigAdapter(configDbPath);
    }
    return this.adapter;
  }

  execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    try {
      const diff = this.getAdapter().diff();
      return Promise.resolve({
        content: [
          { type: "text", text: JSON.stringify(diff, null, 2) },
          { type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data: serializeStructuredData(diff) },
        ],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Promise.resolve(this.formatToolError(
        "config_diff",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        {},
      ));
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_diff",
      description:
        "Compare effective configuration values against registry defaults. Read-only; safe for dynamic execution. Returns overridden, added, and missing keys. Use to see what config has been changed from defaults.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };
  }
}

/**
 * MCP tool for staging a config change (set). Writes are NOT applied until
 * ConfigApplyTool is called. Requires human approval.
 */
export class ConfigSetTool extends ToolHandler {
  private adapter: IConfigAdapter | null = null;

  constructor(
    context: ICliApplicationContext,
    permissions?: IPortalPermissionsChecker,
    logger?: IEventLogger,
  ) {
    super(context, permissions, logger);
  }

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      this.adapter = createConfigAdapter(configDbPath);
    }
    return this.adapter;
  }

  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const key = args.key as string;
    const value = args.value;

    if (!key) {
      return this.formatToolError(
        CONFIG_SET_TOOL_NAME,
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        ToolErrorCode.INVALID_ARGS,
        "Missing required argument: key",
        {},
      );
    }

    try {
      // Validate the key exists in registry
      const validationKey = this.getAdapter().resolveValidationKey(key);
      if (validationKey === undefined) {
        return this.formatToolError(
          CONFIG_SET_TOOL_NAME,
          DEFAULT_MCP_IDENTITY_ID,
          DEFAULT_MCP_IDENTITY_ID,
          ToolErrorCode.INVALID_ARGS,
          `Unknown config key: ${key}`,
          { key },
        );
      }

      // Phase 138 Step 2: refuse writes to deny-permanently blocked paths.
      if (this.getAdapter().isPathBlocked(key)) {
        const reason = this.getAdapter().getBlockReason(key);
        return this.formatToolError(
          CONFIG_SET_TOOL_NAME,
          DEFAULT_MCP_IDENTITY_ID,
          DEFAULT_MCP_IDENTITY_ID,
          ToolErrorCode.PERMISSION_DENIED,
          new ConfigPathBlockedError(key, reason).message,
          { key },
        );
      }

      // Phase 138 Step 1: route by the key's three-tier authorization tier.
      const tier = resolveTier(validationKey);

      if (tier === "safe") {
        // Auto-approve: write through immediately, no staging.
        await this.getAdapter().set(key, value as ConfigValue);
        return {
          content: [
            { type: "text", text: `Applied (safe tier): ${key} → ${JSON.stringify(value)}.` },
          ],
        };
      }

      // leaf + dangerous: stage for later apply (requires human approval).
      addPendingChange(key, value);
      const requiresConfirmation = tier === "dangerous";
      return {
        content: [
          {
            type: "text",
            text: `Staged: ${key} → ${JSON.stringify(value)}. Run exaix_config_apply to activate.` +
              (requiresConfirmation ? " ⚠️ Dangerous change — confirmation required." : ""),
          },
          {
            type: MCP_CONTENT_TYPE_STRUCTURED_DATA,
            data: serializeStructuredData({ key, staged: true, tier, requires_confirmation: requiresConfirmation }),
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        CONFIG_SET_TOOL_NAME,
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        { key },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_set",
      description:
        "Stage a configuration change for later activation. Use to propose a config mutation; the change is held in a per-session pending list and is NOT written until exaix_config_apply is called. Unapplied changes auto-discard after 60 seconds. Requires human approval before execution. Returns the staged key and status.",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Configuration key path (e.g. ai.timeout_ms)",
          },
          value: {
            description: "Value to set (number, string, or boolean)",
          },
        },
        required: ["key", "value"],
      },
    };
  }
}

/**
 * MCP tool for applying all staged config changes. Drains the pending list
 * and calls adapter.set() for each entry. Requires human approval.
 */
export class ConfigApplyTool extends ToolHandler {
  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    try {
      const pending = drainPendingChanges();
      if (pending.length === 0) {
        return {
          content: [{ type: "text", text: "No pending config changes to apply." }],
        };
      }

      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      const adapter = createConfigAdapter(configDbPath);

      // Apply each pending change. set() is async and may reject on value
      // validation (e.g. out-of-bounds) — await it inside the per-key try/catch so
      // failures are recorded as errors instead of escaping as unhandled rejections.
      const results: Array<{ key: string; status: string; error?: string }> = [];
      for (const { key, value } of pending) {
        // Phase 138 Step 2: a key blocked between staging and apply is refused.
        if (adapter.isPathBlocked(key)) {
          results.push({
            key,
            status: CONFIG_APPLY_STATUS_ERROR,
            error: new ConfigPathBlockedError(key, adapter.getBlockReason(key)).message,
          });
          continue;
        }
        try {
          await adapter.set(key, value as (string | number | boolean | null));
          results.push({ key, status: CONFIG_APPLY_STATUS_APPLIED });
        } catch (err) {
          results.push({
            key,
            status: CONFIG_APPLY_STATUS_ERROR,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const applied = results.filter((r) => r.status === CONFIG_APPLY_STATUS_APPLIED).length;
      const failed = results.filter((r) => r.status === CONFIG_APPLY_STATUS_ERROR).length;

      return {
        content: [
          {
            type: "text",
            text: `Applied ${applied} change(s)${failed > 0 ? `, ${failed} failed.` : "."}`,
          },
          { type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data: serializeStructuredData(results) },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        "config_apply",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        {},
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_apply",
      description:
        "Apply all staged configuration changes from exaix_config_set. Use after staging one or more changes to commit them. Drains the pending list and writes each change through the config adapter. Requires human approval before execution. Returns a summary of applied and failed changes.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };
  }
}

/**
 * Read-only MCP tool for tracing a config key's provenance.
 */
export class ConfigGetProvenanceTool extends ToolHandler {
  private adapter: IConfigAdapter | null = null;

  constructor(
    context: ICliApplicationContext,
    permissions?: IPortalPermissionsChecker,
    logger?: IEventLogger,
  ) {
    super(context, permissions, logger);
  }

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const root = this.context.config.getAll().system?.root ?? ".";
      const configDbPath = join(root, ".exa", "config.db");
      this.adapter = createConfigAdapter(configDbPath);
    }
    return this.adapter;
  }

  execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const key = args.key as string;
    if (!key) {
      return Promise.resolve(this.formatToolError(
        "config_get_provenance",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        ToolErrorCode.INVALID_ARGS,
        "Missing required argument: key",
        {},
      ));
    }

    try {
      const provenance = this.getAdapter().getProvenance(key);
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: `Key: ${key}\nSource: ${provenance.source}\nValue: ${JSON.stringify(provenance.value)}${
              provenance.sourceDetail ? `\nDetail: ${provenance.sourceDetail}` : ""
            }`,
          },
          {
            type: MCP_CONTENT_TYPE_STRUCTURED_DATA,
            data: serializeStructuredData({ key, ...provenance }),
          },
        ],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Promise.resolve(this.formatToolError(
        "config_get_provenance",
        DEFAULT_MCP_IDENTITY_ID,
        DEFAULT_MCP_IDENTITY_ID,
        classifyConfigError(error instanceof Error ? error : String(error)),
        msg,
        { key },
      ));
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "exaix_config_get_provenance",
      description:
        "Trace the origin of a configuration key's value — whether it comes from a DB override, registry default, schema default, or bootstrap. Read-only; safe for dynamic execution. Use to explain why a key has its current value or debug unexpected config. Returns provenance source and resolved value.",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Configuration key path (e.g. ai.timeout_ms)",
          },
        },
        required: ["key"],
      },
    };
  }
}
