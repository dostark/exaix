/**
 * @module MemoryPendingPanelTest
 * @path tests/tui/memory_pending_panel_test.ts
 * @description Verifies the UI presentation of pending memory proposals, ensuring correct
 * categorization and metadata display in the terminal review interface.
 */

import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  type MemoryReferenceType as _MemoryReferenceType,
  MemoryScope,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core";
import { MemoryTuiScope } from "../../src/tui/memory_view/memory_scope.ts";
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { MemoryViewTuiSession as _MemoryViewTuiSession } from "../../src/tui/memory_view.ts";
import { renderPendingPanel, renderStatsPanel } from "../../src/tui/memory_panels/index.ts";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import {
  createInitializedMemoryViewSession,
  createMockProposals,
  type MinimalMemoryServiceMock as _MinimalMemoryServiceMock,
} from "./helpers.ts";
import { KEYS } from "../../src/tui/helpers/keyboard.ts";

// ===== Test Fixtures =====

// ===== renderPendingPanel Tests =====

Deno.test("renderPendingPanel: renders proposals list", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 0, options);

  assertExists(rendered);
  assertEquals(rendered.includes("Pending Proposals"), true);
  assertEquals(rendered.includes("3 proposal(s)"), true);
});

Deno.test("renderPendingPanel: shows proposal titles", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 0, options);

  assertStringIncludes(rendered, "Error Handling Pattern");
  assertStringIncludes(rendered, "API Rate Limiting");
  assertStringIncludes(rendered, "Database Connection");
});

Deno.test("renderPendingPanel: shows categories", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 0, options);

  assertEquals(rendered.includes("[pattern]"), true);
  assertEquals(rendered.includes("[decision]"), true);
  assertEquals(rendered.includes("[troubleshooting]"), true);
});

Deno.test("renderPendingPanel: shows scope", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 0, options);

  assertEquals(rendered.includes("Scope: project"), true);
  assertEquals(rendered.includes("Scope: global"), true);
});

Deno.test("renderPendingPanel: marks selected item", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 1, options);
  const lines = rendered.split("\n");

  // Find line with API Rate Limiting
  const selectedLine = lines.find((l) => l.includes("API Rate Limiting"));
  assertExists(selectedLine);
  assertEquals(selectedLine.startsWith(">"), true);
});

Deno.test("renderPendingPanel: handles empty list", () => {
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel([], 0, options);

  assertEquals(rendered.includes("No pending proposals"), true);
  assertEquals(rendered.includes("created when agents identify"), true);
});

Deno.test("renderPendingPanel: formats age correctly", () => {
  const proposals = createMockProposals();
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderPendingPanel(proposals, 0, options);

  // Should show relative time
  assertEquals(rendered.includes("hours ago") || rendered.includes("days ago") || rendered.includes("min ago"), true);
});

Deno.test("renderPendingPanel: limits display to 10 items", () => {
  const proposals: IMemoryUpdateProposal[] = [];
  for (let i = 0; i < 15; i++) {
    proposals.push({
      id: `proposal-${i}`,
      identity_id: "test-identity",
      operation: MemoryOperation.ADD,
      learning: {
        id: `learning-${i}`,
        title: `ILearning as ILearning ${i}`,
        category: LearningCategory.PATTERN,
        description: "Test",
        confidence: ConfidenceAssessmentLevel.HIGH,
        tags: [],
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.GLOBAL,
        created_at: new Date().toISOString(),
      },
      target_scope: MemoryScope.GLOBAL,
      reason: "Test",
      created_at: new Date().toISOString(),
      status: MemoryStatus.PENDING,
    });
  }

  const options = { width: 80, height: 20, useColors: false };
  const rendered = renderPendingPanel(proposals, 0, options);

  assertEquals(rendered.includes("... and 5 more"), true);
});

// ===== renderStatsPanel Tests =====

Deno.test("renderStatsPanel: renders statistics", () => {
  const stats = {
    projectCount: 5,
    executionCount: 127,
    pendingCount: 3,
    globalLearnings: 12,
  };
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderStatsPanel(stats, options);

  assertExists(rendered);
  assertEquals(rendered.includes("Memory Statistics"), true);
  assertEquals(rendered.includes("5"), true);
  assertEquals(rendered.includes("127"), true);
  assertEquals(rendered.includes("3"), true);
  assertEquals(rendered.includes("12"), true);
});

Deno.test("renderStatsPanel: shows all categories", () => {
  const stats = {
    projectCount: 3,
    executionCount: 50,
    pendingCount: 2,
    globalLearnings: 10,
  };
  const options = { width: 80, height: 20, useColors: false };

  const rendered = renderStatsPanel(stats, options);

  assertEquals(rendered.includes("Projects:"), true);
  assertEquals(rendered.includes("Executions:"), true);
  assertEquals(rendered.includes("Pending:"), true);
  assertEquals(rendered.includes("Learnings:"), true);
});

// ===== MemoryViewTuiSession Pending Actions Tests =====

Deno.test("MemoryViewTuiSession: 'n' jumps to pending scope", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.N);

  assertEquals(session.getActiveScope(), MemoryTuiScope.PENDING);
});

Deno.test("MemoryViewTuiSession: pending badge shows count", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  const count = session.getPendingCount();
  assertEquals(count, 3);
});

Deno.test("MemoryViewTuiSession: 'a' opens approve dialog when on pending item", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  // Navigate to pending and select a proposal
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER); // Expand pending
  await session.handleKey(KEYS.DOWN); // Select first proposal

  await session.handleKey(KEYS.A);

  assertEquals(session.hasActiveDialog(), true);
});

Deno.test("MemoryViewTuiSession: 'r' opens reject dialog when on pending item", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  // Navigate to pending and select a proposal
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.R);

  assertEquals(session.hasActiveDialog(), true);
});

Deno.test("MemoryViewTuiSession: 'A' opens bulk approve dialog", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.CAP_A);

  assertEquals(session.hasActiveDialog(), true);
});

Deno.test("MemoryViewTuiSession: 'l' opens add learning dialog", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.L);

  assertEquals(session.hasActiveDialog(), true);
});

Deno.test("MemoryViewTuiSession: action buttons show pending actions", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  // Navigate to pending and select a proposal
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);

  const buttons = session.renderActionButtons();
  assertEquals(buttons.includes("[a] Approve"), true);
  assertEquals(buttons.includes("[r] Reject"), true);
  assertEquals(buttons.includes("[A] Approve All"), true);
});

Deno.test("MemoryViewTuiSession: dialog receives key events", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.CAP_A); // Open bulk approve dialog
  assertEquals(session.hasActiveDialog(), true);

  await session.handleKey(KEYS.ESCAPE); // Cancel dialog
  assertEquals(session.hasActiveDialog(), false);
});

Deno.test("MemoryViewTuiSession: renderDialog returns dialog content", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.CAP_A); // Open bulk approve dialog

  const dialogContent = session.renderDialog(80, 20);
  assertExists(dialogContent);
  assertEquals(dialogContent.includes("Approve All"), true);
});

Deno.test("MemoryViewTuiSession: approve action updates count", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  const initialCount = session.getPendingCount();
  assertEquals(initialCount, 3);

  // Navigate to pending item
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);

  // Open approve dialog and confirm
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.Y);

  // Count should decrease
  const newCount = session.getPendingCount();
  assertEquals(newCount, 2);
});

Deno.test("MemoryViewTuiSession: reject action with reason", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  // Navigate to pending item
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);

  // Open reject dialog
  await session.handleKey(KEYS.R);
  assertEquals(session.hasActiveDialog(), true);

  // Navigate to reject button and confirm
  await session.handleKey(KEYS.TAB); // to reject button
  await session.handleKey(KEYS.ENTER);

  assertEquals(session.hasActiveDialog(), false);
  assertEquals(session.getPendingCount(), 2);
});

Deno.test("MemoryViewTuiSession: help shows new action keys", async () => {
  const { session } = await createInitializedMemoryViewSession(createMockProposals());

  await session.handleKey(KEYS.QUESTION); // Open help

  const help = session.getDetailContent();
  assertEquals(help.includes("a: Approve"), true);
  assertEquals(help.includes("r: Reject"), true);
  assertEquals(help.includes("A: Approve all"), true);
  assertEquals(help.includes("L: Add new learning"), true);
});
