/**
 * @module McpFixturesTest
 * @path packages/mcp/tests/fixtures_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Tests for Phase 79 confirmation interceptor test fixtures:
 * AllowAllConfirmationInterceptor and DenyAllConfirmationInterceptor.
 */

import { assertEquals } from "@std/assert";
import { AllowAllConfirmationInterceptor, DenyAllConfirmationInterceptor } from "@exaix/mcp/testing";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { McpToolName } from "@exaix/mcp";

const stubRequest: ToolConfirmationRequest = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  toolName: McpToolName.CREATE_REQUEST,
  args: {},
  stepId: "step-1",
  traceId: "trace-abc",
  requestedAt: "2026-05-17T10:00:00.000Z",
  expiresAt: "2026-05-17T10:02:00.000Z",
};

Deno.test("AllowAllConfirmationInterceptor: requestApproval resolves approved:true", async () => {
  const interceptor = new AllowAllConfirmationInterceptor();
  const decision = await interceptor.requestApproval(stubRequest);
  assertEquals(decision.approved, true);
  assertEquals(decision.id, stubRequest.id);
});

Deno.test("DenyAllConfirmationInterceptor: requestApproval resolves approved:false", async () => {
  const interceptor = new DenyAllConfirmationInterceptor();
  const decision = await interceptor.requestApproval(stubRequest);
  assertEquals(decision.approved, false);
  assertEquals(decision.id, stubRequest.id);
});
