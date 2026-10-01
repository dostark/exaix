/**
 * @module BindingTypes
 * @path packages/ai/src/bindings/binding_types.ts
 * @description AI-owned binding errors and provider target contracts.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import type { IBindingIssue, IResolvedBinding } from "@exaix/schemas";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import type { IModelProvider } from "../types.ts";

export type {
  BindingField,
  BindingLayer,
  BindingOutcome,
  IBindingCatalog,
  IBindingIssue,
  IBindingLayers,
  IBindingRunSnapshot,
  IBindingSpec,
  IBindingStepRef,
  IResolvedBinding,
  IStepPin,
} from "@exaix/schemas";

export interface IBindingEnvProbe {
  hasKey(name: string): boolean;
  hasOptIn(name: string): boolean;
}

export interface IBoundStepProvider {
  kind: typeof BOUND_TARGET_KIND_PROVIDER;
  binding: IResolvedBinding;
  provider: IModelProvider;
}

/** A session-tool delegate target (adapter `cli-delegate`): the strategy cli_delegate
 *  launch reads `tool` + `service_model_id`, not an `IModelProvider`. */
export interface IBoundSessionTool {
  kind: typeof BOUND_TARGET_KIND_SESSION_TOOL;
  binding: IResolvedBinding;
  tool: SessionTool;
}

export type IBoundStepTarget = IBoundStepProvider | IBoundSessionTool | undefined;

/** The tagged outcome kind for an invalid resolved binding. */
export const BINDING_OUTCOME_INVALID = "invalid" as const;
/** The tagged outcome kind for a resolved, bound step. */
export const BINDING_OUTCOME_BOUND = "bound" as const;
/** The tagged outcome kind for a step no layer entry touches (unbound → boot provider). */
export const BINDING_OUTCOME_UNBOUND = "unbound" as const;

/** Discriminant values of the bound-step target union (`IBoundStepTarget`). */
export const BOUND_TARGET_KIND_PROVIDER = "provider" as const;
export const BOUND_TARGET_KIND_SESSION_TOOL = "session-tool" as const;

/** Discriminant values of `IBindingStepRef.kind`. */
export const STEP_KIND_AGENT = "agent" as const;
export const STEP_KIND_GATE = "gate" as const;

/** Adapter name of the cli-delegate session-tool services. */
export const ADAPTER_CLI_DELEGATE = "cli-delegate" as const;

/** Production key probe. It reads a non-empty variable, else a non-empty credential-store entry.
 *  `keyVersion` is a digest that only keys the provider pool. It never leaves the process. */
export function createProductionBindingEnvProbe(
  env: Pick<typeof Deno.env, "get">,
  store: { get(name: string): Promise<string | null> },
): {
  hasKey(name: string): Promise<boolean>;
  hasOptIn(name: string): Promise<boolean> | boolean;
  keyVersion(name: string): Promise<string>;
} {
  return {
    hasKey: async (name) => {
      const envValue = env.get(name);
      if (envValue && envValue.length > 0) return true;
      const stored = await store.get(name);
      return Boolean(stored && stored.length > 0);
    },
    hasOptIn: (name) => env.get(name) === "1",
    keyVersion: async (name) => {
      const value = env.get(name) || await store.get(name) || "";
      if (value.length === 0) return "";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}

export class BindingIncompatibleError extends Error {
  constructor(public readonly issues: readonly IBindingIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; "));
    this.name = "BindingIncompatibleError";
  }
}
