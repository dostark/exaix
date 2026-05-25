/**
 * @module EnumsIdentitySeparationTest
 * @path packages/core/tests/enums_identity_separation_test.ts
 * @description Verifies enum values for Actor/Agent/Identity separation are correct and legacy AGENT members are removed.
 */

import { assertEquals, assertFalse, assertNotEquals } from "@std/assert";
import { ActivityActor, ActorType, AgentKind, MemoryBankSource, RequestKind } from "@exaix/core";
import { GroupingMode, LogGroupingMode, RequestDialogType, RequestGroupingMode, TuiNodeType } from "@exaix/tui";
/**
 * Tests for Step 55.8: Enum value contracts
 *
 * Success Criteria:
 * - All IDENTITY-named enum members exist with correct values
 * - All legacy AGENT-named members are removed
 * - Enum string values match expected format
 */

Deno.test("ActorType enum has correct string values", () => {
  assertEquals(ActorType.USER, "user");
  assertEquals(ActorType.SERVICE, "service");
  assertEquals(ActorType.MCP_CLIENT, "mcp-client");
  assertEquals(ActorType.IDENTITY, "identity");
});

Deno.test("AgentKind enum has correct string values", () => {
  assertEquals(AgentKind.IDENTITY_RUNNER, "identity-runner");
  assertEquals(AgentKind.AGENT_EXECUTOR, "agent-executor");
  assertEquals(AgentKind.FLOW_AGENT, "flow-agent");
  assertEquals(AgentKind.TOOL_AGENT, "tool-agent");
  assertEquals(AgentKind.REQUEST_ROUTER, "request-router");
});

Deno.test("ActivityActor uses IDENTITY not AGENT", () => {
  assertEquals(ActivityActor.IDENTITY, "identity");
  assertEquals(ActivityActor.HUMAN, "human");
  assertEquals(ActivityActor.SYSTEM, "system");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in ActivityActor);
});

Deno.test("RequestKind uses IDENTITY not AGENT", () => {
  assertEquals(RequestKind.FLOW, "flow");
  assertEquals(RequestKind.IDENTITY, "identity");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in RequestKind);
});

Deno.test("MemoryBankSource.IDENTITY exists with correct value", () => {
  assertEquals(MemoryBankSource.EXECUTION, "execution");
  assertEquals(MemoryBankSource.USER, "user");
  assertEquals(MemoryBankSource.IDENTITY, "identity");
  assertEquals(MemoryBankSource.LEARNED, "learned");
  assertEquals(MemoryBankSource.CORE, "core");
  assertEquals(MemoryBankSource.PROJECT, "project");
  assertEquals(MemoryBankSource.FILE, "file");
  assertEquals(MemoryBankSource.DATABASE, "database");
  assertEquals(MemoryBankSource.LLM, "llm");
});

Deno.test("TuiNodeType.IDENTITY exists with correct value", () => {
  assertEquals(TuiNodeType.ROOT, "root");
  assertEquals(TuiNodeType.SCOPE, "scope");
  assertEquals(TuiNodeType.PROJECT, "project");
  assertEquals(TuiNodeType.EXECUTION, "execution");
  assertEquals(TuiNodeType.LEARNING, "learning");
  assertEquals(TuiNodeType.PATTERN, "pattern");
  assertEquals(TuiNodeType.DECISION, "decision");
  assertEquals(TuiNodeType.IDENTITY, "identity");
  assertEquals(TuiNodeType.STATUS_GROUP, "status-group");
  assertEquals(TuiNodeType.MODEL_GROUP, "model-group");
  assertEquals(TuiNodeType.GROUP, "group");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in TuiNodeType);
});

Deno.test("GroupingMode.IDENTITY exists with correct value", () => {
  assertEquals(GroupingMode.IDENTITY, "identity");
  assertEquals(GroupingMode.ACTION, "action");
  assertEquals(GroupingMode.NONE, "none");
  assertEquals(GroupingMode.STATUS, "status");
  assertEquals(GroupingMode.PROJECT, "project");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in GroupingMode);
});

Deno.test("LogGroupingMode.IDENTITY exists (not AGENT)", () => {
  assertEquals(LogGroupingMode.CORRELATION, "correlation");
  assertEquals(LogGroupingMode.TRACE, "trace");
  assertEquals(LogGroupingMode.IDENTITY, "identity");
  assertEquals(LogGroupingMode.LEVEL, "level");
  assertEquals(LogGroupingMode.TIME, "time");
  assertEquals(LogGroupingMode.NONE, "none");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in LogGroupingMode);
});

Deno.test("RequestDialogType.FILTER_IDENTITY exists (not FILTER_AGENT)", () => {
  assertEquals(RequestDialogType.SEARCH, "search");
  assertEquals(RequestDialogType.FILTER_STATUS, "filter-status");
  assertEquals(RequestDialogType.FILTER_IDENTITY, "filter-identity");
  assertEquals(RequestDialogType.CREATE, "create");
  assertEquals(RequestDialogType.PRIORITY, "priority");
  // Ensure the old FILTER_AGENT member is gone at runtime
  assertFalse("FILTER_AGENT" in RequestDialogType);
});

Deno.test("RequestGroupingMode.IDENTITY exists with correct value", () => {
  assertEquals(RequestGroupingMode.NONE, "none");
  assertEquals(RequestGroupingMode.STATUS, "status");
  assertEquals(RequestGroupingMode.PRIORITY, "priority");
  assertEquals(RequestGroupingMode.IDENTITY, "identity");
  // Ensure the old AGENT member is gone at runtime
  assertFalse("AGENT" in RequestGroupingMode);
});

Deno.test("All IDENTITY enum values are distinct from AGENT values", () => {
  // Verify that IDENTITY-named members have "identity" in their string value
  // and are distinct from any potential AGENT values

  // ActorType.IDENTITY should be "identity", not "agent"
  assertNotEquals(ActorType.IDENTITY, "agent");
  assertEquals(ActorType.IDENTITY, "identity");

  // RequestKind.IDENTITY should be "identity", not "agent"
  assertNotEquals(RequestKind.IDENTITY, "agent");
  assertEquals(RequestKind.IDENTITY, "identity");

  // GroupingMode.IDENTITY should be "identity", not "agent"
  assertNotEquals(GroupingMode.IDENTITY, "agent");
  assertEquals(GroupingMode.IDENTITY, "identity");
});
