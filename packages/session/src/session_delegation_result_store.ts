/**
 * @module SessionDelegationResultStore
 * @path packages/session/src/session_delegation_result_store.ts
 * @description Phase 174 Step 1 atomic result handoff with an in-process
 *   compare-and-set transition from reconciled to delivered.
 * @architectural-layer Services
 * @dependencies [@std/path]
 * @related-files [packages/session/src/session_delegation.ts, packages/session/src/session_return_processor.ts]
 */

import { dirname, join } from "@std/path";
import {
  type ISessionDelegationOutcome,
  type ISessionDelegationResultRecord,
  SessionDelegationOutcomeSchema,
  SessionDelegationResultRecordSchema,
  SessionDelegationResultStateSchema,
} from "./session_delegation.ts";

export interface ISessionDelegationResultStore {
  publishAccepted(traceId: string, result: ISessionDelegationOutcome): Promise<void>;
  publishRejected(traceId: string, result: ISessionDelegationOutcome): Promise<void>;
  get(traceId: string): Promise<ISessionDelegationOutcome | null>;
  getRecord(traceId: string): Promise<ISessionDelegationResultRecord | null>;
  markDelivered(traceId: string): Promise<boolean>;
}

export type { ISessionDelegationResultRecord };

const RESULT_FILE = "session_delegate_result.json";

export class SessionDelegationResultStore implements ISessionDelegationResultStore {
  private readonly traceQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly baseDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publishAccepted(traceId: string, result: ISessionDelegationOutcome): Promise<void> {
    await this.publish(traceId, result, SessionDelegationResultStateSchema.enum.reconciled);
  }

  async publishRejected(traceId: string, result: ISessionDelegationOutcome): Promise<void> {
    await this.publish(traceId, result, SessionDelegationResultStateSchema.enum.delivered);
  }

  async get(traceId: string): Promise<ISessionDelegationOutcome | null> {
    const record = await this.getRecord(traceId);
    return record?.state === SessionDelegationResultStateSchema.enum.delivered ? record.outcome : null;
  }

  async getRecord(traceId: string): Promise<ISessionDelegationResultRecord | null> {
    try {
      return SessionDelegationResultRecordSchema.parse(
        JSON.parse(await Deno.readTextFile(this.path(traceId))),
      );
    } catch {
      return null;
    }
  }

  async markDelivered(traceId: string): Promise<boolean> {
    return await this.withTraceLock(traceId, async (): Promise<boolean> => {
      const current = await this.getRecord(traceId);
      if (!current || current.state === SessionDelegationResultStateSchema.enum.delivered) return false;
      const delivered = SessionDelegationResultRecordSchema.parse({
        ...current,
        state: SessionDelegationResultStateSchema.enum.delivered,
        deliveredAt: this.now().toISOString(),
      });
      await this.write(traceId, delivered);
      return true;
    });
  }

  private async publish(
    traceId: string,
    result: ISessionDelegationOutcome,
    state: ISessionDelegationResultRecord["state"],
  ): Promise<void> {
    await this.withTraceLock(traceId, async (): Promise<void> => {
      const parsed = SessionDelegationOutcomeSchema.parse(result);
      if (parsed.delegationTraceId !== traceId) {
        throw new Error("delegation trace mismatch");
      }
      if (await this.getRecord(traceId)) return;
      const reconciledAt = this.now().toISOString();
      await this.write(
        traceId,
        SessionDelegationResultRecordSchema.parse({
          state,
          outcome: parsed,
          reconciledAt,
          deliveredAt: state === SessionDelegationResultStateSchema.enum.delivered ? reconciledAt : undefined,
        }),
      );
    });
  }

  private path(traceId: string): string {
    return join(this.baseDir, traceId, RESULT_FILE);
  }

  private async write(traceId: string, record: ISessionDelegationResultRecord): Promise<void> {
    const target = this.path(traceId);
    await Deno.mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await Deno.writeTextFile(temporary, JSON.stringify(record, null, 2));
    await Deno.rename(temporary, target);
  }

  private async withTraceLock<T>(traceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.traceQueues.get(traceId) ?? Promise.resolve();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const queued = previous.then((): Promise<void> => pending);
    this.traceQueues.set(traceId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.traceQueues.get(traceId) === queued) this.traceQueues.delete(traceId);
    }
  }
}
