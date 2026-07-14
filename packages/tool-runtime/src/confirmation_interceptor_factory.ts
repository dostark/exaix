/**
 * @module ConfirmationInterceptorFactory
 * @path packages/tool-runtime/src/confirmation_interceptor_factory.ts
 * @description Builds the IToolConfirmationInterceptor implied by an
 * IApplicationContext + Config: NotificationQueueConfirmationInterceptor when
 * a notificationService is available, otherwise CliConfirmationInterceptor
 * sized from config.tools.confirmation_timeout_s. Shared by any caller that
 * wires dynamic-step tool confirmation (FlowRunner via DI, daemon bootstrap)
 * so both build the identical interceptor from one Config/context.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/tool-runtime/src/cli_confirmation_interceptor.ts, packages/tool-runtime/src/notification_queue_confirmation_interceptor.ts]
 */

import { DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S } from "@exaix/core";
import type { IApplicationContext, IToolConfirmationInterceptor } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import { CliConfirmationInterceptor } from "./cli_confirmation_interceptor.ts";
import { NotificationQueueConfirmationInterceptor } from "./notification_queue_confirmation_interceptor.ts";
import type { IActivityJournal } from "./types.ts";

/** Builds the confirmation interceptor implied by context.notificationService and config.tools. */
export function buildConfirmationInterceptor(
  context: IApplicationContext,
  config: Config,
  activityJournal: IActivityJournal,
): IToolConfirmationInterceptor {
  if (context.notificationService) {
    return new NotificationQueueConfirmationInterceptor(context.db, context.notificationService, activityJournal);
  }

  const confirmationTimeoutMs = (config.tools?.confirmation_timeout_s ?? DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S) * 1000;
  return new CliConfirmationInterceptor(activityJournal, confirmationTimeoutMs);
}
