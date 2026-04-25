/**
 * @module AgentStatusSessionAdditionalTest
 * @path tests/tui/agent_status_view_session_additional_test.ts
 * @description Targeted tests for AgentStatusTuiSession, specifically focusing on session
 * initialization, dynamic grouping labels, and resilient detail rendering.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { TEST_MODEL_OPENAI } from "../config/constants.ts";
import type { IAgentStatusItem } from "../../src/shared/types/agent.ts";
import {
  type AgentStatusTuiSession,
  AgentStatusView,
  MinimalAgentServiceMock,
} from "../../src/tui/agent_status_view.ts";
import { AgentHealth, TuiGroupBy } from "@exaix/core";
import { AgentStatus } from "../../src/shared/status/agent_status.ts";

function makeAgent(id: string, overrides: Partial<IAgentStatusItem> = {}): IAgentStatusItem {
  return {
    id,
    name: `Agent ${id}`,
    model: TEST_MODEL_OPENAI,
    status: AgentStatus.ACTIVE,
    lastActivity: new Date().toISOString(),
    capabilities: ["code"],
    defaultSkills: [],
    ...overrides,
  };
}

Deno.test("AgentStatusTuiSession.initialize: loads agents and selects first", async () => {
  const svc = new MinimalAgentServiceMock([makeAgent("a1"), makeAgent("a2")]);
  const view = new AgentStatusView(svc);
  const session = view.createTuiSession(false);

  await session.initialize();

  assertEquals(session.getAgents().length, 2);
  assertEquals(session.getSelectedAgentId() !== null, true);
  assertEquals(session.getGroupBy(), TuiGroupBy.NONE);
  assertEquals(session.isHelpVisible(), false);
  assertEquals(session.isAutoRefreshEnabled(), false);
});

Deno.test("AgentStatusTuiSession.getGroupByLabel: covers known and unknown", async () => {
  const svc = new MinimalAgentServiceMock([makeAgent("a1")]);
  const view = new AgentStatusView(svc);
  const session = view.createTuiSession(false) as AgentStatusTuiSession;
  await session.initialize();

  assertEquals(session.getGroupByLabel(), "None");

  session.setGroupBy(TuiGroupBy.STATUS);
  assertEquals(session.getGroupByLabel(), "Status");

  session.setGroupBy(TuiGroupBy.MODEL);
  assertEquals(session.getGroupByLabel(), "Model");

  // Force unknown
  session.setGroupBy("bogus" as TuiGroupBy);
  assertEquals(session.getGroupByLabel(), "Unknown");
});

Deno.test("AgentStatusTuiSession.showAgentDetail: handles missing agent and renders issues/defaultSkills", async () => {
  const svc = new MinimalAgentServiceMock([
    makeAgent("a1", { defaultSkills: ["skill1", "skill2"], capabilities: ["code", "chat"] }),
  ]);

  // Make health return issues.
  svc.getAgentHealth = () => Promise.resolve({ status: AgentHealth.WARNING, issues: ["i1"], uptime: 90 });

  const view = new AgentStatusView(svc);
  const session = view.createTuiSession(false) as AgentStatusTuiSession;
  await session.initialize();

  session.setSelectedAgentId("a1");
  await session.showAgentDetail();

  assertEquals(session.isDetailVisible(), true);
  const detail = session.getDetailContent();
  assertStringIncludes(detail, "Issues:");
  assertStringIncludes(detail, "Default Skills:");

  // Missing agent path
  session.setSelectedAgentId("missing");
  await session.showAgentDetail();
  assertStringIncludes(session.getDetailContent(), "Identity not found");
});

Deno.test("AgentStatusTuiSession.toggleGrouping: cycles and rebuilds", async () => {
  const svc = new MinimalAgentServiceMock([makeAgent("a1"), makeAgent("a2", { model: "gpt-3" })]);
  const view = new AgentStatusView(svc);
  const session = view.createTuiSession(false) as AgentStatusTuiSession;
  await session.initialize();

  assertEquals(session.getGroupBy(), TuiGroupBy.NONE);
  session.toggleGrouping();
  assertEquals(session.getGroupBy(), TuiGroupBy.STATUS);
  session.toggleGrouping();
  assertEquals(session.getGroupBy(), TuiGroupBy.MODEL);
  session.toggleGrouping();
  assertEquals(session.getGroupBy(), TuiGroupBy.NONE);
});
