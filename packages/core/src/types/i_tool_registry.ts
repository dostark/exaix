/**
 * @module IToolRegistry
 * @path packages/core/src/types/i_tool_registry.ts
 * @description Defines the interface for the ToolRegistry service.
 * @architectural-layer Interfaces
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/schemas/src/aci_doc.ts"]
 */
import type { JSONValue } from "@exaix/core";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { AciDoc } from "@exaix/schemas/aci_doc.ts";
import type { ToolSideEffectScope } from "./enums.ts";

export interface IToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: IToolParameterSchema;
  properties?: Record<string, IToolParameterSchema>;
  required?: string[];
}

export interface IToolSchema {
  type: "object";
  properties: Record<string, IToolParameterSchema>;
  required?: string[];
}

export interface ITool {
  name: string;
  description: string;
  parameters: IToolSchema;
  /**
   * Provider-native tool selection description. When set, used by
   * buildNativeToolDefinitions() instead of `description` for the
   * IToolDefinition passed to the LLM provider's native tool UI.
   * Should include behavioral-preference signals (e.g. "PREFERRED for
   * targeted edits") that are invisible in the TOML-block prose path
   * but critical when the model chooses from a tool list (PGAP-1).
   */
  nativeDescription?: string;
  /**
   * Bounded ACI (Agent-Computer Interface / Poka-Yoke) tool guidance: summary,
   * when/when-not-to-use, a worked example, and an anti-example (Phase 112).
   * Trusted-local-source-only — only `createCoreToolSchemas()` populates this in
   * production. Optional for compatibility with third-party/test `ITool` fixtures.
   */
  aciDoc?: AciDoc;
  /**
   * What state this tool may modify (Phase 112). Compatibility-safe optional field
   * mirroring `IToolManifestEntry.side_effect_scope`; `AciDoc` carries no narrative
   * side-effect text so the two representations cannot disagree.
   */
  sideEffectScope?: ToolSideEffectScope;
}

export interface IToolResult {
  success: boolean;
  /** Structured payload validated at runtime against ToolResultEnvelopeSchema in @exaix/schemas. */
  data?: JSONValue;
  /** Required when success=false by the package-owned runtime envelope contract. */
  error?: string;
}

export interface IToolRegistry {
  getTools(): ITool[];
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult>;
  /** The resolved, absolute directory every tool call is rooted at (e.g. a plan's git worktree). */
  getBaseDir(): string;
  /**
   * Sets the per-blueprint HITL rules (`hitl.require_secondary_approval`) the HITL
   * middleware evaluates against for every subsequent `execute()` call, until this is
   * called again. Called by `AgentOrchestrator.executeStep()` once it has loaded the
   * blueprint about to run, so a blueprint's own approval rules gate tool calls routed
   * through this registry the same way `DynamicStepExecutor` already honors
   * `identity.hitl?.require_secondary_approval` for its own tool-execution path
   * (Phase 154 Step 3). Optional so existing `IToolRegistry` implementors (test mocks)
   * are unaffected; a caller that doesn't implement it simply keeps its prior rules.
   */
  setHitlBlueprintRules?(rules: HitlRule[]): void;
}
