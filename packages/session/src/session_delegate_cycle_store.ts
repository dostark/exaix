/**
 * @module SessionDelegateCycleStore
 * @path packages/session/src/session_delegate_cycle_store.ts
 * @description Phase 174 Step 4 atomic JSON checkpoint for one session_delegate_cycle
 *   flow step: a query/resume summary written under
 *   Memory/Execution/{parentTraceId}/session_delegate_cycles/{flowStepId}.json. The
 *   SQLite claim store (session_delegate_cycle_claim_store.ts) remains the launch
 *   source of truth; this store lets the handler resume without re-scanning claims.
 * @architectural-layer Services
 * @dependencies [zod, @std/path]
 * @related-files [packages/session/src/session_delegate_cycle_claim_store.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

import { dirname, join } from "@std/path";
import { z } from "zod";
import { SessionDelegationOutcomeSchema } from "./session_delegation.ts";
import { SessionDelegateCycleClaimStateSchema } from "./session_delegate_cycle_claim_store.ts";

export interface ISessionDelegateCycleStore {
  load(parentTraceId: string, flowStepId: string): Promise<ISessionDelegateCycleCheckpoint | null>;
  save(checkpoint: ISessionDelegateCycleCheckpoint): Promise<void>;
}

/** A checkpoint's `inFlight.state` is never "failed": that maps to checkpoint.status instead. */
const SessionDelegateCycleInFlightStateSchema = SessionDelegateCycleClaimStateSchema.exclude(["failed"]);

export const SessionDelegateCycleCheckpointStatusSchema = z.enum(["running", "completed", "failed"]);

const SessionDelegateCycleCheckpointSchema = z.object({
  parentTraceId: z.string().uuid(),
  lastFlowRunId: z.string().min(1),
  flowStepId: z.string().min(1),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().nonnegative(),
  nextSequence: z.number().int().positive(),
  completedSteps: z.array(z.object({
    sequence: z.number().int().positive(),
    delegationTraceId: z.string().uuid(),
    outcome: SessionDelegationOutcomeSchema,
    reviewedAt: z.string().datetime(),
  })),
  inFlight: z.object({
    idempotencyKey: z.string().min(1),
    sequence: z.number().int().positive(),
    delegationTraceId: z.string().uuid(),
    state: SessionDelegateCycleInFlightStateSchema,
  }).optional(),
  status: SessionDelegateCycleCheckpointStatusSchema,
  failure: z.string().optional(),
  updatedAt: z.string().datetime(),
}).strict();

export type ISessionDelegateCycleCheckpoint = z.infer<typeof SessionDelegateCycleCheckpointSchema>;

const CYCLE_CHECKPOINT_DIR = "session_delegate_cycles";

/** Atomic temp-write/rename JSON checkpoint store, serialized per (parentTraceId, flowStepId). */
export class SessionDelegateCycleStore implements ISessionDelegateCycleStore {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly baseDir: string) {}

  async load(parentTraceId: string, flowStepId: string): Promise<ISessionDelegateCycleCheckpoint | null> {
    try {
      return SessionDelegateCycleCheckpointSchema.parse(
        JSON.parse(await Deno.readTextFile(this.path(parentTraceId, flowStepId))),
      );
    } catch {
      return null;
    }
  }

  async save(checkpoint: ISessionDelegateCycleCheckpoint): Promise<void> {
    const parsed = SessionDelegateCycleCheckpointSchema.parse(checkpoint);
    const key = `${parsed.parentTraceId}/${parsed.flowStepId}`;
    await this.withLock(key, async (): Promise<void> => {
      const target = this.path(parsed.parentTraceId, parsed.flowStepId);
      await Deno.mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.tmp`;
      await Deno.writeTextFile(temporary, JSON.stringify(parsed, null, 2));
      await Deno.rename(temporary, target);
    });
  }

  private path(parentTraceId: string, flowStepId: string): string {
    return join(this.baseDir, parentTraceId, CYCLE_CHECKPOINT_DIR, `${flowStepId}.json`);
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const queued = previous.then((): Promise<void> => pending);
    this.queues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }
}

/**
 * Process-local reference implementation; not crash-durable. Production wiring
 * (apps/daemon/main.ts) supplies SessionDelegateCycleStore instead. Also used by
 * FlowRunner as the fallback when no durable store is configured, and by tests.
 */
export function createInMemorySessionDelegateCycleStore(): ISessionDelegateCycleStore {
  const checkpoints = new Map<string, ISessionDelegateCycleCheckpoint>();
  const keyOf = (parentTraceId: string, flowStepId: string): string => `${parentTraceId} ${flowStepId}`;
  return {
    load(parentTraceId: string, flowStepId: string): Promise<ISessionDelegateCycleCheckpoint | null> {
      return Promise.resolve(checkpoints.get(keyOf(parentTraceId, flowStepId)) ?? null);
    },
    save(checkpoint: ISessionDelegateCycleCheckpoint): Promise<void> {
      checkpoints.set(keyOf(checkpoint.parentTraceId, checkpoint.flowStepId), checkpoint);
      return Promise.resolve();
    },
  };
}
