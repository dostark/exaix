/**
 * @module InotificationService
 * @path packages/core/src/types/i_notification_service.ts
 * @description Module for InotificationService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { IMemoryUpdateProposal } from "@exaix/schemas";

import type { IMemoryNotification } from "@exaix/core/types";

export interface INotificationService {
  /**
   * Notify user of a pending memory update proposal.
   */
  notifyMemoryUpdate(proposal: IMemoryUpdateProposal): Promise<void>;

  /**
   * Send a generic notification.
   */
  notify(
    message: string,
    type?: string,
    proposalId?: string,
    traceId?: string,
    metadata?: string,
  ): Promise<void>;

  /**
   * Notify user of a proposal approval.
   */
  notifyApproval(proposalId: string, learningTitle: string): void;

  /**
   * Notify user of a proposal rejection.
   */
  notifyRejection(proposalId: string, reason: string): void;

  /**
   * Get all active (not dismissed) notifications.
   */
  getNotifications(): Promise<IMemoryNotification[]>;

  /**
   * Get count of pending memory update notifications.
   */
  getPendingCount(): Promise<number>;

  /**
   * Notify a digest summary of pending memory updates, throttled once per 24 hours.
   */
  notifyPendingDigestIfNeeded(pendingCount: number): Promise<boolean>;

  /**
   * Dismiss a specific notification.
   */
  clearNotification(proposalId: string): Promise<void>;

  /**
   * Dismiss all notifications.
   */
  clearAllNotifications(): Promise<void>;
}
