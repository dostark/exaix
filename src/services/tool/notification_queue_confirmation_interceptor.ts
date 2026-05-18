/**
 * @module NotificationQueueConfirmationInterceptor
 * @path src/services/tool/notification_queue_confirmation_interceptor.ts
 * @description Async DB-backed tool approval queue used by Phase 79 notification-driven confirmation flows.
 * @architectural-layer Services
 * @related-files [src/flows/dynamic_step_executor.ts, src/services/core/db.ts, src/services/tool/cli_confirmation_interceptor.ts]
 */

import {
  TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
  TOOL_CONFIRMATION_EVENT_REQUESTED,
  TOOL_CONFIRMATION_NOTIFY_TYPE,
  TOOL_CONFIRMATION_POLL_INTERVAL_MS,
} from "@exaix/core";
import type { IDatabaseService, INotificationService, IToolConfirmationInterceptor } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IActivityJournal } from "../../flows/dynamic_step_executor.ts";

type DelayFn = (ms: number) => Promise<void>;
type ClockFn = () => number;

export class NotificationQueueConfirmationInterceptor implements IToolConfirmationInterceptor {
  constructor(
    private readonly db: IDatabaseService,
    private readonly notificationService: Pick<INotificationService, "notify">,
    private readonly activityJournal: IActivityJournal,
    private readonly delayFn: DelayFn = defaultDelay,
    private readonly clockFn: ClockFn = () => Date.now(),
  ) {}

  async requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    await this.db.insertToolConfirmationRequest(request);
    await this.activityJournal.log({
      traceId: request.traceId,
      stepId: request.stepId,
      event: TOOL_CONFIRMATION_EVENT_REQUESTED,
      toolName: request.toolName,
      confirmationId: request.id,
    });
    await this.notificationService.notify(
      `Tool approval required: ${request.toolName}`,
      TOOL_CONFIRMATION_NOTIFY_TYPE,
      request.id,
      request.traceId,
      JSON.stringify({
        toolName: request.toolName,
        stepId: request.stepId,
        expiresAt: request.expiresAt,
      }),
    );

    const expiresAtMs = Date.parse(request.expiresAt);
    while (true) {
      const decision = await this.db.getToolConfirmationDecision(request.id);
      if (decision !== null) {
        return decision;
      }

      if (this.clockFn() >= expiresAtMs) {
        const timeoutDecision = {
          approved: false,
          reason: "TIMEOUT",
          decidedAt: new Date(this.clockFn()).toISOString(),
          decidedBy: TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
        } satisfies Omit<ToolConfirmationDecision, "id">;
        await this.db.writeToolConfirmationDecision(request.id, timeoutDecision);
        return { id: request.id, ...timeoutDecision };
      }

      await this.delayFn(TOOL_CONFIRMATION_POLL_INTERVAL_MS);
    }
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
