/**
 * @module DenyAllConfirmationInterceptor
 * @path packages/mcp/testing/deny_all_confirmation_interceptor.ts
 * @related-files []
 * @architectural-layer MCP
 * @ungrounded
 * @description Test-only fixture that always denies any tool confirmation request.
 * Must never be imported from production runtime code.
 */

import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";

export class DenyAllConfirmationInterceptor implements IToolConfirmationInterceptor {
  async requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    await Promise.resolve();
    return {
      id: request.id,
      approved: false,
      reason: "DenyAll",
      decidedAt: new Date().toISOString(),
      decidedBy: "test:deny-all",
    };
  }
}
