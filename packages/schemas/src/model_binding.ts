/**
 * @module ModelBinding
 * @path packages/schemas/src/model_binding.ts
 * @description Shared schemas and run contracts for flow step model bindings.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [packages/schemas/src/config.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import { z } from "zod";
import { EffortDeclarationSchema, ThinkingDeclarationSchema } from "./model_intent.ts";
import { SessionToolSchema } from "./session_delegate.ts";
import type { SessionTool } from "./session_delegate.ts";
import type { EffortDeclaration, ThinkingDeclaration } from "./model_intent.ts";

export type BindingTransport = "cloud" | "local";
export type BindingInterface = "api" | "cli";
export type BindingLayer = "flow" | "config" | "overlay" | "run" | "cli";
export type BindingStepKind = "agent" | "gate" | "judge";
export type BindingField =
  | "service"
  | "model_provider"
  | "model"
  | "service_model_id"
  | "transport"
  | "interface"
  | "effort"
  | "thinking";
export type ModelCapability = "native_tools" | "thinking" | "effort";
export type PinReason =
  | "provider-qualification"
  | "wire-compat-regression"
  | "pricing-table"
  | "capability-gate"
  | "compliance";

export type BindingIssueCode =
  | "overlay_invalid"
  | "ambiguous_selector"
  | "unknown_model"
  | "unknown_service"
  | "service_does_not_serve_model"
  | "no_service_for_constraints"
  | "capability_missing"
  | "interface_unsupported"
  | "key_missing"
  | "optin_missing"
  | "endpoint_invalid"
  | "local_host_not_private"
  | "host_not_allowed"
  | "needs_restart"
  | "pricing_unavailable"
  | "pinned"
  | "lock_mismatch";

export interface IBindingStepRef {
  flowId: string;
  stepId: string;
  agentRole: string;
  kind: BindingStepKind;
  /** The judge this ref stands for, for `kind: "judge"`. It keys the `judge:<id>` selector. */
  judgeId?: string;
  strategy?: string;
  nativeTools: boolean;
}

export interface IBindingIssue {
  code: BindingIssueCode;
  selector?: string;
  flowId?: string;
  stepId?: string;
  detail: string;
}

export type IBindingFieldSource = {
  layer: BindingLayer;
  selector: string;
  pin_kept?: { skipped_selector: string; skipped_layer: BindingLayer };
};

export interface IResolvedBinding {
  service: string;
  model_provider: string;
  model: string;
  service_model_id: string;
  transport: BindingTransport;
  interface: BindingInterface;
  adapter: string;
  profile?: string;
  endpoint?: string;
  allow_insecure_loopback?: boolean;
  /** A self-hosted service states whether it honors an explicit tool_choice. */
  supports_tool_choice?: boolean;
  tool?: SessionTool;
  effort?: EffortDeclaration;
  thinking?: ThinkingDeclaration;
  sources: Partial<Record<BindingField, IBindingFieldSource>>;
  fingerprint: string;
}

export type BindingOutcome = { kind: "bound"; binding: IResolvedBinding } | { kind: "unbound" };

export interface IBindingSpec {
  service?: string;
  model_provider?: string;
  model?: string;
  service_model_id?: string;
  transport?: BindingTransport;
  interface?: BindingInterface;
  effort?: EffortDeclaration;
  thinking?: ThinkingDeclaration;
}

export type PinnableBindingField = Exclude<BindingField, "effort" | "thinking">;

export interface IStepPin {
  fields: PinnableBindingField[];
  reason: PinReason;
  note?: string;
}

export interface ICatalogModel {
  model_provider: string;
  context_window?: number;
  capabilities?: ModelCapability[];
}

export interface ICatalogService {
  adapter: string;
  profile?: string;
  endpoint?: string;
  allow_insecure_loopback?: boolean;
  supports_tool_choice?: boolean;
  transport: BindingTransport;
  interface: BindingInterface;
  key_env?: string;
  requires_optin?: string;
  tool?: SessionTool;
  serves: Record<string, string>;
  daily_cost_cap_usd?: number;
}

export interface IBindingCatalog {
  models: Record<string, ICatalogModel>;
  services: Record<string, ICatalogService>;
  preferences: Record<string, string[]>;
}

export interface IBindingLayers {
  entries: readonly { layer: BindingLayer; selector: string; spec: IBindingSpec }[];
  catalog: IBindingCatalog;
  overlaySha256: readonly string[];
  operatorLayersPresent: boolean;
  /** The current `config.ai` default canonical model id (e.g. `openai/gpt-6-luna`),
   *  when the projection is unique. Transport/interface-only bindings start from it. */
  configDefaultModel?: string;
}

export interface IBindingRunSnapshot {
  traceId: string;
  flowId: string;
  layers: IBindingLayers;
  bindings: ReadonlyMap<string, BindingOutcome>;
  issues: readonly IBindingIssue[];
  /** True when an operator binding layer exists and the run shadows EXA_LLM_*.
   *  Step 7 records it in the lock. Here it is the in-memory run-level flag. */
  envIgnored: boolean;
  lock?: { path: string; sha256: string };
  /** True when an operator binding layer exists for this run (config [bindings], daemon
   *  overlays or per-run overlays/binds). Every bound provider in the run uses this mode
   *  for its cost admission (Step 8). */
  globalBudgetMode?: boolean;
}

/** Gate-judge binding context for a flow gate evaluation.
 *  It holds the step ref and the immutable run snapshot.
 *  The step carries kind "gate", the step id and its judge role.
 *  Non-flow gate callers omit it and keep the boot provider. */
export interface IBindingGateContext {
  stepRef: IBindingStepRef;
  snapshot: IBindingRunSnapshot;
}

export const BINDING_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const CANONICAL_MODEL_PATTERN = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9._:\-]+$/;
export const SERVICE_MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@\-]+$/;
export const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const BINDING_SELECTOR_PATTERN =
  /^(default|judge|judge:[A-Za-z0-9._-]+|role:[a-z0-9-]+|flow:[A-Za-z0-9._*-]+(\/step:[A-Za-z0-9._*-]+)?)$/;

export const BindingTransportSchema = z.enum(["cloud", "local"]);
export const BindingInterfaceSchema = z.enum(["api", "cli"]);
export const BindingFieldSchema = z.enum([
  "service",
  "model_provider",
  "model",
  "service_model_id",
  "transport",
  "interface",
  "effort",
  "thinking",
]);
export const BindingSpecSchema = z.object({
  service: z.string().regex(BINDING_ID_PATTERN).optional(),
  model_provider: z.string().regex(BINDING_ID_PATTERN).optional(),
  model: z.string().regex(CANONICAL_MODEL_PATTERN).optional(),
  service_model_id: z.string().regex(SERVICE_MODEL_ID_PATTERN).optional(),
  transport: BindingTransportSchema.optional(),
  interface: BindingInterfaceSchema.optional(),
  effort: EffortDeclarationSchema.optional(),
  thinking: ThinkingDeclarationSchema.optional(),
}).strict();
export const BindingsTableSchema = z.record(z.string().regex(BINDING_SELECTOR_PATTERN), BindingSpecSchema);
export const ModelCapabilitySchema = z.enum(["native_tools", "thinking", "effort"]);
export const CatalogModelSchema = z.object({
  model_provider: z.string().regex(BINDING_ID_PATTERN),
  context_window: z.number().int().positive().optional(),
  capabilities: z.array(ModelCapabilitySchema).optional(),
}).strict();
export const CatalogServiceSchema = z.object({
  adapter: z.string().min(1),
  profile: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  allow_insecure_loopback: z.boolean().optional(),
  supports_tool_choice: z.boolean().optional(),
  transport: BindingTransportSchema,
  interface: BindingInterfaceSchema,
  key_env: z.string().regex(ENV_VAR_NAME_PATTERN).optional(),
  requires_optin: z.string().regex(ENV_VAR_NAME_PATTERN).optional(),
  tool: SessionToolSchema.optional(),
  serves: z.record(z.string(), z.string().min(1)),
  daily_cost_cap_usd: z.number().positive().optional(),
}).strict();
export const BindingCatalogSchema = z.object({
  models: z.record(z.string().regex(CANONICAL_MODEL_PATTERN), CatalogModelSchema).optional(),
  services: z.record(z.string().regex(BINDING_ID_PATTERN), CatalogServiceSchema).optional(),
  preferences: z.record(
    z.string().regex(BINDING_ID_PATTERN),
    z.array(z.string().regex(BINDING_ID_PATTERN)).min(1),
  ).optional(),
}).strict();
export const BINDING_OVERLAY_SCHEMA_VERSION = 1;
export const BindingOverlaySchema = z.object({
  schema: z.literal(BINDING_OVERLAY_SCHEMA_VERSION),
  catalog: BindingCatalogSchema.optional(),
  bindings: BindingsTableSchema.optional(),
}).strict();
export const PinReasonSchema = z.enum([
  "provider-qualification",
  "wire-compat-regression",
  "pricing-table",
  "capability-gate",
  "compliance",
]);
export const StepPinSchema = z.object({
  fields: z.array(
    BindingFieldSchema.exclude([
      BindingFieldSchema.enum.effort,
      BindingFieldSchema.enum.thinking,
    ]),
  ).min(1),
  reason: PinReasonSchema,
  note: z.string().max(200).optional(),
}).strict();
export const BindOneOffSchema = z.array(
  z.object({
    selector: z.string().regex(BINDING_SELECTOR_PATTERN),
    spec: BindingSpecSchema,
  }).strict(),
);
export const BindingLayerSchema = z.enum(["flow", "config", "overlay", "run", "cli"]);
export const BindingFieldSourceSchema = z.object({
  layer: BindingLayerSchema,
  selector: z.string().regex(BINDING_SELECTOR_PATTERN),
  pin_kept: z.object({
    skipped_selector: z.string(),
    skipped_layer: BindingLayerSchema,
  }).strict().optional(),
}).strict();
export const ResolvedBindingSchema = z.object({
  service: z.string().regex(BINDING_ID_PATTERN),
  model_provider: z.string().regex(BINDING_ID_PATTERN),
  model: z.string().min(1),
  service_model_id: z.string().regex(SERVICE_MODEL_ID_PATTERN),
  transport: BindingTransportSchema,
  interface: BindingInterfaceSchema,
  adapter: z.string().min(1),
  profile: z.string().optional(),
  endpoint: z.string().url().optional(),
  allow_insecure_loopback: z.boolean().optional(),
  supports_tool_choice: z.boolean().optional(),
  tool: SessionToolSchema.optional(),
  effort: EffortDeclarationSchema.optional(),
  thinking: ThinkingDeclarationSchema.optional(),
  sources: z.record(z.string().pipe(BindingFieldSchema), BindingFieldSourceSchema),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const BindingOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bound"), binding: ResolvedBindingSchema }).strict(),
  z.object({ kind: z.literal("unbound") }).strict(),
]);
export const BindingLockSchema = z.object({
  schema: z.literal(BINDING_OVERLAY_SCHEMA_VERSION),
  trace_id: z.string().uuid(),
  flow_id: z.string(),
  created_at: z.string().datetime(),
  flow_content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pin_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  catalog_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  step_ids: z.array(z.string()),
  config_checksum: z.string(),
  overlay_sha256: z.array(z.string()),
  run_overlays: z.number().int().nonnegative(),
  env_ignored: z.boolean(),
  hosts: z.array(z.string()),
  entries: z.array(
    z.object({
      step_id: z.string(),
      agent_role: z.string(),
      outcome: BindingOutcomeSchema,
    }).strict(),
  ),
}).strict();
export const RunBindingsFileSchema = z.object({
  schema: z.literal(BINDING_OVERLAY_SCHEMA_VERSION),
  trace_id: z.string().uuid(),
  request_path: z.string().min(1),
  request_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime(),
  overlays: z.array(
    z.object({
      source_path: z.string(),
      sha256: z.string(),
      overlay: BindingOverlaySchema,
    }).strict(),
  ),
  binds: BindOneOffSchema,
  locked: BindingLockSchema.optional(),
  /** SHA-256 of the lock file bytes that exactl read. The daemon derives it again before replay. */
  locked_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export type IRunBindingsFile = z.infer<typeof RunBindingsFileSchema>;
