/**
 * @module MemoryViewTest
 * @path apps/tui/tests/memory_view_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the core MemoryView terminal session, ensuring correct initialization
 * of the knowledge tree, node selection, and pending proposal counts.
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { MemoryScope } from "@exaix/core";
import { MemoryTuiScope } from "../src/memory_view/memory_scope.ts";

import { MemoryView, MemoryViewTuiSession } from "../src/memory_view.ts";
import type { IMemoryService } from "@exaix/core/types";
import { MockMemoryService } from "../src/tui_dashboard_mocks.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

// ===== Test Setup =====

function createTestSession(): MemoryViewTuiSession {
  const mockService = new MockMemoryService();
  return new MemoryViewTuiSession(mockService as Partial<IMemoryService> as IMemoryService);
}

async function enterSearchAndType(session: MemoryViewTuiSession, text: string): Promise<void> {
  // Enter search mode
  await session.handleKey(KEYS.S);
  // Type each character
  for (const char of text) {
    await session.handleKey(char);
  }
}

// ===== Session Initialization Tests =====

Deno.test("MemoryViewTuiSession: initializes with default state", () => {
  const session = createTestSession();
  const state = session.getState();

  assertEquals(state.activeScope, "projects");
  assertEquals(state.selectedNodeId, null);
  assertEquals(state.searchQuery, "");
  assertEquals(state.searchActive, false);
  assertEquals(state.tree.length, 0);
  assertEquals(state.detailContent, "Select a project or memory item to view details.");
});

Deno.test("MemoryViewTuiSession: initialize loads tree and selects first node", async () => {
  const session = createTestSession();
  await session.initialize();

  const state = session.getState();
  assertExists(state.tree);
  assertEquals(state.tree.length > 0, true);
  assertNotEquals(state.selectedNodeId, null);
});

Deno.test("MemoryViewTuiSession: initialize loads pending count", async () => {
  const session = createTestSession();
  await session.initialize();

  // MockMemoryService returns 1 pending proposal
  assertEquals(session.getPendingCount(), 1);
});

// ===== State Accessor Tests =====

Deno.test("MemoryViewTuiSession: getActiveScope returns current scope", async () => {
  const session = createTestSession();
  await session.initialize();

  assertEquals(session.getActiveScope(), "projects");
});

Deno.test("MemoryViewTuiSession: getTree returns tree structure", async () => {
  const session = createTestSession();
  await session.initialize();

  const tree = session.getTree();
  assertExists(tree);
  assertEquals(tree.length >= 3, true); // Global, Projects, Executions at minimum
});

Deno.test("MemoryViewTuiSession: isSearchActive tracks search mode", async () => {
  const session = createTestSession();
  await session.initialize();

  assertEquals(session.isSearchActive(), false);
  await session.handleKey(KEYS.S);
  assertEquals(session.isSearchActive(), true);
});

// ===== Navigation Tests =====

Deno.test("MemoryViewTuiSession: up/down navigation changes selection", async () => {
  const session = createTestSession();
  await session.initialize();

  const initialSelection = session.getSelectedNodeId();
  await session.handleKey(KEYS.DOWN);
  const newSelection = session.getSelectedNodeId();

  assertNotEquals(initialSelection, newSelection);
});

Deno.test("MemoryViewTuiSession: expand/collapse with enter key", async () => {
  const session = createTestSession();
  await session.initialize();

  // Find a node with children
  const tree = session.getTree();
  const projectsNode = tree.find((n) => n.id === "projects");
  assertExists(projectsNode);
  if (!projectsNode) return; // Type guard

  // Initially collapsed (from buildTree)
  assertEquals(projectsNode.expanded, false);

  // Jump to projects and expand
  await session.handleKey(KEYS.P);
  await session.handleKey(KEYS.ENTER);
  assertEquals(projectsNode.expanded, true);

  // Toggle again (collapse)
  await session.handleKey(KEYS.ENTER);
  assertEquals(projectsNode.expanded, false);
});

Deno.test("MemoryViewTuiSession: left key collapses or moves to parent", async () => {
  const session = createTestSession();
  await session.initialize();

  // Jump to projects (expanded)
  await session.handleKey(KEYS.P);
  const tree = session.getTree();
  const projectsNode = tree.find((n) => n.id === "projects");
  assertExists(projectsNode);
  if (!projectsNode) return; // Type guard

  // Collapse with left
  await session.handleKey(KEYS.LEFT);
  assertEquals(projectsNode.expanded, false);
});

Deno.test("MemoryViewTuiSession: home/end keys jump to first/last", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.END);
  // Should be at last node
  const state = session.getState();
  assertExists(state.selectedNodeId);

  await session.handleKey(KEYS.HOME);
  // Should be at first node
  const tree = session.getTree();
  assertEquals(session.getSelectedNodeId(), tree[0].id);
});

// ===== Scope Jumping Tests =====

Deno.test("MemoryViewTuiSession: 'g' jumps to global scope", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.G);
  assertEquals(session.getActiveScope(), MemoryScope.GLOBAL);
  assertEquals(session.getSelectedNodeId(), MemoryScope.GLOBAL);
});

Deno.test("MemoryViewTuiSession: 'p' jumps to projects scope", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.G); // Go elsewhere first
  await session.handleKey(KEYS.P);
  assertEquals(session.getActiveScope(), "projects");
  assertEquals(session.getSelectedNodeId(), "projects");
});

Deno.test("MemoryViewTuiSession: 'e' jumps to executions scope", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.E);
  assertEquals(session.getActiveScope(), "executions");
  assertEquals(session.getSelectedNodeId(), "executions");
});

Deno.test("MemoryViewTuiSession: 'n' jumps to pending scope", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.N);
  assertEquals(session.getActiveScope(), MemoryTuiScope.PENDING);
});

// ===== Search Tests =====

Deno.test("MemoryViewTuiSession: 's' activates search mode", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.S);
  assertEquals(session.isSearchActive(), true);
  assertEquals(session.getSearchQuery(), "");
});

Deno.test("MemoryViewTuiSession: '/' also activates search mode", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.SLASH);
  assertEquals(session.isSearchActive(), true);
});

Deno.test("MemoryViewTuiSession: typing in search mode updates query", async () => {
  const session = createTestSession();
  await session.initialize();

  await enterSearchAndType(session, "test");

  assertEquals(session.getSearchQuery(), "test");
});

Deno.test("MemoryViewTuiSession: backspace removes last character in search", async () => {
  const session = createTestSession();
  await session.initialize();

  await enterSearchAndType(session, "test");
  await session.handleKey(KEYS.BACKSPACE);

  assertEquals(session.getSearchQuery(), "tes");
});

Deno.test("MemoryViewTuiSession: escape exits search mode", async () => {
  const session = createTestSession();
  await session.initialize();

  await enterSearchAndType(session, "test");
  await session.handleKey(KEYS.ESCAPE);

  assertEquals(session.isSearchActive(), false);
  assertEquals(session.getSearchQuery(), "");
});

Deno.test("MemoryViewTuiSession: enter executes search", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.S);
  await session.handleKey(KEYS.P);
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.T);
  await session.handleKey(KEYS.T);
  await session.handleKey(KEYS.E);
  await session.handleKey(KEYS.R);
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);

  assertEquals(session.isSearchActive(), false);

  // Should have search results in tree
  const tree = session.getTree();
  assertExists(tree);
  assertEquals(tree[0]?.label.includes("Search"), true);
});

// ===== Detail Content Tests =====

Deno.test("MemoryViewTuiSession: getDetailContent returns content", async () => {
  const session = createTestSession();
  await session.initialize();

  const content = session.getDetailContent();
  assertExists(content);
  assertEquals(content.length > 0, true);
});

Deno.test("MemoryViewTuiSession: '?' shows help content", async () => {
  const session = createTestSession();
  await session.initialize();

  await session.handleKey(KEYS.QUESTION);
  const content = session.getDetailContent();
  assertEquals(content.includes("Help"), true);
  assertEquals(content.includes("Navigation"), true);
});

// ===== Rendering Tests =====

Deno.test("MemoryViewTuiSession: renderTreePanel returns formatted tree", async () => {
  const session = createTestSession();
  await session.initialize();

  const treePanel = session.renderTreePanel();
  assertExists(treePanel);
  assertEquals(treePanel.includes("Global"), true);
  assertEquals(treePanel.includes("Projects"), true);
});

Deno.test("MemoryViewTuiSession: renderStatusBar shows shortcuts", async () => {
  const session = createTestSession();
  await session.initialize();

  const statusBar = session.renderStatusBar();
  assertEquals(statusBar.includes("[g]lobal"), true);
  assertEquals(statusBar.includes("[p]rojects"), true);
  assertEquals(statusBar.includes("[s]earch"), true);
});

Deno.test("MemoryViewTuiSession: renderStatusBar shows search input when active", async () => {
  const session = createTestSession();
  await session.initialize();

  await enterSearchAndType(session, "test");

  const statusBar = session.renderStatusBar();
  assertEquals(statusBar.includes("Search:"), true);
  assertEquals(statusBar.includes("test"), true);
});

Deno.test("MemoryViewTuiSession: renderActionButtons shows context-specific actions", async () => {
  const session = createTestSession();
  await session.initialize();

  // On projects node
  await session.handleKey(KEYS.P);
  await session.handleKey(KEYS.DOWN); // Navigate to first project child
  const buttons = session.renderActionButtons();
  assertEquals(buttons.includes("Enter") || buttons.includes("View"), true);
});

Deno.test("MemoryViewTuiSession: getFocusableElements returns panel list", () => {
  const session = createTestSession();
  const elements = session.getFocusableElements();

  assertEquals(elements.includes("tree-panel"), true);
  assertEquals(elements.includes("detail-panel"), true);
  assertEquals(elements.length >= 2, true);
});

// ===== MemoryView Controller Tests =====

Deno.test("MemoryView: creates TUI session", () => {
  const mockService = new MockMemoryService();
  const view = new MemoryView(mockService as Partial<IMemoryService> as IMemoryService);

  const session = view.createTuiSession();
  assertExists(session);
});

Deno.test("MemoryView: getService returns service instance", () => {
  const mockService = new MockMemoryService();
  const view = new MemoryView(mockService as Partial<IMemoryService> as IMemoryService);

  const service = view.getService();
  assertExists(service);
});

// ===== Node IFinding Tests =====

Deno.test("MemoryViewTuiSession: findNodeById returns correct node", async () => {
  const session = createTestSession();
  await session.initialize();

  const node = session.findNodeById(MemoryScope.GLOBAL);
  assertExists(node);
  assertEquals(node.id, MemoryScope.GLOBAL);
  assertEquals(node.type, "scope");
});

Deno.test("MemoryViewTuiSession: findNodeById returns null for invalid ID", async () => {
  const session = createTestSession();
  await session.initialize();

  const node = session.findNodeById("nonexistent");
  assertEquals(node, null);
});

Deno.test("MemoryViewTuiSession: findNodeById handles null ID", async () => {
  const session = createTestSession();
  await session.initialize();

  const node = session.findNodeById(null);
  assertEquals(node, null);
});
