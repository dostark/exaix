/**
 * @module SkillsManagerViewTest
 * @path apps/tui/tests/skills_manager_view_test.ts
 * @description Verifies the SkillsManagerView TUI component, ensuring keyboard-driven
 * navigation of agent capabilities, dynamic grouping (Source/Status), and detailed skill inspection.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { AgentStatus } from "@exaix/core/status";
import { RequestStatus } from "@exaix/core/status";
import type { ISkillSummary } from "../src/skills_manager_view.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { createSkillsManagerTuiSession, sampleTestSkills, testSkillsSessionRender } from "./helpers.ts";
import { TEST_MODEL_OPENAI } from "@exaix/testing";
import { AgentStatusView, MinimalAgentServiceMock } from "../src/agent_status_view.ts";
import { MinimalRequestServiceMock, RequestManagerView } from "../src/request_manager_view.ts";
import type { IRequest } from "@exaix/core/types";
import { RequestPriority, RequestSource } from "@exaix/core";

// ===== Test Data =====

const TEST_SKILLS: ISkillSummary[] = sampleTestSkills();

// ===== SkillsManagerView Tests =====

Deno.test("SkillsManagerView: renders skill tree", async () => {
  const { session } = createSkillsManagerTuiSession(TEST_SKILLS);
  await session.initialize();
  const rendered = session.render();

  assertStringIncludes(rendered, "SKILLS MANAGER");
  assertStringIncludes(rendered, "TDD Methodology");
});

Deno.test("SkillsManagerView: navigates with keyboard", async () => {
  const { session } = createSkillsManagerTuiSession(TEST_SKILLS);
  await session.initialize();

  // Navigate down
  await session.handleKey(KEYS.DOWN);
  const selectedId = session.getSelectedId();

  // Should have moved selection
  assertEquals(selectedId !== null, true);
});

testSkillsSessionRender(
  "SkillsManagerView: shows skill detail on select",
  [KEYS.DOWN, KEYS.DOWN, KEYS.ENTER],
  (_rendered, session) => {
    assertEquals(session.isShowingDetail(), true);
    const detail = session.renderDetail();
    assertStringIncludes(detail, "Skill:");
  },
);

testSkillsSessionRender(
  "SkillsManagerView: opens search dialog",
  [KEYS.SLASH],
  (_rendered, session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

testSkillsSessionRender(
  "SkillsManagerView: cancels search dialog",
  [KEYS.SLASH, KEYS.ESCAPE],
  (_rendered, session) => {
    assertEquals(session.hasActiveDialog(), false);
  },
);

testSkillsSessionRender(
  "SkillsManagerView: groups by source",
  [],
  (rendered, session) => {
    const extensions = session.getExtensions();
    // Default grouping is by source
    assertEquals(extensions.groupBy, "source");
    // Should show group headers
    assertStringIncludes(rendered, "Core Skills");
  },
);

testSkillsSessionRender(
  "SkillsManagerView: cycles grouping mode",
  [KEYS.G, KEYS.G, KEYS.G], // Cycle 3 times to return to source
  (_rendered, _session) => {
    // This test logic is slightly different from original which asserted step by step
    // But here we can check final state or we can use the manual test below for step-by-step
  },
);
// Manual test for step-by-step grouping assertion
Deno.test("SkillsManagerView: cycles grouping mode (step-by-step)", async () => {
  const { session } = createSkillsManagerTuiSession(TEST_SKILLS);
  await session.initialize();

  // Cycle grouping
  await session.handleKey(KEYS.G);
  let extensions = session.getExtensions();
  assertEquals(extensions.groupBy, "status");

  await session.handleKey(KEYS.G);
  extensions = session.getExtensions();
  assertEquals(extensions.groupBy, "none");

  await session.handleKey(KEYS.G);
  extensions = session.getExtensions();
  assertEquals(extensions.groupBy, "source");
});

testSkillsSessionRender(
  "SkillsManagerView: shows help screen",
  [KEYS.QUESTION],
  (_rendered, session) => {
    assertEquals(session.isShowingHelp(), true);
    const help = session.renderHelp();
    assertStringIncludes(help.join("\n"), "Navigation");
  },
);

// ===== AgentStatusView Skills Tests =====

Deno.test("AgentStatusView: displays defaultSkills in detail", async () => {
  const mockService = new MinimalAgentServiceMock([
    {
      id: "agent-1",
      name: "CodeReviewer",
      model: TEST_MODEL_OPENAI,
      status: AgentStatus.ACTIVE,
      lastActivity: new Date().toISOString(),
      capabilities: ["code-review"],
      defaultSkills: ["tdd-methodology", "typescript-patterns"],
    },
  ]);

  const view = new AgentStatusView(mockService);
  const session = view.createTuiSession(false);

  await session.initialize();

  // Navigate to agent and show detail (use handleKey as that's the AgentStatusView's method)
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.ENTER);

  // renderDetail returns string[] in AgentStatusView
  const detail = session.renderDetail();
  const detailText = Array.isArray(detail) ? detail.join("\n") : detail;
  assertStringIncludes(detailText, "Default Skills:");
  assertStringIncludes(detailText, "tdd-methodology");
});

// ===== RequestManagerView Skills Tests =====

Deno.test("RequestManagerView: shows skills in request detail", async () => {
  const requests: IRequest[] = [
    {
      trace_id: "test-123",
      filename: "request-test.md",
      path: "request-test.md",
      subject: "Test Request",
      status: RequestStatus.COMPLETED,
      priority: RequestPriority.NORMAL,
      identity: "code-reviewer",
      created: new Date().toISOString(),
      created_by: "test@example.com",
      source: RequestSource.CLI,
      skills: {
        explicit: ["security-audit"],
        autoMatched: ["code-review"],
        fromDefaults: ["typescript-patterns"],
        skipped: [],
      },
    },
  ];

  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Navigate to request and show detail (use handleKey for RequestManagerView)
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.ENTER);

  // renderDetail returns string[] for RequestManager
  const detail = session.renderDetail();
  const detailText = Array.isArray(detail) ? detail.join("\n") : detail;
  assertStringIncludes(detailText, "Applied Skills:");
  assertStringIncludes(detailText, "security-audit");
});
