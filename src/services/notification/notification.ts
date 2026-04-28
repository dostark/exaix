/**
 * @module INotificationService
 * @path src/services/notification/notification.ts
 * @description Manages user notifications for memory updates.
 *
 * Key responsibilities:
 * - Store notifications in journal.db
 * - IActivity Journal integration for audit trail
 * - Notification lifecycle management with soft-deletes
 *
 * @architectural-layer Services
 * * @related-files [src/services/db.ts, src/services/memory_bank/index.builder.ts, src/shared/types/notification.ts]
 */

import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_TITLE_PLACEHOLDER } from "@exaix/core";
import { MemoryScope } from "@exaix/core";
import type { IDatabaseService } from "../core/db.ts";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import { type JSONObject, toSafeJson } from "@exaix/core/types/json.ts";
import type { JSONValue } from "@exaix/core";
import type { IMemoryNotification } from "../../shared/types/notification.ts";
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

/**
 * Notification Service
 *
 * Handles user notifications for memory updates using SQLite storage.
 */
export class NotificationService implements INotificationService {
  constructor(
    private config: Config,
    private db: IDatabaseService,
  ) {
    // No file path needed - using database only!
  }

  /**
   * Notify user of a pending memory update
   *
   * @param proposal - The pending proposal
   */
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
    this.logActivity({
      event_type: "memory.update.pending",
      target: proposal.target_project || MemoryScope.GLOBAL,
      metadata: {
        proposal_id: proposal.id,
        identity_id: proposal.identity_id,
        learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
        reason: proposal.reason,
      },
    });
  }

  /**
   * Generic notify method
   */
  async notify(
    message: string,
    type = "info",
    proposalId?: string,
    traceId?: string,
    metadata?: string,
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

  /**
   * Notify of approval
   *
   * @param proposalId - Approved proposal ID
   * @param learningTitle - Title of the learning
   */
  notifyApproval(proposalId: string, learningTitle: string): void {
    this.logActivity({
      event_type: "memory.update.approved",
      target: proposalId,
      metadata: {
        proposal_id: proposalId,
        learning_title: learningTitle,
      },
    });
  }

  /**
   * Notify of rejection
   *
   * @param proposalId - Rejected proposal ID
   * @param reason - Rejection reason
   */
  notifyRejection(proposalId: string, reason: string): void {
    this.logActivity({
      event_type: "memory.update.rejected",
      target: proposalId,
      metadata: {
        proposal_id: proposalId,
        reason,
      },
    });
  }

  /**
   * Get all pending notifications (not dismissed)
   *
   * @returns Array of notifications
   */
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

  /**
   * Get count of pending notifications
   *
   * @returns Number of pending notifications
   */
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

  /**
   * Clear a specific notification (soft-delete)
   *
   * @param proposalId - Proposal ID to clear
   */
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

  /**
   * Notify a digest summary of pending memory updates, throttled once per 24 hours.
   *
   * @param pendingCount - Number of pending memory update proposals
   * @returns true when a digest was emitted, false when throttled
   */
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

    this.logActivity({
      event_type: "memory.update.pending.digest",
      target: MemoryScope.GLOBAL,
      metadata: {
        pending_count: pendingCount,
      },
    });

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

  // ===== Private Helpers =====

  /**
   * Log activity to IActivity Journal
   */
  private logActivity(event: {
    event_type: string;
    target: string;
    trace_id?: string;
    metadata?: JSONObject;
  }): void {
    try {
      this.db.logActivity(
        "notification-service",
        event.event_type,
        event.target,
        toSafeJson(event.metadata) as Record<string, JSONValue>,
        event.trace_id,
      );
    } catch {
      // Don't fail on logging errors
    }
  }
}
