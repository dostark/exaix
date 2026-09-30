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

export class BindingIncompatibleError extends Error {
  constructor(public readonly issues: readonly IBindingIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; "));
    this.name = "BindingIncompatibleError";
  }
}
