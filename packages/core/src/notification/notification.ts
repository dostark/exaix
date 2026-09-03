/**
 * @module CoreNotificationService
 * @path packages/core/src/notification/notification.ts
 * @description Manages user notifications for memory updates.
 *
 * Key responsibilities:
 * - Store notifications in journal.db
 * - IActivity Journal integration for audit trail
 * - Notification lifecycle management with soft-deletes
 *
 * @architectural-layer Core
 * @related-files ["packages/memory/src/bank/index_builder.ts", @exaix/core/types]
 */

import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_TITLE_PLACEHOLDER } from "@exaix/core";
import { MemoryScope } from "@exaix/core";
import type { IDatabaseService } from "@exaix/core/types";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import type { IMemoryNotification } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
/**
 * Interface for Notification Service to support mocks and strict typing
 */
export interface INotificationService {
  notifyMemoryUpdate(proposal: IMemoryUpdateProposal): Promise<void>;
  notify(
    message: string,
    type?: string,
    proposalId?: string,
    traceId?: string,
    metadata?: string,
  ): Promise<void>;
  notifyApproval(proposalId: string, learningTitle: string): void;
  notifyRejection(proposalId: string, reason: string): void;
  getNotifications(): Promise<IMemoryNotification[]>;
  getPendingCount(): Promise<number>;
  notifyPendingDigestIfNeeded(pendingCount: number): Promise<boolean>;
  clearNotification(proposalId: string): Promise<void>;
  clearAllNotifications(): Promise<void>;
  readonly database: IDatabaseService;
}

/** Handles user notifications for memory updates via SQLite storage. */
export class NotificationService implements INotificationService {
  constructor(
    private config: Config,
    private db: IDatabaseService,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    // No file path needed - using database only!
  }

  async notifyMemoryUpdate(proposal: IMemoryUpdateProposal): Promise<void> {
    const metadata = JSON.stringify({
      learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
      reason: proposal.reason,
    });

    await this.notify(
      `Memory update pending: ${proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER}`,
      "memory_update_pending",
      proposal.id,
      undefined,
      metadata,
    );

    // Log to IActivity Journal
    if (this.logger) {
      await this.logger.info(
        DomainEventType.MemoryUpdatePending,
        proposal.target_project || MemoryScope.GLOBAL,
        {
          proposal_id: proposal.id,
          agent_role: proposal.agent_role,
          learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
          reason: proposal.reason,
        },
      );
    }
  }

  /**
   * Generic notify method
   */
  async notify(
    message: string,
    type = "info",
    proposalId?: Opt<string, Reason.OptionalInput>,
    traceId?: Opt<string, Reason.TraceAbsent>,
    metadata?: Opt<string, Reason.OptionalContext>,
  ): Promise<void> {
    const id = crypto.randomUUID();
    await this.db.preparedRun(
      `
      INSERT INTO notifications (id, type, message, proposal_id, trace_id, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        type,
        message,
        proposalId || null,
        traceId || null,
        new Date().toISOString(),
        metadata || null,
      ],
    );
  }

  /**
   * Expose database for TUI needs
   */
  get database(): IDatabaseService {
    return this.db;
  }

  notifyApproval(proposalId: string, learningTitle: string): void {
    if (this.logger) {
      this.logger.info(
        DomainEventType.MemoryUpdateApproved,
        proposalId,
        {
          proposal_id: proposalId,
          learning_title: learningTitle,
        },
      );
    }
  }

  notifyRejection(proposalId: string, reason: string): void {
    if (this.logger) {
      this.logger.info(
        DomainEventType.MemoryUpdateRejected,
        proposalId,
        {
          proposal_id: proposalId,
          reason,
        },
      );
    }
  }

  /** Returns notifications that haven't been dismissed. */
  async getNotifications(): Promise<IMemoryNotification[]> {
    const rows = await this.db.preparedAll<IMemoryNotification>(
      `
      SELECT id, type, message, proposal_id, trace_id, created_at, dismissed_at, metadata
      FROM notifications
      WHERE dismissed_at IS NULL
      ORDER BY created_at DESC
    `,
      [],
    );

    return rows;
  }

  async getPendingCount(): Promise<number> {
    const result = await this.db.preparedGet<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM notifications
      WHERE type = 'memory_update_pending' AND dismissed_at IS NULL
    `,
      [],
    );

    return result?.count || 0;
  }

  /** Soft-deletes a notification (sets dismissed_at) rather than removing the row. */
  async clearNotification(proposalId: string): Promise<void> {
    await this.db.preparedRun(
      `
      UPDATE notifications
      SET dismissed_at = ?
      WHERE proposal_id = ? AND dismissed_at IS NULL
    `,
      [new Date().toISOString(), proposalId],
    );
  }

  /** Emits a digest summary of pending updates, throttled to once per 24 hours; returns
   * whether a digest was actually emitted. */
  async notifyPendingDigestIfNeeded(pendingCount: number): Promise<boolean> {
    if (pendingCount <= 0) {
      return false;
    }

    const latestDigest = await this.db.preparedGet<{ created_at: string }>(
      `
      SELECT created_at
      FROM notifications
      WHERE type = 'memory_update_pending_digest'
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [],
    );

    if (latestDigest?.created_at) {
      const lastCreatedAt = new Date(latestDigest.created_at);
      const diffMs = Date.now() - lastCreatedAt.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (diffMs < oneDayMs) {
        return false;
      }
    }

    await this.notify(
      `There are ${pendingCount} pending memory update proposal(s) awaiting review.`,
      "memory_update_pending_digest",
      undefined,
      undefined,
      JSON.stringify({ pendingCount }),
    );

    if (this.logger) {
      await this.logger.info(
        DomainEventType.MemoryUpdatePendingDigest,
        MemoryScope.GLOBAL,
        {
          pending_count: pendingCount,
        },
      );
    }

    return true;
  }

  /**
   * Clear all notifications (soft-delete)
   */
  async clearAllNotifications(): Promise<void> {
    await this.db.preparedRun(
      `
      UPDATE notifications
      SET dismissed_at = ?
      WHERE dismissed_at IS NULL
    `,
      [new Date().toISOString()],
    );
  }
}
