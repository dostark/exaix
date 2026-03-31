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

import type { Config } from "../../shared/schemas/config.ts";
import { IDatabaseService } from "../core/db.ts";
import type { IMemoryUpdateProposal } from "../../shared/schemas/memory_bank.ts";
import { JSONObject, JSONValue, toSafeJson } from "../../shared/types/json.ts";
import { IMemoryNotification } from "../../shared/types/notification.ts";
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
      learning_title: proposal.learning?.title || "Untitled",
      reason: proposal.reason,
    });

    await this.notify(
      `Memory update pending: ${proposal.learning?.title || "Untitled"}`,
      "memory_update_pending",
      proposal.id,
      undefined,
      metadata,
    );

    // Log to IActivity Journal
    this.logActivity({
      event_type: "memory.update.pending",
      target: proposal.target_project || "global",
      metadata: {
        proposal_id: proposal.id,
        identity_id: proposal.identity_id,
        learning_title: proposal.learning?.title || "Untitled",
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
