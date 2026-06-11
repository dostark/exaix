/**
 * @module SessionReturnProcessor
 * @path packages/session/src/session_return_processor.ts
 * @description Phase 106 Step 6 — package-pure core the daemon's
 *   SessionReturnWatcher invokes when a return.json appears. Reads the brief and
 *   return for a trace, reconciles, and resumes the wait store only on accept.
 *   A missing/partial/invalid return.json is a no-op (GAP-10), so a half-written
 *   file or a forged/out-of-scope return never advances the gate.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/reconcile.ts, packages/session/src/wait/i_session_wait_store.ts]
 */

import { join } from "@std/path";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionDecision, SessionReconcileRejection } from "@exaix/schemas/session_delegate.ts";
import { reconcile } from "./reconcile.ts";
import type { ISessionWaitStore } from "./wait/i_session_wait_store.ts";

/** Outcome of processing a dropped return.json for one trace. */
export interface ISessionReturnOutcome {
  /** False when the brief or a complete, schema-valid return.json is not yet present. */
  processed: boolean;
  /** Reconciliation verdict; only meaningful when processed. */
  accepted: boolean;
  decision?: SessionDecision;
  /** Typed reason when processed but not accepted. */
  rejection?: SessionReconcileRejection;
  scopeViolations: string[];
  budgetExceeded: boolean;
}

/** Dependencies for SessionReturnProcessor (constructor DI, all Config-free). */
export interface ISessionReturnProcessorDeps {
  /** Absolute Session/ directory holding {traceId}/brief.json + return.json. */
  sessionDir: string;
  /** Scope root for gates without a worktree (refinement / plan_review / review). */
  workspaceRoot: string;
  waitStore: ISessionWaitStore;
}

const BRIEF_FILE = "brief.json";
const RETURN_FILE = "return.json";

const NOT_PROCESSED: ISessionReturnOutcome = {
  processed: false,
  accepted: false,
  scopeViolations: [],
  budgetExceeded: false,
};

export class SessionReturnProcessor {
  constructor(private readonly deps: ISessionReturnProcessorDeps) {}

  /**
   * Read brief + return for `traceId`, reconcile, and resume the wait store on
   * accept. Returns processed=false (a safe no-op) when the brief or a complete
   * return.json is absent/invalid; on a rejection the wait state is left pending.
   */
  async processReturn(traceId: string): Promise<ISessionReturnOutcome> {
    const dir = join(this.deps.sessionDir, traceId);
    const brief = await readParsed(join(dir, BRIEF_FILE), (raw) => SessionBriefSchema.parse(JSON.parse(raw)));
    if (!brief) return NOT_PROCESSED;

    // GAP-10: a missing or half-written return.json fails schema parse → no-op.
    const sessionReturn = await readParsed(join(dir, RETURN_FILE), (raw) => SessionReturnSchema.parse(JSON.parse(raw)));
    if (!sessionReturn) return NOT_PROCESSED;

    const worktreeRoot = brief.worktree_path ?? this.deps.workspaceRoot;
    const result = reconcile({ brief, sessionReturn, worktreeRoot });

    if (result.accepted) {
      await this.deps.waitStore.resume(traceId, sessionReturn.resume_token, result.decision);
      return {
        processed: true,
        accepted: true,
        decision: result.decision,
        scopeViolations: [],
        budgetExceeded: result.budgetExceeded,
      };
    }

    // Rejected: leave the wait state pending so a corrected return can be dropped
    // (or the deadline watcher expires it). Never resume on untrusted output.
    return {
      processed: true,
      accepted: false,
      rejection: result.rejection,
      scopeViolations: result.scopeViolations,
      budgetExceeded: result.budgetExceeded,
    };
  }
}

/** Read a file and run `parse` on its text; returns undefined on any read/parse failure. */
async function readParsed<T>(path: string, parse: (raw: string) => T): Promise<T | undefined> {
  try {
    return parse(await Deno.readTextFile(path));
  } catch {
    return undefined;
  }
}
