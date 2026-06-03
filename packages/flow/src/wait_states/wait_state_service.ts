/**
 * @module WaitStateService
 * @path packages/flow/src/wait_states/wait_state_service.ts
 * @description Transition policy and in-memory WaitStateService for durable wait states.
 * @architectural-layer Service
 * @related-files [packages/flow/src/wait_states/wait_state.ts, packages/flow/tests/wait_state_contract_test.ts]
 *
 * @note require-await is suppressed because IWaitStateService declares async methods but
 *       the in-memory implementation does not perform I/O. Filesystem-backed implementations
 *       and future extensions will introduce actual async operations.
 */

// deno-lint-ignore-file require-await

import {
  type CreateWaitStateInput,
  type IWaitState,
  type TransitionWaitStateInput,
  type WaitStateAction,
  WaitStateSchema,
  type WaitStateStatus,
} from "./wait_state.ts";

export interface IWaitStateTransitionPolicy {
  validate(input: {
    current: IWaitState;
    action: WaitStateAction;
  }): { allowed: boolean; reason?: string };
}

export interface IWaitStateService {
  create(input: CreateWaitStateInput): Promise<IWaitState>;
  getById(waitStateId: string): Promise<IWaitState | null>;
  getByToken(resumeToken: string): Promise<IWaitState | null>;
  transition(input: TransitionWaitStateInput): Promise<IWaitState>;
  listPending(traceId?: string): Promise<IWaitState[]>;
}

const APPROVE = "approve";
const RESUME = "resume";
const REJECT = "reject";
const AMEND = "amend";
const EXPIRE = "expire";
const CANCEL = "cancel";
const PENDING = "pending";

const TRANSITION_MATRIX: Record<string, Set<string>> = {
  [PENDING]: new Set([RESUME, APPROVE, REJECT, AMEND, EXPIRE, CANCEL]),
  resumed: new Set([APPROVE]),
  amended: new Set([RESUME, APPROVE, REJECT]),
  fulfilled: new Set(),
  rejected: new Set(),
  expired: new Set(),
  cancelled: new Set(),
};

export class DefaultWaitStateTransitionPolicy implements IWaitStateTransitionPolicy {
  validate(
    input: { current: IWaitState; action: WaitStateAction },
  ): { allowed: boolean; reason?: string } {
    const allowed = TRANSITION_MATRIX[input.current.status]?.has(input.action) ?? false;
    if (!allowed) {
      return {
        allowed: false,
        reason: `Transition ${input.current.status} → ${input.action} is not allowed`,
      };
    }
    return { allowed: true };
  }
}

const AMENDED = "amended";

const ACTION_TO_STATUS: Record<WaitStateAction, WaitStateStatus> = {
  [RESUME]: "resumed",
  [APPROVE]: "fulfilled",
  [REJECT]: "rejected",
  [AMEND]: AMENDED,
  [EXPIRE]: "expired",
  [CANCEL]: "cancelled",
};

export class WaitStateService implements IWaitStateService {
  private store = new Map<string, IWaitState>();
  private tokenIndex = new Map<string, string>();
  private policy = new DefaultWaitStateTransitionPolicy();

  async create(input: CreateWaitStateInput): Promise<IWaitState> {
    const existing = [...this.store.values()].find(
      (ws) => ws.traceId === input.traceId && ws.kind === input.kind && ws.status === PENDING,
    );
    if (existing) {
      throw new Error(
        `wait state already exists: traceId=${input.traceId} kind=${input.kind} has pending wait state ${existing.waitStateId}`,
      );
    }

    // Amendment linkage: if amendmentOf is set, auto-transition original to amended
    if (input.amendmentOf) {
      const original = this.store.get(input.amendmentOf);
      if (!original) {
        throw new Error(
          `original wait state not found for amendment: ${input.amendmentOf}`,
        );
      }
      if (original.status !== PENDING && original.status !== "amended") {
        throw new Error(
          `cannot amend wait state ${input.amendmentOf}: status is ${original.status}`,
        );
      }
      const now2 = new Date().toISOString();
      const amended: IWaitState = { ...original, status: "amended", updatedAt: now2 };
      this.store.set(input.amendmentOf, amended);
    }

    const now = new Date().toISOString();
    const waitStateId = crypto.randomUUID();
    const waitState = WaitStateSchema.parse({
      waitStateId,
      traceId: input.traceId,
      kind: input.kind,
      status: PENDING,
      artifactPath: input.artifactPath,
      createdAt: now,
      updatedAt: now,
      resumeToken: input.resumeToken,
      requestedBy: input.requestedBy,
      assignedApprover: input.assignedApprover,
      deadlineAt: input.deadlineAt,
      amendmentOf: input.amendmentOf,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }) as IWaitState;

    this.store.set(waitStateId, waitState);
    this.tokenIndex.set(input.resumeToken, waitStateId);
    return waitState;
  }

  private maybeExpire(ws: IWaitState): IWaitState {
    if (ws.status !== PENDING || !ws.deadlineAt) return ws;
    if (new Date(ws.deadlineAt) <= new Date()) {
      const expired: IWaitState = { ...ws, status: "expired", updatedAt: new Date().toISOString() };
      this.store.set(ws.waitStateId, expired);
      return expired;
    }
    return ws;
  }

  async getById(waitStateId: string): Promise<IWaitState | null> {
    const ws = this.store.get(waitStateId);
    if (!ws) return null;
    return this.maybeExpire(ws);
  }

  async getByToken(resumeToken: string): Promise<IWaitState | null> {
    const id = this.tokenIndex.get(resumeToken);
    if (!id) return null;
    const ws = this.store.get(id);
    if (!ws) return null;
    return this.maybeExpire(ws);
  }

  async transition(input: TransitionWaitStateInput): Promise<IWaitState> {
    const raw = this.store.get(input.waitStateId);
    if (!raw) {
      throw new Error(
        `wait state not found: ${input.waitStateId}`,
      );
    }
    const existing = this.maybeExpire(raw);

    if (existing.resumeToken !== input.resumeToken) {
      throw new Error(
        `resume token mismatch for wait state ${input.waitStateId}`,
      );
    }

    const validation = this.policy.validate({ current: existing, action: input.action });
    if (!validation.allowed) {
      throw new Error(
        `transition not allowed: ${validation.reason}`,
      );
    }

    const now = new Date().toISOString();
    const newStatus = ACTION_TO_STATUS[input.action] ?? "fulfilled";
    const updated: IWaitState = {
      ...existing,
      status: newStatus,
      updatedAt: now,
      resolutionSummary: input.resolutionSummary ?? existing.resolutionSummary,
    };

    this.store.set(input.waitStateId, updated);

    // Amendment resolution: if this wait was created as an amendment (has amendmentOf)
    // and transitions to fulfilled/resumed, auto-resume the original.
    if (existing.amendmentOf && (newStatus === "fulfilled" || newStatus === "resumed")) {
      const original = this.store.get(existing.amendmentOf);
      if (original && original.status === "amended") {
        const resumed: IWaitState = { ...original, status: "resumed", updatedAt: now };
        this.store.set(existing.amendmentOf, resumed);
      }
    }

    return updated;
  }

  async listPending(traceId?: string): Promise<IWaitState[]> {
    const expired = [...this.store.values()].filter(
      (ws) => ws.status === PENDING && ws.deadlineAt && new Date(ws.deadlineAt) <= new Date(),
    );
    for (const ws of expired) {
      this.store.set(ws.waitStateId, { ...ws, status: "expired", updatedAt: new Date().toISOString() });
    }
    const pending = [...this.store.values()].filter((ws) => ws.status === PENDING);
    if (traceId) {
      return pending.filter((ws) => ws.traceId === traceId);
    }
    return pending;
  }
}
