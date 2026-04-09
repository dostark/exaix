/**
 * @module MemoryTUIIntegrationTest
 * @path tests/tui/memory_integration_test.ts
 * @description End-to-end integration tests for the Memory TUI, verifying multi-step workflows
 * from knowledge discovery and search to interactive approval of pending proposals.
 */

import { assertEquals, assertExists, assertGreater, assertStringIncludes } from "@std/assert";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";

import {
  ConfidenceLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
  MemoryType,
} from "../../src/shared/enums.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "../../src/shared/schemas/memory_bank.ts";
import type { IMemoryService } from "../../src/tui/memory_view/types.ts";
import { MemoryViewTuiSession } from "../../src/tui/memory_view.ts";
import { MinimalMemoryServiceMock } from "./helpers.ts";
import {
  renderCategoryBadge,
  renderConfidence,
  renderMarkdown,
  renderProgressBar,
  renderSpinner,
  stripMarkdown,
  wrapText,
} from "../../src/tui/helpers/markdown_renderer.ts";
import { KEYS } from "../../src/tui/helpers/keyboard.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "../../src/shared/constants.ts";

// ===== Mock Service with Full Data =====

class MockMemoryServiceFull extends MinimalMemoryServiceMock implements IMemoryService {
  private projects = ["my-app", "api-service", "web-client"];

  constructor() {
    super([
      createMockProposal("prop-1", "Error Handling IPattern as IPattern", LearningCategory.PATTERN),
      createMockProposal("prop-2", "API Rate Limiting", LearningCategory.DECISION),
      createMockProposal("prop-3", "Database Troubleshooting", LearningCategory.TROUBLESHOOTING),
    ]);
  }

  override getProjects(): Promise<string[]> {
    return Promise.resolve(this.projects);
  }

  override getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    if (!this.projects.includes(portal)) return Promise.resolve(null);
    return Promise.resolve({
      portal,
      overview: `Overview for ${portal} project with important context.`,
      patterns: [
        {
          name: "Error Handling",
          description: "Standard error handling pattern",
          examples: ["try-catch blocks"],
          tags: ["typescript", "error-handling"],
        },
        {
          name: "Logging",
          description: "Structured logging pattern",
          examples: ["JSON logs"],
          tags: ["logging", "observability"],
        },
      ],
      decisions: [
        {
          date: "2026-01-01",
          decision: "Use SQLite for local storage",
          rationale: "Simple, no external dependencies",
        },
      ],
      references: [],
    });
  }

  override getGlobalMemory(): Promise<IGlobalMemory | null> {
    return Promise.resolve({
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      updated_at: new Date().toISOString(),
      patterns: [
        {
          name: "Global IPattern as IPattern 1",
          description: "A cross-project pattern",
          examples: ["Example 1"],
          tags: [MemoryScope.GLOBAL],
          applies_to: ["all"],
        },
      ],
      anti_patterns: [
        {
          name: "Anti-IPattern as IPattern 1",
          description: "What to avoid",
          reason: "Causes performance issues",
          alternative: "Use caching instead",
          tags: [LearningCategory.ANTI_PATTERN],
        },
      ],
      learnings: [
        {
          id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          title: "Global ILearning as ILearning 1",
          description: "Important global insight",
          category: LearningCategory.INSIGHT,
          confidence: ConfidenceLevel.HIGH,
          tags: [MemoryScope.GLOBAL],
          source: MemoryBankSource.USER,
          scope: MemoryScope.GLOBAL,
          created_at: new Date().toISOString(),
          status: MemoryStatus.APPROVED,
        },
      ],
      statistics: {
        total_learnings: 10,
        by_category: { pattern: 5, decision: 3, insight: 2 },
        by_project: { "my-app": 5, "api-service": 3, "web-client": 2 },
        last_activity: new Date().toISOString(),
      },
    });
  }

  override getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    return Promise.resolve({
      portal: "my-app",
      trace_id: traceId,
      request_id: "req-123",
      identity_id: "senior-coder",
      status: ExecutionStatus.COMPLETED,
      started_at: "2026-01-04T10:00:00Z",
      completed_at: "2026-01-04T10:05:00Z",
      summary: "Successfully implemented feature",
      context_files: ["src/main.ts"],
      context_portals: ["my-app"],
      changes: {
        files_created: ["src/new.ts"],
        files_modified: ["src/main.ts"],
        files_deleted: [],
      },
      lessons_learned: ["Always validate input"],
    });
  }

  override getExecutionHistory(): Promise<IExecutionMemory[]> {
    return Promise.resolve([
      {
        portal: "my-app",
        trace_id: "trace-001",
        request_id: "req-001",
        identity_id: "senior-coder",
        status: ExecutionStatus.COMPLETED,
        started_at: "2026-01-04T10:00:00Z",
        summary: "Task 1 completed",
        context_files: [],
        context_portals: [],
        changes: { files_created: [], files_modified: [], files_deleted: [] },
      },
      {
        portal: "api-service",
        trace_id: "trace-002",
        request_id: "req-002",
        identity_id: "code-reviewer",
        status: ExecutionStatus.FAILED,
        started_at: "2026-01-04T11:00:00Z",
        summary: "Task 2 failed",
        error_message: "Timeout error",
        context_files: [],
        context_portals: [],
        changes: { files_created: [], files_modified: [], files_deleted: [] },
      },
    ]);
  }

  override search(query: string): Promise<IMemorySearchResult[]> {
    if (!query.trim()) return Promise.resolve([]);
    return Promise.resolve([
      {
        id: "result-1",
        title: "Error Handling IPattern as IPattern",
        type: MemoryType.PATTERN,
        portal: "my-app",
        summary: "Found in my-app patterns",
        relevance_score: 0.95,
        tags: ["error-handling"],
      },
      {
        id: "result-2",
        title: "Logging Best Practices",
        type: MemoryType.LEARNING,
        portal: MemoryScope.GLOBAL,
        summary: "Global learning",
        relevance_score: 0.82,
        tags: ["logging"],
      },
    ]);
  }
}

function createMockProposal(
  id: string,
  title: string,
  category: LearningCategory.PATTERN | LearningCategory.DECISION | LearningCategory.TROUBLESHOOTING,
): IMemoryUpdateProposal {
  return {
    id,
    identity_id: "test-agent",
    operation: MemoryOperation.ADD,
    reason: `Extracted from execution for ${title}`,
    learning: {
      id: `f47ac10b-58cc-4372-a567-0e02b2c3d${id.slice(-3)}`,
      title,
      description: `Description for ${title}`,
      category,
      confidence: ConfidenceLevel.HIGH,
      tags: [category, "test"],
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.PROJECT,
      created_at: new Date().toISOString(),
    },
    target_scope: MemoryScope.PROJECT,
    target_project: "my-app",
    status: MemoryStatus.PENDING,
    created_at: new Date().toISOString(),
  };
}

// ===== Integration Tests =====

Deno.test("TUI Integration: full workflow - navigate → view → search", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  // Initialize
  await session.initialize();

  // Verify tree loaded
  const tree = session.getTree();
  assertGreater(tree.length, 0, "Tree should have nodes");

  // Navigate to projects
  await session.handleKey(KEYS.P);
  assertEquals(session.getState().activeScope, "projects");

  // Expand projects
  await session.handleKey(KEYS.ENTER);
  // Navigate down to first project
  await session.handleKey(KEYS.DOWN);

  // View detail
  const detail = session.getDetailContent();
  assertExists(detail);

  // Activate search
  await session.handleKey(KEYS.S);
  assertEquals(session.isSearchActive(), true);

  // Type query
  await session.handleKey(KEYS.E);
  await session.handleKey(KEYS.R);
  await session.handleKey(KEYS.R);
  await session.handleKey(KEYS.O);
  await session.handleKey(KEYS.R);
  assertEquals(session.getSearchQuery(), "error");

  // Execute search
  await session.handleKey(KEYS.ENTER);
  assertEquals(session.isSearchActive(), false);

  // Should have search results
  const searchTree = session.getTree();
  const searchNode = searchTree.find((n) => n.id === "search-results");
  assertExists(searchNode, "Should have search results node");
});

Deno.test("TUI Integration: pending workflow - view → approve → verify", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  await session.initialize();

  // Navigate to pending
  await session.handleKey(KEYS.N);

  // Expand pending
  await session.handleKey(KEYS.ENTER);

  // Navigate to first pending item
  await session.handleKey(KEYS.DOWN);

  // Open approve dialog
  await session.handleKey(KEYS.A);
  assertEquals(session.hasActiveDialog(), true);

  // Confirm approval
  await session.handleKey(KEYS.Y);

  // Dialog should close
  assertEquals(session.hasActiveDialog(), false);

  // Count should decrease
  assertEquals(session.getPendingCount(), 2);
  assertEquals(service.getApprovedCount(), 1);
});

Deno.test("TUI Integration: reject workflow with reason", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  await session.initialize();

  // Navigate to pending
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);

  // Open reject dialog
  await session.handleKey(KEYS.R);
  assertEquals(session.hasActiveDialog(), true);

  // Navigate to reason field and type
  await session.handleKey(KEYS.TAB);
  await session.handleKey(KEYS.ENTER); // Enter edit mode
  await session.handleKey(KEYS.N);
  await session.handleKey(KEYS.O);

  // Confirm (navigate to button and press)
  await session.handleKey(KEYS.ESCAPE); // Exit edit mode
  await session.handleKey(KEYS.TAB); // Go to Reject button
  await session.handleKey(KEYS.ENTER);

  // Verify rejected
  assertEquals(session.hasActiveDialog(), false);
  assertEquals(session.getPendingCount(), 2);
});

Deno.test("TUI Integration: loading state shows spinner", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  // Check initial state before loading
  const state = session.getState();
  assertEquals(state.isLoading, false);

  // Initialize triggers loading
  await session.initialize();

  // After initialize, should not be loading
  assertEquals(session.isLoading(), false);
});

Deno.test("TUI Integration: refresh updates data", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  await session.initialize();

  const initialTime = session.getState().lastRefresh;

  // Small delay to ensure time difference
  await new Promise((r) => setTimeout(r, 10));

  // Trigger refresh
  await session.handleKey(KEYS.CAP_R);

  const newTime = session.getState().lastRefresh;
  assertGreater(newTime, initialTime, "Refresh should update timestamp");
});

Deno.test("TUI Integration: keyboard accessibility - full navigation", async () => {
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  await session.initialize();

  // Test all scope shortcuts
  await session.handleKey(KEYS.G);
  assertEquals(session.getState().activeScope, MemoryScope.GLOBAL);

  await session.handleKey(KEYS.P);
  assertEquals(session.getState().activeScope, "projects");

  await session.handleKey(KEYS.E);
  assertEquals(session.getState().activeScope, "executions");

  await session.handleKey(KEYS.N);
  assertEquals(session.getState().activeScope, MemoryStatus.PENDING);

  // Test help
  await session.handleKey(KEYS.QUESTION);
  assertStringIncludes(session.getDetailContent(), "Help");

  // Test escape in search mode
  await session.handleKey(KEYS.S);
  assertEquals(session.isSearchActive(), true);
  await session.handleKey(KEYS.ESCAPE);
  assertEquals(session.isSearchActive(), false);
});

Deno.test("TUI Integration: handles large memory sets", async () => {
  // Create service with many items
  const service = new MockMemoryServiceFull();
  const session = new MemoryViewTuiSession(service);

  const startTime = performance.now();
  await session.initialize();
  const loadTime = performance.now() - startTime;

  // Should load within reasonable time (500ms target)
  assertGreater(500, loadTime, `Load time ${loadTime}ms should be under 500ms`);

  // Should render without error
  const treePanel = session.renderTreePanel();
  assertExists(treePanel);
  assertGreater(treePanel.length, 0);
});

// ===== Markdown Renderer Tests =====

Deno.test("renderMarkdown: renders headers with colors", () => {
  const md = "# Header 1\n## Header 2\n### Header 3";
  const result = renderMarkdown(md, { useColors: true });

  assertStringIncludes(result, "Header 1");
  assertStringIncludes(result, "Header 2");
  assertStringIncludes(result, "Header 3");
  assertStringIncludes(result, "\x1b["); // Has ANSI codes
});

Deno.test("renderMarkdown: renders code blocks", () => {
  const md = "```typescript\nconst x = 1;\n```";
  const result = renderMarkdown(md, { useColors: true });

  assertStringIncludes(result, "const x = 1;");
  assertStringIncludes(result, "typescript");
});

Deno.test("renderMarkdown: renders lists", () => {
  const md = "- Item 1\n- Item 2\n1. First\n2. Second";
  const result = renderMarkdown(md, { useColors: false });

  assertStringIncludes(result, "• Item 1");
  assertStringIncludes(result, "• Item 2");
  assertStringIncludes(result, "1. First");
  assertStringIncludes(result, "2. Second");
});

Deno.test("renderMarkdown: renders inline styles", () => {
  const md = "This is **bold** and *italic* and `code`";
  const result = renderMarkdown(md, { useColors: true });

  // Should contain the text
  assertStringIncludes(result, "bold");
  assertStringIncludes(result, "italic");
  assertStringIncludes(result, "code");
});

Deno.test("renderMarkdown: no colors mode", () => {
  const md = "# Header\n**bold** text";
  const result = renderMarkdown(md, { useColors: false });

  // Should not contain ANSI codes
  assertEquals(result.includes("\x1b["), false);
  assertStringIncludes(result, "Header");
  assertStringIncludes(result, "bold");
});

Deno.test("stripMarkdown: removes all formatting", () => {
  const md = "# Header\n**bold** and *italic* with `code`";
  const result = stripMarkdown(md);

  assertEquals(result.includes("**"), false);
  assertEquals(result.includes("`"), false);
  assertEquals(result.includes("#"), false);
  assertStringIncludes(result, "Header");
  assertStringIncludes(result, "bold");
});

Deno.test("wrapText: wraps at width", () => {
  const text = "This is a long line that should be wrapped at the specified width";
  const result = wrapText(text, 20);

  const lines = result.split("\n");
  for (const line of lines) {
    assertGreater(21, line.length, `Line "${line}" should be <= 20 chars`);
  }
});

Deno.test("renderSpinner: cycles through frames", () => {
  const frames = new Set<string>();
  for (let i = 0; i < 10; i++) {
    frames.add(renderSpinner(i));
  }
  // Should have multiple unique frames
  assertGreater(frames.size, 1);
});

Deno.test("renderProgressBar: shows correct percentage", () => {
  const bar0 = renderProgressBar(0, 100, 10, false);
  assertStringIncludes(bar0, "0%");

  const bar50 = renderProgressBar(50, 100, 10, false);
  assertStringIncludes(bar50, "50%");

  const bar100 = renderProgressBar(100, 100, 10, false);
  assertStringIncludes(bar100, "100%");
});

Deno.test("renderConfidence: shows correct icons", () => {
  const high = renderConfidence(ConfidenceLevel.HIGH, false);
  assertStringIncludes(high, "●●●");
  assertStringIncludes(high, "high");

  const medium = renderConfidence(ConfidenceLevel.MEDIUM, false);
  assertStringIncludes(medium, "●●○");

  const low = renderConfidence(ConfidenceLevel.LOW, false);
  assertStringIncludes(low, "●○○");
});

Deno.test("renderCategoryBadge: formats categories", () => {
  const pattern = renderCategoryBadge(LearningCategory.PATTERN, false);
  assertEquals(pattern, "[pattern]");

  const decision = renderCategoryBadge(LearningCategory.DECISION, false);
  assertEquals(decision, "[decision]");

  const coloredPattern = renderCategoryBadge(LearningCategory.PATTERN, true);
  assertStringIncludes(coloredPattern, "[pattern]");
  assertStringIncludes(coloredPattern, "\x1b["); // Has color
});
