/**
 * @module SessionWaitStore
 * @path packages/session/src/wait/session_wait_store.ts
 * @description File-based ISessionWaitStore (Phase 106 GAP-1 shim). Persists wait
 *   states as atomic JSON under {baseDir}/{traceId}/session_wait.json. resume()
 *   enforces a constant-time token match, the pending precondition, and the
 *   deadline (GAP-2 / GAP-10). Swappable for WaitStateService when Phase 84 lands.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/wait/i_session_wait_store.ts, packages/session/src/constant_time.ts]
 */

import { dirname, join } from "@std/path";
import { SessionWaitStateSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionDecision, SessionGate, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import { constantTimeEqual } from "../constant_time.ts";
import type { ISessionClock } from "../i_session_delegate.ts";
import type { ISessionWaitStore } from "./i_session_wait_store.ts";

const WAIT_FILE = "session_wait.json";

const systemClock: ISessionClock = { now: () => new Date() };

export class SessionWaitStore implements ISessionWaitStore {
  constructor(
    private readonly baseDir: string,
    private readonly clock: ISessionClock = systemClock,
  ) {}

  async park(
    traceId: string,
    gate: SessionGate,
    resumeToken: string,
    deadline: string,
  ): Promise<SessionWaitState> {
    const state = SessionWaitStateSchema.parse({
      trace_id: traceId,
      gate,
      resume_token: resumeToken,
      deadline,
      status: "pending",
      created_at: this.clock.now().toISOString(),
    });
    await this.write(traceId, state);
    return state;
  }

  async resume(traceId: string, resumeToken: string, decision: SessionDecision): Promise<SessionWaitState> {
    const current = await this.load(traceId);
    if (!current) throw new Error(`no wait state for trace ${traceId}`);
    if (current.status !== "pending") throw new Error(`wait state is ${current.status}, not pending`);
    if (!constantTimeEqual(resumeToken, current.resume_token)) throw new Error("invalid resume token");
    if (this.clock.now().getTime() > new Date(current.deadline).getTime()) {
      throw new Error("wait state past deadline");
    }
    const updated: SessionWaitState = {
      ...current,
      status: "resumed",
      decision,
      resumed_at: this.clock.now().toISOString(),
    };
    await this.write(traceId, updated);
    return updated;
  }

  async expire(traceId: string): Promise<SessionWaitState> {
    return await this.transition(traceId, "expired");
  }

  async cancel(traceId: string): Promise<SessionWaitState> {
    return await this.transition(traceId, "cancelled");
  }

  async get(traceId: string): Promise<SessionWaitState | undefined> {
    return await this.load(traceId);
  }

  private async transition(traceId: string, status: SessionWaitState["status"]): Promise<SessionWaitState> {
    const current = await this.load(traceId);
    if (!current) throw new Error(`no wait state for trace ${traceId}`);
    const updated: SessionWaitState = { ...current, status };
    await this.write(traceId, updated);
    return updated;
  }

  private path(traceId: string): string {
    return join(this.baseDir, traceId, WAIT_FILE);
  }

  private async load(traceId: string): Promise<SessionWaitState | undefined> {
    try {
      const raw = await Deno.readTextFile(this.path(traceId));
      return SessionWaitStateSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  private async write(traceId: string, state: SessionWaitState): Promise<void> {
    const target = this.path(traceId);
    await Deno.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(state, null, 2));
    await Deno.rename(tmp, target);
  }
}
