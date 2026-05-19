/**
 * @module NotificationServiceStubHelpers
 * @path tests/helpers/notification_service_stub_helpers.ts
 * @description Shared stub base for INotificationService used across flow runner tests.
 */

import type { IMemoryNotification, INotificationService } from "@exaix/core/types";
import type { IMemoryUpdateProposal } from "@exaix/schemas";

export class StubNotificationServiceBase implements INotificationService {
  notifyMemoryUpdate(_proposal: IMemoryUpdateProposal): Promise<void> {
    return Promise.resolve();
  }

  notify(
    _message: string,
    _type?: string,
    _proposalId?: string,
    _traceId?: string,
    _metadata?: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  notifyApproval(_proposalId: string, _learningTitle: string): void {}

  notifyRejection(_proposalId: string, _reason: string): void {}

  getNotifications(): Promise<IMemoryNotification[]> {
    return Promise.resolve([]);
  }

  getPendingCount(): Promise<number> {
    return Promise.resolve(0);
  }

  notifyPendingDigestIfNeeded(_pendingCount: number): Promise<boolean> {
    return Promise.resolve(false);
  }

  clearNotification(_proposalId: string): Promise<void> {
    return Promise.resolve();
  }

  clearAllNotifications(): Promise<void> {
    return Promise.resolve();
  }
}
