/**
 * @module BindingReplay
 * @path packages/ai/src/bindings/binding_replay.ts
 * @description Run-lock digests and the `--locked` replay comparison. A replay is accepted
 *   only when the lock's integrity hash, flow content, pins, catalog, step set and every
 *   resolved binding equal the current resolution.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @std/crypto]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts]
 */

import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import type { BindingOutcome, IBindingCatalog, IBindingIssue, IFlow, IRunBindingsFile } from "@exaix/schemas";
import { BindingLockSchema } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";
import { ISSUE_LOCK_MISMATCH } from "./binding_resolver.ts";
import { BINDING_OUTCOME_BOUND } from "./binding_types.ts";

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };
type CanonicalInput = object | string | number | boolean | null | undefined;

export interface IBindingLockDigests {
  flow_content_sha256: string;
  pin_sha256: string;
  catalog_sha256: string;
}

function canonicalize(value: CanonicalInput): CanonicalValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: CanonicalValue } = {};
    for (const [key, item] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value ?? null;
}

/** Key-order-independent JSON, so equal values always hash equal. */
export function canonicalJson(value: CanonicalInput): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return encodeHex(new Uint8Array(digest));
}

export async function lockDigests(flow: IFlow, catalog: IBindingCatalog): Promise<IBindingLockDigests> {
  return {
    flow_content_sha256: await sha256Hex(canonicalJson(flow)),
    pin_sha256: await sha256Hex(canonicalJson(flow.steps.map((step) => [step.id, step.pin ?? null]))),
    catalog_sha256: await sha256Hex(canonicalJson(catalog)),
  };
}

function mismatch(flow: IFlow, detail: string, stepId?: Opt<string, Reason.OptionalContext>): IBindingIssue {
  return { code: ISSUE_LOCK_MISMATCH, flowId: flow.id, ...(stepId ? { stepId } : {}), detail };
}

/** Compare the run's lock with the current resolution. Undefined means the replay holds. */
export async function compareLock(
  flow: IFlow,
  runFile: Opt<IRunBindingsFile, Reason.OptionalContext>,
  current: { bindings: ReadonlyMap<string, BindingOutcome>; catalog: IBindingCatalog },
): Promise<IBindingIssue | undefined> {
  if (!runFile?.locked) return undefined;
  const parsed = BindingLockSchema.safeParse(runFile.locked);
  if (!parsed.success) return mismatch(flow, "lock is malformed");
  const lock = parsed.data;
  if (!runFile.locked_sha256) return mismatch(flow, "lock has no recorded sha256");
  if (await sha256Hex(JSON.stringify(lock)) !== runFile.locked_sha256) {
    return mismatch(flow, "lock bytes do not match the recorded sha256");
  }
  if (lock.flow_id !== flow.id) return mismatch(flow, "lock belongs to a different flow");
  const digests = await lockDigests(flow, current.catalog);
  if (lock.flow_content_sha256 !== digests.flow_content_sha256) {
    return mismatch(flow, "flow content differs from the lock");
  }
  if (lock.pin_sha256 !== digests.pin_sha256) return mismatch(flow, "step pins differ from the lock");
  if (lock.catalog_sha256 !== digests.catalog_sha256) return mismatch(flow, "catalog differs from the lock");
  const stepIds = flow.steps.map((step) => step.id);
  if (canonicalJson([...lock.step_ids].sort()) !== canonicalJson([...stepIds].sort())) {
    return mismatch(flow, "lock step set differs from the flow");
  }
  const locked = new Map(lock.entries.map((entry) => [entry.step_id, entry.outcome]));
  const stepsWithOutcome = [...current.bindings.keys()];
  if (stepsWithOutcome.length !== locked.size) return mismatch(flow, "bound step set differs from the lock");
  for (const [stepId, outcome] of current.bindings) {
    const recorded = locked.get(stepId);
    const now = outcome.kind === BINDING_OUTCOME_BOUND ? outcome : { kind: outcome.kind };
    if (!recorded || canonicalJson(recorded) !== canonicalJson(now)) {
      return mismatch(flow, "step binding differs from the lock", stepId);
    }
  }
  return undefined;
}
