/**
 * @module Notification
 * @path packages/core/src/types/notification.ts
 * @description Module for Notification.
 * @architectural-layer Shared
 * @related-files [packages/core/src/types/i_notification_service.ts]
 */

/** The kinds of system notification. */
export type TMemoryNotificationType =
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

/**
 * Structure for system notifications.
 */
export interface IMemoryNotification {
  id?: string;
  type: TMemoryNotificationType;
  message: string;
  proposal_id?: string;
  trace_id?: string;
  created_at?: string;
  dismissed_at?: string | null;
  metadata?: string;
}
