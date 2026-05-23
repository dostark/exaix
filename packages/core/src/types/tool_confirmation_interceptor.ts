/**
 * @module IToolConfirmationInterceptor
 * @path packages/core/src/types/tool_confirmation_interceptor.ts
 * @description Interface for the Phase 79 Tool Confirmation Interceptor. Implemented by
 * CliConfirmationInterceptor (sync stdin path) and NotificationQueueConfirmationInterceptor
 * (async DB-polling path). Injected as an optional fourth parameter into DynamicStepExecutor.
 * @architectural-layer Shared
 * @dependencies ["@exaix/schemas/tool_confirmation.ts"]
 * @related-files [packages/tool-runtime/src/cli_confirmation_interceptor.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";

export interface IToolConfirmationInterceptor {
  requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision>;
}
