/**
 * @module SessionReturnWatcher
 * @path apps/daemon/src/session_return_watcher.ts
 * @description Phase 106 Step 6 — daemon runtime wiring that watches the Session/
 *   directory for return.json drops, delegates to the package-pure
 *   SessionReturnProcessor, and journals each transition via the
 *   session.delegate.* event family. Resume happens only on accept; a partial,
 *   forged, or out-of-scope return is journaled (or ignored) but never resumes.
 * @architectural-layer Services
 * @dependencies [@exaix/session, @exaix/core]
 * @related-files [packages/session/src/session_return_processor.ts, apps/daemon/src/watcher.ts]
 */

import { basename, dirname } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { FS_WRITE_EVENT_KINDS } from "@exaix/core/types";
import type { ILogEvent } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import type { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";

/** Narrow journaling seam — satisfied structurally by EventLogger. */
export interface ISessionEventSink {
  log(event: ILogEvent): Promise<void>;
}

export interface ISessionReturnWatcherDeps {
  /** Absolute Session/ directory watched for {traceId}/return.json drops. */
  sessionDir: string;
  processor: SessionReturnProcessor;
  logger: ISessionEventSink;
}

const RETURN_FILE = "return.json";

export class SessionReturnWatcher {
  private fsWatcher: Deno.FsWatcher | null = null;
  private aborted = false;

  constructor(private readonly deps: ISessionReturnWatcherDeps) {}

  /**
   * Process one detected return.json path: derive the traceId from its parent
   * directory, reconcile via the processor, and journal the outcome. A
   * not-yet-complete return (GAP-10) is a silent no-op.
   */
  async handleReturnPath(path: string): Promise<void> {
    const traceId = basename(dirname(path));
    const outcome = await this.deps.processor.processReturn(traceId);
    if (!outcome.processed) return;

    await this.journal(DomainEventType.SessionDelegateReturned, traceId, {
      accepted: outcome.accepted,
      decision: outcome.decision ?? null,
      budget_exceeded: outcome.budgetExceeded,
    });

    if (outcome.accepted) {
      await this.journal(DomainEventType.SessionDelegateReconciled, traceId, {
        decision: outcome.decision ?? null,
      });
      return;
    }

    if (outcome.rejection === "scope_violation") {
      await this.journal(DomainEventType.SessionDelegateScopeViolation, traceId, {
        violation_count: outcome.scopeViolations.length,
      });
    } else if (outcome.rejection === "forged_token") {
      await this.journal(DomainEventType.SessionDelegateTokenRejected, traceId, {});
    } else {
      await this.journal(DomainEventType.SessionDelegateReconciled, traceId, {
        rejected: true,
        reason: outcome.rejection ?? null,
      });
    }
  }

  /** Watch the Session/ tree and process each return.json as it lands. */
  async start(): Promise<void> {
    this.aborted = false;
    const watcher = Deno.watchFs(this.deps.sessionDir, { recursive: true });
    this.fsWatcher = watcher;
    for await (const event of watcher) {
      if (this.aborted) break;
      if (!FS_WRITE_EVENT_KINDS.has(event.kind)) continue;
      for (const path of event.paths) {
        if (basename(path) === RETURN_FILE) {
          await this.handleReturnPath(path);
        }
      }
    }
  }

  stop(): void {
    this.aborted = true;
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  private async journal(action: string, target: string, payload: Record<string, JSONValue>): Promise<void> {
    await this.deps.logger.log({ action, target, payload, icon: "🤝" });
  }
}
