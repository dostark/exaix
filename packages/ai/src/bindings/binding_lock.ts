/**
 * @module BindingLock
 * @path packages/ai/src/bindings/binding_lock.ts
 * @description Builds the per-run lock record and persists it exclusively. An existing lock
 *   for the same trace is reused when its resolution is equal and refused otherwise, so a
 *   repeated trace can never rewrite an earlier run's audit record.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @std/path]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts, packages/ai/src/bindings/binding_replay.ts]
 */

import { join } from "@std/path";
import type { JSONValue } from "@exaix/core";
import type { BindingOutcome, IBindingLayers, IFlow } from "@exaix/schemas";
import { BindingLockSchema } from "@exaix/schemas";
import { canonicalJson, lockDigests, sha256Hex } from "./binding_replay.ts";
import { BINDING_OUTCOME_BOUND, BINDING_OUTCOME_UNBOUND } from "./binding_types.ts";

export type IBindingLock = ReturnType<typeof BindingLockSchema.parse>;

export interface IBuildLockInput {
  flow: IFlow;
  traceId: string;
  layers: IBindingLayers;
  bindings: ReadonlyMap<string, BindingOutcome>;
  configChecksum: string;
  envIgnored: boolean;
}

export interface IPersistedLock {
  path: string;
  sha256: string;
}

/** Raised when a trace already has a lock whose resolution differs from the new one. */
export class LockConflictError extends Error {
  constructor(detail: string) {
    super(`lock_mismatch: ${detail}`);
    this.name = "LockConflictError";
  }
}

const DEFAULT_PORT_BY_SCHEME: Record<string, string> = { "http:": "80", "https:": "443" };
const BINDING_LOCK_SCHEMA_VERSION = 1;

/** Canonical host:port of an endpoint URL, or undefined when it does not parse. */
function endpointHostPort(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    return `${url.hostname}:${url.port || DEFAULT_PORT_BY_SCHEME[url.protocol] || ""}`;
  } catch {
    return undefined;
  }
}

/** Sorted, de-duplicated endpoint hosts of every bound step. */
export function boundHosts(bindings: ReadonlyMap<string, BindingOutcome>): string[] {
  const hosts = new Set<string>();
  for (const outcome of bindings.values()) {
    if (outcome.kind !== BINDING_OUTCOME_BOUND || !outcome.binding.endpoint) continue;
    const host = endpointHostPort(outcome.binding.endpoint);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

export async function buildLock(input: IBuildLockInput): Promise<IBindingLock> {
  const { flow, layers, bindings } = input;
  const entries = flow.steps.flatMap((step) => {
    const outcome = bindings.get(step.id);
    if (!outcome) return [];
    return [{
      step_id: step.id,
      agent_role: step.agent_role,
      outcome: outcome.kind === BINDING_OUTCOME_BOUND
        ? { kind: BINDING_OUTCOME_BOUND, binding: outcome.binding }
        : { kind: BINDING_OUTCOME_UNBOUND },
    }];
  });
  return BindingLockSchema.parse({
    schema: BINDING_LOCK_SCHEMA_VERSION,
    trace_id: input.traceId,
    flow_id: flow.id,
    created_at: new Date().toISOString(),
    ...await lockDigests(flow, layers.catalog),
    step_ids: flow.steps.map((step) => step.id),
    config_checksum: input.configChecksum,
    overlay_sha256: [...layers.overlaySha256],
    run_overlays: layers.entries.filter((entry) => entry.layer === "run").length,
    env_ignored: input.envIgnored,
    hosts: boundHosts(bindings),
    entries,
  });
}

/** The parts of a lock that identify one resolution. Time and raw checksums are audit data. */
function resolutionIdentity(lock: IBindingLock): string {
  return canonicalJson({
    flow_id: lock.flow_id,
    flow_content_sha256: lock.flow_content_sha256,
    pin_sha256: lock.pin_sha256,
    catalog_sha256: lock.catalog_sha256,
    step_ids: [...lock.step_ids].sort(),
    entries: lock.entries,
  });
}

function parseJson(text: string): JSONValue | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Write the lock beneath `dir` without replacing an existing file. */
export async function persistLockExclusive(dir: string, lock: IBindingLock): Promise<IPersistedLock> {
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `${lock.trace_id}.lock.json`);
  const serialized = JSON.stringify(lock);
  const tempPath = join(dir, `.tmp-${lock.trace_id}-${crypto.randomUUID()}`);
  await Deno.writeTextFile(tempPath, serialized, { createNew: true });
  try {
    return await createLockFile(tempPath, path, serialized);
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    return await reuseExisting(path, lock);
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

/** Link the finished temp file into place. A filesystem without hard links falls back to exclusive creation. */
async function createLockFile(tempPath: string, path: string, serialized: string): Promise<IPersistedLock> {
  try {
    await Deno.link(tempPath, path);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) throw error;
    await Deno.writeTextFile(path, serialized, { createNew: true });
  }
  return { path, sha256: await sha256Hex(serialized) };
}

async function reuseExisting(path: string, lock: IBindingLock): Promise<IPersistedLock> {
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) throw new LockConflictError("existing lock is not a regular file");
  const text = await Deno.readTextFile(path);
  const parsed = BindingLockSchema.safeParse(parseJson(text));
  if (!parsed.success) throw new LockConflictError("existing lock is malformed");
  if (resolutionIdentity(parsed.data) !== resolutionIdentity(lock)) {
    throw new LockConflictError("trace already has a lock with a different resolution");
  }
  return { path, sha256: await sha256Hex(text) };
}
