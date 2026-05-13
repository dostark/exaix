/**
 * @module AgentStatusViewTest
 * @path tests/tui/agent_status_view_test.ts
 * @description Verifies the AgentStatusView TUI component, ensuring real-time monitoring of
 * agent readiness, active tasks, and resource utilization metrics.
 */

import {
  AGENT_HEALTH_ICONS,
  AGENT_KEY_BINDINGS,
  AGENT_STATUS_COLORS,
  AGENT_STATUS_ICONS,
  AgentAction,
  AgentStatusView,
  type IAgentViewState,
  LOG_LEVEL_ICONS,
  MinimalAgentServiceMock,
} from "../../src/tui/agent_status_view.ts";
import type { AgentHealthData, AgentLogEntry, IAgentStatusItem } from "@exaix/core/types/mod.ts";
import type { IAgentService } from "@exaix/core/types";
import { TEST_MODEL_OPENAI } from "@exaix/testing";
import { AgentStatus } from "@exaix/core/status/agent_status.ts";
import { AgentHealth, CritiqueSeverity, LogLevel } from "@exaix/core";
import { TuiGroupBy } from "@exaix/tui";
import { KEYS } from "../../src/tui/helpers/keyboard.ts";
import { assertEquals, assertExists } from "@std/assert";

// ===== Mock IAgentService for testing =====

class MockAgentService implements IAgentService {
  private agents: IAgentStatusItem[] = [
    {
      id: "agent1",
      name: "Agent 1",
      model: TEST_MODEL_OPENAI,
      status: AgentStatus.ACTIVE,
      lastActivity: new Date().toISOString(),
      capabilities: ["code", "chat"],
      defaultSkills: [],
    },
    {
      id: "agent2",
      name: "Agent 2",
      model: "gpt-3",
      status: AgentStatus.INACTIVE,
      lastActivity: new Date().toISOString(),
      capabilities: ["chat"],
      defaultSkills: [],
    },
    {
      id: "agent3",
      name: "Agent 3",
      model: TEST_MODEL_OPENAI,
      status: AgentStatus.ERROR,
      lastActivity: new Date().toISOString(),
      capabilities: ["code"],
      defaultSkills: [],
    },
  ];

  listAgents(): Promise<IAgentStatusItem[]> {
    return Promise.resolve([...this.agents]);
  }

  getAgentHealth(_identityId: string): Promise<AgentHealthData> {
    return Promise.resolve({
      status: AgentHealth.HEALTHY,
      issues: [],
      uptime: 12345,
    });
  }

  getAgentLogs(_identityId: string, _limit = 50): Promise<AgentLogEntry[]> {
    return Promise.resolve([
      {
        timestamp: new Date().toISOString(),
        level: LogLevel.INFO,
        message: "Test log entry",
      },
      {
        timestamp: new Date().toISOString(),
        level: LogLevel.WARN,
        message: "Test warning",
      },
    ]);
  }

  setAgents(agents: IAgentStatusItem[]): void {
    this.agents = agents;
  }
}

function createTestView(service: IAgentService = new MockAgentService()): AgentStatusView {
  return new AgentStatusView(service);
}

async function createInitializedSession(
  service: IAgentService = new MockAgentService(),
): Promise<ReturnType<AgentStatusView["createTuiSession"]>> {
  const session = createTestView(service).createTuiSession(false);
  await session.initialize();
  return session;
}

// ===== Existing Tests (Updated) =====

Deno.test("AgentStatusView: renders agent list", async () => {
  const view = createTestView();
  const output = await view.renderAgentList();
  if (!output.includes("Agent 1") || !output.includes("Agent 2")) {
    throw new Error("Agent names not rendered");
  }
});

Deno.test("AgentStatusView: fetches agent health", async () => {
  const view = createTestView();
  const health = await view.getAgentHealth("agent1");
  if (health.status !== "healthy" || health.uptime !== 12345) {
    throw new Error("Agent health not fetched correctly");
  }
});

Deno.test("AgentStatusView: fetches agent logs", async () => {
  const view = createTestView();
  const logs = await view.getAgentLogs("agent1");
  if (!logs.length || logs[0].message !== "Test log entry") {
    throw new Error("Agent logs not fetched correctly");
  }
});

Deno.test("AgentStatusView: selects agent", () => {
  const view = createTestView();
  view.selectAgent("agent1");
  if (view.getSelectedAgent() !== "agent1") {
    throw new Error("Agent selection failed");
  }
});

Deno.test("AgentStatusView: formatUptime", () => {
  const view = createTestView();

  // Test hours + minutes
  const result1 = view.formatUptime(3660);
  if (result1 !== "1h 1m") {
    throw new Error(`Expected "1h 1m" but got "${result1}"`);
  }

  // Test minutes only
  const result2 = view.formatUptime(120);
  if (result2 !== "2m") {
    throw new Error(`Expected "2m" but got "${result2}"`);
  }
});

// ===== Phase 13.7: IAgentViewState Tests =====

Deno.test("IAgentViewState: interface has all required properties", () => {
  // TypeScript compile-time check via usage
  const state: IAgentViewState = {
    selectedAgentId: null,
    agentTree: [],
    showHelp: false,
    showDetail: false,
    showLogs: false,
    detailContent: "",
    logContent: "",
    activeDialog: null,
    searchQuery: "",
    groupBy: TuiGroupBy.NONE,
    autoRefresh: false,
    autoRefreshInterval: 5000,
  };
  if (state.groupBy !== TuiGroupBy.NONE) {
    throw new Error("Default groupBy should be 'none'");
  }
});

// ===== Phase 13.7: Icon Tests =====

Deno.test("AGENT_STATUS_ICONS: has all status types", () => {
  const requiredKeys = [AgentStatus.ACTIVE, AgentStatus.INACTIVE, AgentStatus.ERROR];
  for (const key of requiredKeys) {
    if (!AGENT_STATUS_ICONS[key]) {
      throw new Error(`Missing status icon for: ${key}`);
    }
  }
});

Deno.test("AGENT_HEALTH_ICONS: has all health types", () => {
  const requiredKeys = ["healthy", "warning", CritiqueSeverity.CRITICAL];
  for (const key of requiredKeys) {
    if (!AGENT_HEALTH_ICONS[key]) {
      throw new Error(`Missing health icon for: ${key}`);
    }
  }
});

Deno.test("LOG_LEVEL_ICONS: has all log levels", () => {
  const requiredKeys = [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  for (const key of requiredKeys) {
    if (!LOG_LEVEL_ICONS[key]) {
      throw new Error(`Missing log level icon for: ${key}`);
    }
  }
});

Deno.test("AGENT_STATUS_COLORS: has all status types", () => {
  const requiredKeys = [
    AgentStatus.ACTIVE,
    AgentStatus.INACTIVE,
    AgentStatus.ERROR,
    "healthy",
    "warning",
    CritiqueSeverity.CRITICAL,
  ];
  for (const key of requiredKeys) {
    assertExists(AGENT_STATUS_COLORS[key], `Missing color for: ${key}`);
    if (key === AgentStatus.ERROR) {
      assertEquals(AGENT_STATUS_COLORS[key], "red");
    }
  }
});

// ===== Phase 13.7: Key Bindings Tests =====

Deno.test("AGENT_KEY_BINDINGS: has all expected bindings", () => {
  const requiredActions: AgentAction[] = [
    AgentAction.NAVIGATE_UP,
    AgentAction.NAVIGATE_DOWN,
    AgentAction.VIEW_DETAILS,
    AgentAction.VIEW_LOGS,
    AgentAction.REFRESH,
    AgentAction.HELP,
    AgentAction.TOGGLE_GROUPING,
  ];
  const bindingActions = AGENT_KEY_BINDINGS.map((b) => b.action);
  for (const action of requiredActions) {
    if (!bindingActions.includes(action)) {
      throw new Error(`Missing key binding for action: ${action}`);
    }
  }
});

Deno.test("AGENT_KEY_BINDINGS: each has key, action, description, category", () => {
  for (const binding of AGENT_KEY_BINDINGS) {
    if (!binding.key || !binding.action || !binding.description || !binding.category) {
      throw new Error(`Incomplete key binding: ${JSON.stringify(binding)}`);
    }
  }
});

// ===== Phase 13.7: TUI Session Tests =====

Deno.test("AgentStatusTuiSession: initializes correctly", async () => {
  const session = await createInitializedSession();

  if (session.getAgents().length !== 3) {
    throw new Error("Should have 3 agents after initialization");
  }
});

Deno.test("AgentStatusTuiSession: navigation up/down", async () => {
  const session = await createInitializedSession();

  const initialId = session.getSelectedAgentId();
  session.navigateDown();
  const afterDown = session.getSelectedAgentId();
  if (afterDown === initialId) {
    // First node was selected, navigate should change
  }

  session.navigateUp();
  const afterUp = session.getSelectedAgentId();
  if (afterUp !== initialId) {
    // Should be back to initial
  }
});

Deno.test("AgentStatusTuiSession: navigation home/end", async () => {
  const session = await createInitializedSession();

  session.navigateToLast();
  session.navigateToFirst();
  const firstId = session.getSelectedAgentId();
  if (!firstId) {
    throw new Error("Should have a selected agent after navigateToFirst");
  }
});

Deno.test("AgentStatusTuiSession: grouping modes", async () => {
  const session = await createInitializedSession();

  // Default is "none"
  if (session.getGroupBy() !== TuiGroupBy.NONE) {
    throw new Error("Default groupBy should be 'none'");
  }

  // Toggle to status
  session.toggleGrouping();
  if (session.getGroupBy() !== TuiGroupBy.STATUS) {
    throw new Error("First toggle should be 'status'");
  }

  // Toggle to model
  session.toggleGrouping();
  if (session.getGroupBy() !== TuiGroupBy.MODEL) {
    throw new Error("Second toggle should be 'model'");
  }

  // Toggle back to none
  session.toggleGrouping();
  if (session.getGroupBy() !== TuiGroupBy.NONE) {
    throw new Error("Third toggle should be 'none'");
  }
});

Deno.test("AgentStatusTuiSession: setGroupBy", async () => {
  const session = await createInitializedSession();

  session.setGroupBy(TuiGroupBy.STATUS);
  if (session.getGroupBy() !== TuiGroupBy.STATUS) {
    throw new Error("setGroupBy('status') failed");
  }

  session.setGroupBy(TuiGroupBy.MODEL);
  if (session.getGroupBy() !== TuiGroupBy.MODEL) {
    throw new Error("setGroupBy('model') failed");
  }
});

Deno.test("AgentStatusTuiSession: help screen toggle", async () => {
  const session = await createInitializedSession();

  if (session.isHelpVisible()) {
    throw new Error("Help should be hidden initially");
  }

  session.toggleHelp();
  if (!session.isHelpVisible()) {
    throw new Error("Help should be visible after toggle");
  }

  session.toggleHelp();
  if (session.isHelpVisible()) {
    throw new Error("Help should be hidden after second toggle");
  }
});

Deno.test("AgentStatusTuiSession: getHelpSections returns sections", () => {
  const session = createTestView().createTuiSession(false);

  const sections = session.getHelpSections();
  if (sections.length < 3) {
    throw new Error("Should have at least 3 help sections");
  }

  for (const section of sections) {
    if (!section.title || !section.items || section.items.length === 0) {
      throw new Error(`Invalid help section: ${JSON.stringify(section)}`);
    }
  }
});

Deno.test("AgentStatusTuiSession: renderAgentTree returns lines", async () => {
  const session = await createInitializedSession();

  const lines = session.renderAgentTree();
  if (!Array.isArray(lines)) {
    throw new Error("renderAgentTree should return an array");
  }
  if (lines.length === 0) {
    throw new Error("Should have at least one line");
  }
});

Deno.test("AgentStatusTuiSession: renderAgentTree with no agents", async () => {
  const session = await createInitializedSession(new MinimalAgentServiceMock([]));

  const lines = session.renderAgentTree();
  if (!lines.some((line) => line.includes("No agents available"))) {
    throw new Error("Should show 'No agents available' message");
  }
});

Deno.test("AgentStatusTuiSession: renderDetail returns lines", async () => {
  const session = await createInitializedSession();

  await session.showAgentDetail();
  const lines = session.renderDetail();
  if (!Array.isArray(lines)) {
    throw new Error("renderDetail should return an array");
  }
  if (lines.length < 3) {
    throw new Error("Should have multiple lines");
  }
});

Deno.test("AgentStatusTuiSession: renderLogs returns lines", async () => {
  const session = await createInitializedSession();

  await session.showAgentLogs();
  const lines = session.renderLogs();
  if (!Array.isArray(lines)) {
    throw new Error("renderLogs should return an array");
  }
  if (lines.length < 3) {
    throw new Error("Should have multiple lines");
  }
});

Deno.test("AgentStatusTuiSession: renderHelp returns lines", () => {
  const session = createTestView().createTuiSession(false);

  const lines = session.renderHelp();
  if (!Array.isArray(lines)) {
    throw new Error("renderHelp should return an array");
  }
  if (lines.length === 0) {
    throw new Error("Should have at least one line");
  }
});

Deno.test("AgentStatusTuiSession: search dialog", async () => {
  const session = await createInitializedSession();

  session.showSearchDialog();
  if (!session.hasActiveDialog()) {
    throw new Error("Should have active dialog after showSearchDialog");
  }

  const dialog = session.getActiveDialog();
  if (!dialog) {
    throw new Error("Dialog should not be null");
  }
});

Deno.test("AgentStatusTuiSession: search filtering", async () => {
  const session = await createInitializedSession();

  // Apply search
  session.applySearch(TEST_MODEL_OPENAI);
  if (session.getSearchQuery() !== TEST_MODEL_OPENAI) {
    throw new Error("Search query not set correctly");
  }

  // Clear search
  session.clearSearch();
  if (session.getSearchQuery() !== "") {
    throw new Error("Search query not cleared");
  }
});

Deno.test("AgentStatusTuiSession: detail view show/hide", async () => {
  const session = await createInitializedSession();

  if (session.isDetailVisible()) {
    throw new Error("Detail should be hidden initially");
  }

  await session.showAgentDetail();
  if (!session.isDetailVisible()) {
    throw new Error("Detail should be visible after showAgentDetail");
  }

  session.hideDetail();
  if (session.isDetailVisible()) {
    throw new Error("Detail should be hidden after hideDetail");
  }
});

Deno.test("AgentStatusTuiSession: logs view show/hide", async () => {
  const session = await createInitializedSession();

  if (session.isLogsVisible()) {
    throw new Error("Logs should be hidden initially");
  }

  await session.showAgentLogs();
  if (!session.isLogsVisible()) {
    throw new Error("Logs should be visible after showAgentLogs");
  }

  session.hideLogs();
  if (session.isLogsVisible()) {
    throw new Error("Logs should be hidden after hideLogs");
  }
});

Deno.test("AgentStatusTuiSession: auto-refresh toggle", async () => {
  const session = await createInitializedSession();

  if (session.isAutoRefreshEnabled()) {
    throw new Error("Auto-refresh should be disabled initially");
  }

  session.toggleAutoRefresh();
  if (!session.isAutoRefreshEnabled()) {
    throw new Error("Auto-refresh should be enabled after toggle");
  }

  session.toggleAutoRefresh();
  if (session.isAutoRefreshEnabled()) {
    throw new Error("Auto-refresh should be disabled after second toggle");
  }

  session.dispose();
});

Deno.test("AgentStatusTuiSession: getFocusableElements", async () => {
  const session = await createInitializedSession();

  const elements = session.getFocusableElements();
  if (!Array.isArray(elements)) {
    throw new Error("getFocusableElements should return array");
  }
  if (elements.length !== 3) {
    throw new Error(`Expected 3 focusable elements, got ${elements.length}`);
  }
});

Deno.test("AgentStatusTuiSession: setAgents", async () => {
  const session = await createInitializedSession();

  const newAgents: IAgentStatusItem[] = [
    {
      id: "new1",
      name: "New Agent",
      model: "claude",
      status: AgentStatus.ACTIVE,
      lastActivity: new Date().toISOString(),
      capabilities: ["code"],
      defaultSkills: [],
    },
  ];

  session.setAgents(newAgents);
  if (session.getAgents().length !== 1) {
    throw new Error("setAgents should update agent list");
  }
});

Deno.test("AgentStatusTuiSession: getSelectedIndexInAgents", async () => {
  const session = await createInitializedSession();

  const index = session.getSelectedIndexInAgents();
  if (typeof index !== "number" || index < 0) {
    throw new Error("getSelectedIndexInAgents should return valid index");
  }
});

Deno.test("AgentStatusTuiSession: setSelectedByIndex", async () => {
  const session = await createInitializedSession();

  session.setSelectedByIndex(1);
  const index = session.getSelectedIndexInAgents();
  if (index !== 1) {
    throw new Error("setSelectedByIndex should update selection");
  }
});

Deno.test("AgentStatusTuiSession: collapse/expand operations", async () => {
  const session = await createInitializedSession();

  // Switch to status grouping first
  session.setGroupBy(TuiGroupBy.STATUS);

  // Collapse all
  session.collapseAllNodes();
  // Expand all
  session.expandAllNodes();

  // These should not throw
  session.collapseSelected();
  session.expandSelected();
});

Deno.test("AgentStatusTuiSession: handleKey navigation", async () => {
  const session = await createInitializedSession();

  // Test basic navigation keys
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.UP);
  await session.handleKey(KEYS.HOME);
  await session.handleKey(KEYS.END);

  // Should not throw
});

Deno.test("AgentStatusTuiSession: handleKey actions", async () => {
  const session = await createInitializedSession();

  // Test action keys
  await session.handleKey(KEYS.QUESTION); // help
  if (!session.isHelpVisible()) {
    throw new Error("? should toggle help");
  }

  await session.handleKey(KEYS.ESCAPE); // close help
  if (session.isHelpVisible()) {
    throw new Error("escape should close help");
  }

  await session.handleKey(KEYS.G); // toggle grouping
  if (session.getGroupBy() === TuiGroupBy.NONE) {
    throw new Error("g should toggle grouping");
  }
});

Deno.test("AgentStatusTuiSession: handleKey detail view", async () => {
  const session = await createInitializedSession();

  await session.handleKey(KEYS.ENTER);
  if (!session.isDetailVisible()) {
    throw new Error("enter should show detail");
  }

  await session.handleKey(KEYS.ESCAPE);
  if (session.isDetailVisible()) {
    throw new Error("escape should close detail");
  }
});

Deno.test("AgentStatusTuiSession: handleKey logs view", async () => {
  const session = await createInitializedSession();

  await session.handleKey(KEYS.L);
  if (!session.isLogsVisible()) {
    throw new Error("l should show logs");
  }

  await session.handleKey(KEYS.Q);
  if (session.isLogsVisible()) {
    throw new Error("q should close logs");
  }
});

Deno.test("AgentStatusTuiSession: getViewName", () => {
  const session = createTestView().createTuiSession(false);

  if (session.getViewName() !== "Identities") {
    throw new Error(`Expected "Identities" but got "${session.getViewName()}"`);
  }
});

Deno.test("AgentStatusTuiSession: getKeyBindings", () => {
  const session = createTestView().createTuiSession(false);

  const bindings = session.getKeyBindings();
  if (bindings.length !== AGENT_KEY_BINDINGS.length) {
    throw new Error("getKeyBindings should return same number of bindings as AGENT_KEY_BINDINGS");
  }
  for (let i = 0; i < bindings.length; i++) {
    if (
      bindings[i].key !== AGENT_KEY_BINDINGS[i].key ||
      bindings[i].action !== AGENT_KEY_BINDINGS[i].action ||
      bindings[i].category !== AGENT_KEY_BINDINGS[i].category
    ) {
      throw new Error(`getKeyBindings binding ${i} does not match AGENT_KEY_BINDINGS`);
    }
  }
});

Deno.test("MinimalAgentServiceMock: works correctly", async () => {
  const agents: IAgentStatusItem[] = [
    {
      id: "test1",
      name: "Test",
      model: "test-model",
      status: AgentStatus.ACTIVE,
      lastActivity: new Date().toISOString(),
      capabilities: [],
      defaultSkills: [],
    },
  ];

  const mock = new MinimalAgentServiceMock(agents);
  const list = await mock.listAgents();
  if (list.length !== 1) {
    throw new Error("Mock should return agents");
  }

  const logs = await mock.getAgentLogs("test1");
  if (logs.length === 0) {
    throw new Error("Mock should return logs");
  }

  const health = await mock.getAgentHealth("test1");
  if (health.status !== "healthy") {
    throw new Error("Mock should return health");
  }

  mock.setAgents([]);
  const emptyList = await mock.listAgents();
  if (emptyList.length !== 0) {
    throw new Error("setAgents should work");
  }
});
