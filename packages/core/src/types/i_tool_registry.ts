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
  /** When set, used by buildNativeToolDefinitions() instead of `description` for the
   *  LLM provider's native tool UI — include behavioral-preference signals (e.g.
   *  "PREFERRED for targeted edits") that are invisible in the TOML-block prose path. */
  nativeDescription?: string;
  /** Bounded ACI (Agent-Computer Interface / Poka-Yoke) tool guidance. Trusted-local-source-only —
   *  only `createCoreToolSchemas()` populates this in production. */
  aciDoc?: AciDoc;
  /** Mirrors `IToolManifestEntry.side_effect_scope`; `AciDoc` carries no narrative
   *  side-effect text so the two representations cannot disagree. */
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
  /** Sets the per-blueprint HITL rules the HITL middleware evaluates against for every
   *  subsequent `execute()` call, until called again. Optional so existing `IToolRegistry`
   *  implementors (test mocks) are unaffected; an implementor that skips it keeps its prior rules. */
  setHitlBlueprintRules?(rules: HitlRule[]): void;
}
