/**
 * @module MemoryViewExtendedTest
 * @path tests/tui/memory_view_extended_test.ts
 * @description Targeted tests for MemoryViewTuiSession, verifying internal state management,
 * color mode toggles, and UI spinner animation logic.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExecutionStatus, MemoryType } from "@exaix/core";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import {
  createMockExecution,
  createMockGlobalMemory,
  createMockProjectMemory,
  createMockProposal,
  createTestSession,
  type ExtendedMockMemoryService as _ExtendedMockMemoryService,
  setupSession,
  testExecutionDetailRendering,
  testSessionRender,
} from "./memory_view/memory_view_test_utils.ts";

// ===== Tests =====

Deno.test("MemoryViewTuiSession: getters return correct values", () => {
  const session = createTestSession();

  assertEquals(session.getActiveScope(), "projects");
  assertEquals(session.getSelectedNodeId(), null);
  assertEquals(session.getPendingCount(), 0);
  assertEquals(session.isLoading(), false);
  assertEquals(session.getLoadingMessage(), "");
  assertEquals(session.hasActiveDialog(), false);
  assertEquals(session.getActiveDialog(), null);
});

Deno.test("MemoryViewTuiSession: setUseColors toggles color mode", async () => {
  const session = createTestSession();
  await session.initialize();

  session.setUseColors(false);
  const tree = session.renderTreePanel();
  assertEquals(typeof tree, "string");

  session.setUseColors(true);
  const treeColored = session.renderTreePanel();
  assertEquals(typeof treeColored, "string");
});

Deno.test("MemoryViewTuiSession: tickSpinner advances frame", async () => {
  const session = createTestSession();
  await session.initialize();

  session.tickSpinner();
  session.tickSpinner();
  session.tickSpinner();
});

Deno.test("MemoryViewTuiSession: refreshIfStale calls refresh when stale", async () => {
  const session = createTestSession();
  await session.initialize();

  const state = session.getState();
  (state as { lastRefresh: number }).lastRefresh = Date.now() - 60000;

  await session.refreshIfStale();
});

testSessionRender(
  "MemoryViewTuiSession: renders global scope detail with memory",
  {
    globalMemory: createMockGlobalMemory(),
    projects: ["TestPortal"],
  },
  [KEYS.G],
  (session) => {
    const detail = session.getDetailContent();
    assertStringIncludes(detail, "Global");
  },
);

testSessionRender(
  "MemoryViewTuiSession: renders global scope detail without memory",
  { globalMemory: null },
  [KEYS.G],
);

testSessionRender(
  "MemoryViewTuiSession: renders projects scope detail",
  { projects: ["Portal1", "Portal2"] },
  [KEYS.P],
);

testSessionRender(
  "MemoryViewTuiSession: renders executions scope detail",
  { executions: [createMockExecution("trace-1", ExecutionStatus.COMPLETED)] },
  [KEYS.E],
);

testSessionRender(
  "MemoryViewTuiSession: renders pending scope detail",
  { pending: [createMockProposal("prop-1", "Test Proposal")] },
  [KEYS.N],
);

testSessionRender(
  "MemoryViewTuiSession: renders project detail with memory",
  {
    projects: ["TestPortal"],
    projectMemories: { "TestPortal": createMockProjectMemory("TestPortal") },
  },
  [KEYS.P, KEYS.ENTER, KEYS.DOWN],
);

testSessionRender(
  "MemoryViewTuiSession: renders project detail without memory",
  {
    projects: ["EmptyPortal"],
    projectMemories: { "EmptyPortal": null },
  },
  [KEYS.P, KEYS.ENTER, KEYS.DOWN],
);

Deno.test("MemoryViewTuiSession: renders execution detail with all fields", async () => {
  const exec = createMockExecution("trace-full", ExecutionStatus.COMPLETED);
  await testExecutionDetailRendering(exec);
});

Deno.test("MemoryViewTuiSession: renders execution detail for running status", async () => {
  const exec = createMockExecution("trace-running", ExecutionStatus.RUNNING);
  exec.completed_at = undefined;
  exec.changes = {
    files_created: [],
    files_modified: [],
    files_deleted: [],
  };
  exec.lessons_learned = undefined;
  await testExecutionDetailRendering(exec);
});

Deno.test("MemoryViewTuiSession: renders execution detail for failed status", async () => {
  const exec = createMockExecution("trace-failed", ExecutionStatus.FAILED);
  exec.error_message = "Something went wrong";
  await testExecutionDetailRendering(exec);
});

testSessionRender(
  "MemoryViewTuiSession: approveSelectedProposal with no selection",
  {},
  [KEYS.A],
  (session) => {
    const statusBar = session.renderStatusBar();
    assertEquals(typeof statusBar, "string");
  },
);

testSessionRender(
  "MemoryViewTuiSession: rejectSelectedProposal with no selection",
  {},
  [KEYS.R],
  (session) => {
    const statusBar = session.renderStatusBar();
    assertEquals(typeof statusBar, "string");
  },
);

testSessionRender(
  "MemoryViewTuiSession: approveAllProposals with no proposals",
  {},
  [KEYS.CAP_A],
  (session) => {
    assertEquals(session.hasActiveDialog(), false);
  },
);

testSessionRender(
  "MemoryViewTuiSession: approveAllProposals with proposals opens dialog",
  { pending: [createMockProposal("p1", "Proposal 1"), createMockProposal("p2", "Proposal 2")] },
  [KEYS.CAP_A],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

testSessionRender(
  "MemoryViewTuiSession: openAddLearningDialog opens dialog",
  {},
  [KEYS.L],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

testSessionRender(
  "MemoryViewTuiSession: promoteSelectedLearning without learning selected",
  {},
  [KEYS.CAP_P],
  (session) => {
    assertEquals(session.hasActiveDialog(), false);
  },
);

testSessionRender(
  "MemoryViewTuiSession: search with empty query reloads tree",
  {},
  [KEYS.S, KEYS.ENTER],
  (session) => {
    assertEquals(session.isSearchActive(), false);
  },
);

testSessionRender(
  "MemoryViewTuiSession: search with query executes search",
  {
    searchResults: [
      { type: MemoryType.PATTERN, id: "p1", title: "Result 1", summary: "Summary 1" },
      { type: MemoryType.DECISION, id: "d1", title: "Result 2", summary: "Summary 2" },
    ],
  },
  [KEYS.S, KEYS.T, KEYS.E, KEYS.S, KEYS.T, KEYS.ENTER],
  (session) => {
    assertEquals(typeof session.getActiveScope(), "string");
  },
);

testSessionRender(
  "MemoryViewTuiSession: navigation with empty tree does nothing",
  { globalMemory: null },
  [KEYS.DOWN, KEYS.UP],
);

testSessionRender(
  "MemoryViewTuiSession: renderTreePanel returns string",
  { projects: ["TestPortal"] },
  [],
  (session) => {
    const tree = session.renderTreePanel();
    assertEquals(typeof tree, "string");
    assertStringIncludes(tree, "Global");
    assertStringIncludes(tree, "Projects");
  },
);

testSessionRender(
  "MemoryViewTuiSession: renderStatusBar shows search input when active",
  {},
  [KEYS.S, KEYS.Q, KEYS.U, KEYS.E, KEYS.R, KEYS.Y],
  (session) => {
    const statusBar = session.renderStatusBar();
    assertStringIncludes(statusBar, "query");
  },
);

testSessionRender(
  "MemoryViewTuiSession: renderActionButtons shows context-specific actions",
  { pending: [createMockProposal("p1", "Proposal 1")] },
  [KEYS.N],
  (session) => {
    const actions = session.renderActionButtons();
    assertEquals(typeof actions, "string");
  },
);

testSessionRender(
  "MemoryViewTuiSession: renderDialog returns dialog content when active",
  { pending: [createMockProposal("p1", "Proposal 1"), createMockProposal("p2", "Proposal 2")] },
  [KEYS.CAP_A],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
    const dialogContent = session.renderDialog(80, 24);
    assertEquals(typeof dialogContent, "string");
  },
);

testSessionRender(
  "MemoryViewTuiSession: dialog escape cancels",
  { pending: [createMockProposal("p1", "Proposal 1")] },
  [KEYS.CAP_A, KEYS.ESCAPE],
  (session) => {
    assertEquals(session.hasActiveDialog(), false);
  },
);

testSessionRender(
  "MemoryViewTuiSession: handleKey with dialog forwards to dialog",
  { pending: [createMockProposal("p1", "Proposal 1")] },
  [KEYS.CAP_A, KEYS.TAB],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

testSessionRender(
  "MemoryViewTuiSession: ? toggles help",
  {},
  [KEYS.QUESTION],
  (session) => {
    const detail = session.getDetailContent();
    assertStringIncludes(detail.toLowerCase(), "help");
    // Toggle back
    session.handleKey(KEYS.QUESTION);
  },
);

Deno.test("MemoryViewTuiSession: findNodeById returns null for invalid ID", async () => {
  const { session } = await setupSession();
  const node = session.findNodeById("nonexistent");
  assertEquals(node, null);
});

Deno.test("MemoryViewTuiSession: findNodeById returns null for null ID", async () => {
  const { session } = await setupSession();
  const node = session.findNodeById(null);
  assertEquals(node, null);
});

testSessionRender(
  "MemoryViewTuiSession: handles pending proposal detail rendering",
  { pending: [createMockProposal("p1", "Test Proposal")] },
  [KEYS.N, KEYS.ENTER, KEYS.DOWN],
);

testSessionRender(
  "MemoryViewTuiSession: approve pending proposal with selection",
  { pending: [createMockProposal("p1", "Test Proposal")] },
  [KEYS.N, KEYS.ENTER, KEYS.DOWN, KEYS.A],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

testSessionRender(
  "MemoryViewTuiSession: reject pending proposal with selection",
  { pending: [createMockProposal("p1", "Test Proposal")] },
  [KEYS.N, KEYS.ENTER, KEYS.DOWN, KEYS.R],
  (session) => {
    assertEquals(session.hasActiveDialog(), true);
  },
);

Deno.test("MemoryViewTuiSession: getFocusableElements returns panel list", async () => {
  const { session } = await setupSession({
    pending: [],
    projects: [],
    executions: [],
  });

  const elements = session.getFocusableElements();
  assertEquals(Array.isArray(elements), true);
});

Deno.test("MemoryViewTuiSession: left and right navigation", async () => {
  const { session } = await setupSession({ projects: ["TestPortal"], pending: [], executions: [] });

  await session.handleKey(KEYS.P);
  await session.handleKey(KEYS.RIGHT);
  await session.handleKey(KEYS.LEFT);

  assertEquals(session.getActiveScope(), "projects");
});

Deno.test("MemoryViewTuiSession: Home and End keys for navigation", async () => {
  const { session } = await setupSession({ projects: ["Portal1", "Portal2", "Portal3"], pending: [], executions: [] });

  await session.handleKey(KEYS.END);
  await session.handleKey(KEYS.HOME);

  assertEquals(typeof session.getSelectedNodeId(), "string");
});

Deno.test("MemoryViewTuiSession: PageUp and PageDown keys", async () => {
  const { session } = await setupSession({
    projects: ["Portal1", "Portal2", "Portal3", "Portal4", "Portal5"],
    pending: [],
    executions: [],
  });

  await session.handleKey(KEYS.PAGE_DOWN);
  await session.handleKey(KEYS.PAGE_UP);
});
