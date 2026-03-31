/**
 * @module InotificationService
 * @path src/shared/interfaces/i_notification_service.ts
 * @description Module for InotificationService.
 * @architectural-layer Shared
 * * @related-files [src/shared/types/notification.ts]
 */

import type { IMemoryUpdateProposal } from "../schemas/memory_bank.ts";
import type { IMemoryNotification } from "../types/notification.ts";

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
   * Dismiss a specific notification.
   */
  clearNotification(proposalId: string): Promise<void>;

  /**
   * Dismiss all notifications.
   */
  clearAllNotifications(): Promise<void>;
}
