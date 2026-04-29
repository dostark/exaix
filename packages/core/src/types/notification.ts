/**
 * @module Notification
 * @path @exaix/core/types/notification.ts
 * @description Module for Notification.
 * @architectural-layer Shared
 * @related-files [src/shared/interfaces/i_notification_service.ts]
 */

/**
 * Structure for system notifications.
 */
export interface IMemoryNotification {
  id?: string;
  type:
    | "memory_update_pending"
    | "memory_update_pending_digest"
    | "memory_approved"
    | "memory_rejected"
    | "amendment_pending"
    | "amendment_approved"
    | "amendment_rejected"
    | "amendment_expired"
    | "info"
    | "success"
    | "warning"
    | "error";
  message: string;
  proposal_id?: string;
  trace_id?: string;
  created_at?: string;
  dismissed_at?: string | null;
  metadata?: string;
}
