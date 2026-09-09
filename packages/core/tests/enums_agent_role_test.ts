/**
 * @module EnumsAgentRoleTest
 * @path packages/core/tests/enums_agent_role_test.ts
 * @description Verifies enum values for Actor/Agent/AgentRole separation are correct.
 *   Renamed from enums_identity_separation_test.ts (Phase 179 Step 3): Phase 53 originally
 *   reserved "Identity" for the LLM persona concept and "Agent" for the runtime harness;
 *   Phase 179 reverses that direction, renaming the persona concept to "AgentRole" instead.
 *   This file now asserts the post-reversal shape: dead IDENTITY-named members deleted
 *   outright, live ones renamed to AGENT_ROLE/FILTER_AGENT_ROLE.
 */

import { assertEquals, assertFalse, assertNotEquals } from "@std/assert";
import { ActivityActor, ActorType, MemoryBankSource, RequestKind, RunnerKind } from "@exaix/core";
import {
  GroupingMode,
  LogGroupingMode,
  RequestDialogType,
  RequestGroupingMode,
  TuiIcon,
  TuiNodeType,
} from "@exaix/tui";

Deno.test("ActorType enum has correct string values", () => {
  assertEquals(ActorType.USER, "user");
  assertEquals(ActorType.SERVICE, "service");
  assertEquals(ActorType.MCP_CLIENT, "mcp-client");
  assertEquals(ActorType.SYSTEM, "system");
  assertEquals(ActorType.AGENT, "agent");
  // IDENTITY is not a live actor type.
  assertFalse("IDENTITY" in ActorType);
});

Deno.test("RunnerKind (renamed from AgentKind) exposes exactly the live members", () => {
  assertEquals(RunnerKind.AGENT_COMPOSER, "agent-composer");
  assertEquals(RunnerKind.AGENT_RUNNER, "agent-runner");
  assertEquals(RunnerKind.REQUEST_ROUTER, "request-router");
  assertEquals(Object.values(RunnerKind).sort(), ["agent-composer", "agent-runner", "request-router"]);
  // The retired runner names are not live enum members.
  assertFalse("AGENT_EXECUTOR" in RunnerKind);
  assertFalse("IDENTITY_RUNNER" in RunnerKind);
  assertFalse("FLOW_AGENT" in RunnerKind);
  assertFalse("TOOL_AGENT" in RunnerKind);
});

Deno.test("ActivityActor no longer exposes IDENTITY", () => {
  assertEquals(ActivityActor.HUMAN, "human");
  assertEquals(ActivityActor.SYSTEM, "system");
  assertFalse("IDENTITY" in ActivityActor);
  assertFalse("AGENT" in ActivityActor);
});

Deno.test("RequestKind.AGENT_ROLE (renamed from IDENTITY)", () => {
  assertEquals(RequestKind.FLOW, "flow");
  assertEquals(RequestKind.AGENT_ROLE, "agent_role");
  assertFalse("IDENTITY" in RequestKind);
  assertFalse("AGENT" in RequestKind);
});

Deno.test("MemoryBankSource no longer exposes IDENTITY", () => {
  assertEquals(MemoryBankSource.EXECUTION, "execution");
  assertEquals(MemoryBankSource.USER, "user");
  assertEquals(MemoryBankSource.AGENT, "agent");
  assertEquals(MemoryBankSource.LEARNED, "learned");
  assertEquals(MemoryBankSource.CORE, "core");
  assertEquals(MemoryBankSource.PROJECT, "project");
  assertEquals(MemoryBankSource.FILE, "file");
  assertEquals(MemoryBankSource.DATABASE, "database");
  assertEquals(MemoryBankSource.LLM, "llm");
  assertFalse("IDENTITY" in MemoryBankSource);
});

Deno.test("TuiNodeType no longer exposes IDENTITY", () => {
  assertEquals(TuiNodeType.ROOT, "root");
  assertEquals(TuiNodeType.SCOPE, "scope");
  assertEquals(TuiNodeType.PROJECT, "project");
  assertEquals(TuiNodeType.EXECUTION, "execution");
  assertEquals(TuiNodeType.LEARNING, "learning");
  assertEquals(TuiNodeType.PATTERN, "pattern");
  assertEquals(TuiNodeType.DECISION, "decision");
  assertEquals(TuiNodeType.STATUS_GROUP, "status-group");
  assertEquals(TuiNodeType.MODEL_GROUP, "model-group");
  assertEquals(TuiNodeType.GROUP, "group");
  assertFalse("IDENTITY" in TuiNodeType);
  assertFalse("AGENT" in TuiNodeType);
});

Deno.test("TuiIcon no longer exposes IDENTITY", () => {
  assertEquals(TuiIcon.LEARNING, "🎯");
  assertEquals(TuiIcon.BRAIN, "🧠");
  assertFalse("IDENTITY" in TuiIcon);
});

Deno.test("GroupingMode.AGENT_ROLE (renamed from IDENTITY)", () => {
  assertEquals(GroupingMode.AGENT_ROLE, "agent_role");
  assertEquals(GroupingMode.ACTION, "action");
  assertEquals(GroupingMode.NONE, "none");
  assertEquals(GroupingMode.STATUS, "status");
  assertEquals(GroupingMode.PROJECT, "project");
  assertFalse("IDENTITY" in GroupingMode);
  assertFalse("AGENT" in GroupingMode);
});

Deno.test("LogGroupingMode.AGENT_ROLE (renamed from IDENTITY)", () => {
  assertEquals(LogGroupingMode.CORRELATION, "correlation");
  assertEquals(LogGroupingMode.TRACE, "trace");
  assertEquals(LogGroupingMode.AGENT_ROLE, "agent_role");
  assertEquals(LogGroupingMode.LEVEL, "level");
  assertEquals(LogGroupingMode.TIME, "time");
  assertEquals(LogGroupingMode.NONE, "none");
  assertFalse("IDENTITY" in LogGroupingMode);
  assertFalse("AGENT" in LogGroupingMode);
});

Deno.test("RequestDialogType.FILTER_AGENT_ROLE (renamed from FILTER_IDENTITY)", () => {
  assertEquals(RequestDialogType.SEARCH, "search");
  assertEquals(RequestDialogType.FILTER_STATUS, "filter-status");
  assertEquals(RequestDialogType.FILTER_AGENT_ROLE, "filter-agent-role");
  assertEquals(RequestDialogType.CREATE, "create");
  assertEquals(RequestDialogType.PRIORITY, "priority");
  assertFalse("FILTER_IDENTITY" in RequestDialogType);
  assertFalse("FILTER_AGENT" in RequestDialogType);
});

Deno.test("RequestGroupingMode.AGENT_ROLE (renamed from IDENTITY)", () => {
  assertEquals(RequestGroupingMode.NONE, "none");
  assertEquals(RequestGroupingMode.STATUS, "status");
  assertEquals(RequestGroupingMode.PRIORITY, "priority");
  assertEquals(RequestGroupingMode.AGENT_ROLE, "agent_role");
  assertFalse("IDENTITY" in RequestGroupingMode);
  assertFalse("AGENT" in RequestGroupingMode);
});

Deno.test("All renamed AGENT_ROLE enum values are distinct from bare AGENT values", () => {
  assertNotEquals(RequestKind.AGENT_ROLE, "agent");
  assertEquals(RequestKind.AGENT_ROLE, "agent_role");

  assertNotEquals(GroupingMode.AGENT_ROLE, "agent");
  assertEquals(GroupingMode.AGENT_ROLE, "agent_role");

  assertNotEquals(LogGroupingMode.AGENT_ROLE, "agent");
  assertEquals(LogGroupingMode.AGENT_ROLE, "agent_role");
});
