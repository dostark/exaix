/**
 * @module BindingTypes
 * @path packages/ai/src/bindings/binding_types.ts
 * @description AI-owned binding errors and provider target contracts.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import type { IBindingIssue, IResolvedBinding } from "@exaix/schemas";
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
  kind: "provider";
  binding: IResolvedBinding;
  provider: IModelProvider;
}

/** The tagged outcome kind for an invalid resolved binding. */
export const BINDING_OUTCOME_INVALID = "invalid" as const;

/** Production key/opt-in probe: a non-empty variable, else a non-empty credential-store entry. */
export function createProductionBindingEnvProbe(
  env: Pick<typeof Deno.env, "get">,
  store: { get(name: string): Promise<string | null> },
): { hasKey(name: string): Promise<boolean>; hasOptIn(name: string): Promise<boolean> | boolean } {
  return {
    hasKey: async (name) => {
      const envValue = env.get(name);
      if (envValue && envValue.length > 0) return true;
      const stored = await store.get(name);
      return Boolean(stored && stored.length > 0);
    },
    hasOptIn: (name) => env.get(name) === "1",
  };
}

export class BindingIncompatibleError extends Error {
  constructor(public readonly issues: readonly IBindingIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; "));
    this.name = "BindingIncompatibleError";
  }
}
