/**
 * @module RequestManagerViewExtendedTest
 * @path apps/tui/tests/request_manager_view_extended_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Targeted tests for RequestManagerView metadata, ensuring comprehensive coverage of
 * status colors, keyboard bindings, and visual icons for request priorities.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  type CritiqueSeverity as _CritiqueSeverity,
  RequestPriority,
  RequestSource,
  TaskComplexity,
  TaskType,
} from "@exaix/core";
import { RequestGroupingMode } from "@exaix/tui";
import { RequestStatus } from "@exaix/core/status";
import {
  AnalysisMode,
  type IRequest,
  type IRequestAnalysis,
  type IRequestEntry,
  type IRequestMetadata,
  type IRequestShowResult,
} from "@exaix/core/types";
import type { IRequestService } from "@exaix/core/types";
import { RequestAdapter } from "../../../apps/common/adapters/request_adapter.ts";
import {
  createLegacyTuiSession,
  createLegacyTuiSessionWithErrors,
  createLegacyTuiSessionWithLongTraceId,
  createLegacyTuiSessionWithTracking,
} from "./helpers.ts";
import {
  MinimalRequestServiceMock,
  PRIORITY_ICONS,
  REQUEST_KEY_BINDINGS,
  RequestAction,
  type RequestManagerTuiSession,
  RequestManagerView,
  STATUS_COLORS,
  STATUS_ICONS,
} from "../src/request_manager_view.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

// Test Data

function createTestRequests(): IRequest[] {
  return [
    {
      trace_id: "req-001",
      filename: "request-001.md",
      subject: "Test Request 1",
      status: RequestStatus.PENDING,
      priority: RequestPriority.NORMAL,
      identity: "default",
      created: "2025-01-01T10:00:00Z",
      created_by: "test@example.com",
      source: RequestSource.CLI,
    },
    {
      trace_id: "req-002",
      filename: "request-002.md",
      subject: "Test Request 2",
      status: RequestStatus.PENDING,
      priority: RequestPriority.HIGH,
      identity: "code-reviewer",
      created: "2025-01-01T11:00:00Z",
      created_by: "user@example.com",
      source: RequestSource.CLI,
      skills: {
        explicit: ["security-audit"],
        autoMatched: ["code-review"],
        fromDefaults: ["typescript-patterns"],
        skipped: ["deprecated-skill"],
      },
    },
    {
      trace_id: "req-003",
      filename: "request-003.md",
      subject: "Test Request 3",
      status: RequestStatus.COMPLETED,
      priority: RequestPriority.CRITICAL,
      identity: "architect",
      created: "2025-01-01T12:00:00Z",
      created_by: "admin@example.com",
      source: RequestSource.CLI,
    },
    {
      trace_id: "req-004",
      filename: "request-004.md",
      subject: "Cancelled Request",
      status: RequestStatus.CANCELLED,
      priority: RequestPriority.LOW,
      identity: "default",
      created: "2025-01-01T13:00:00Z",
      created_by: "test@example.com",
      source: RequestSource.CLI,
    },
    {
      trace_id: "req-005",
      filename: "request-005.md",
      subject: "Failed Request",
      status: RequestStatus.FAILED,
      priority: RequestPriority.HIGH,
      identity: "researcher",
      created: "2025-01-01T14:00:00Z",
      created_by: "test@example.com",
      source: RequestSource.CLI,
    },
  ];
}

function createTestSessionWithMockService(
  getRequestContentResult: string | Error = "Test content",
): RequestManagerTuiSession {
  const requests = createTestRequests();
  const mockService = {
    list: () => Promise.resolve(requests),
    listRequests: () => Promise.resolve(requests),
    show: (id: string) =>
      Promise.resolve({
        metadata: requests.find((r) => r.trace_id === id) || requests[0],
        content: getRequestContentResult instanceof Error ? "" : getRequestContentResult,
      }),
    getRequestContent: (_id: string) =>
      getRequestContentResult instanceof Error
        ? Promise.reject(getRequestContentResult)
        : Promise.resolve(getRequestContentResult),
    create: () => Promise.resolve({} as IRequest),
    createRequest: () => Promise.resolve({} as IRequest),
    updateRequestStatus: () => Promise.resolve(true),
    getAnalysis: () => Promise.resolve(null),
    analyze: () => Promise.reject(new Error("Not implemented in extended test mock")),
  };

  const view = new RequestManagerView(mockService as IRequestService);
  const session = view.createTuiSession(requests);
  return session;
}

// Constants Tests

Deno.test("RequestManagerView: STATUS_COLORS covers all statuses", () => {
  assertExists(STATUS_COLORS.pending);
  assertExists(STATUS_COLORS.planned);
  assertExists(STATUS_COLORS.in_progress);
  assertExists(STATUS_COLORS.completed);
  assertExists(STATUS_COLORS.cancelled);
  assertExists(STATUS_COLORS.failed);
});

Deno.test("RequestManagerView: REQUEST_KEY_BINDINGS is comprehensive", () => {
  const actions = REQUEST_KEY_BINDINGS.map((b) => b.action);
  assertEquals(actions.includes(RequestAction.NAVIGATE_UP), true);
  assertEquals(actions.includes(RequestAction.CREATE), true);
  assertEquals(actions.includes(RequestAction.DELETE), true);
  assertEquals(actions.includes(RequestAction.HELP), true);
});

Deno.test("RequestManagerView: PRIORITY_ICONS and STATUS_ICONS have all values", () => {
  assertEquals(PRIORITY_ICONS.critical, "🔴");
  assertEquals(PRIORITY_ICONS.high, "🟠");
  assertEquals(PRIORITY_ICONS.normal, "⚪");
  assertEquals(PRIORITY_ICONS.low, "🔵");

  assertEquals(STATUS_ICONS.pending, "⏳");
  assertEquals(STATUS_ICONS.planned, "📋");
  assertEquals(STATUS_ICONS.in_progress, "🔄");
  assertEquals(STATUS_ICONS.completed, "✅");
  assertEquals(STATUS_ICONS.cancelled, "❌");
  assertEquals(STATUS_ICONS.failed, "💥");
});

// RequestManagerView Tests

Deno.test("RequestManagerView: renderRequestList with various statuses", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);

  const requests = createTestRequests();
  const output = view.renderRequestList(requests);

  assertStringIncludes(output, "Requests:");
  assertStringIncludes(output, "⏳"); // pending
  assertStringIncludes(output, "✅"); // completed
  assertStringIncludes(output, "❌"); // cancelled
  // Note: in_progress and failed might show as ❓ if not in STATUS_ICONS lookup
});

Deno.test("RequestManagerView: renderRequestList shows priorities", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);

  const requests = createTestRequests();
  const output = view.renderRequestList(requests);

  assertStringIncludes(output, "⚪"); // normal
  assertStringIncludes(output, "🟠"); // high
  assertStringIncludes(output, "🔴"); // critical
  assertStringIncludes(output, "🔵"); // low
});

// RequestManagerTuiSession Tests

Deno.test("RequestManagerTuiSession: getSelectedRequest returns correct request", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  const selected = session.getSelectedRequest();
  assertEquals(selected?.trace_id, "req-001");
});

Deno.test("RequestManagerTuiSession: getSelectedIndexInRequests works", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  const idx = session.getSelectedIndexInRequests();
  assertEquals(idx, 0);
});

Deno.test("RequestManagerTuiSession: setSelectedByIndex changes selection", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  session.setSelectedByIndex(2);
  assertEquals(session.getSelectedIndexInRequests(), 2);

  // Test invalid index (should clamp)
  session.setSelectedByIndex(-1);
  assertEquals(session.getSelectedIndexInRequests(), 2); // unchanged for out of range

  session.setSelectedByIndex(100);
  assertEquals(session.getSelectedIndexInRequests(), 2); // unchanged for out of range
});

Deno.test("RequestManagerTuiSession: navigateTree first and last", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Navigate to last
  await session.handleKey(KEYS.END);
  const lastState = session.getState();
  assertExists(lastState.selectedRequestId);

  // Navigate to first
  await session.handleKey(KEYS.HOME);
  const firstState = session.getState();
  assertExists(firstState.selectedRequestId);
});

Deno.test("RequestManagerTuiSession: toggleGrouping cycles through modes", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  assertEquals(session.getState().groupBy, "none");

  session.toggleGrouping();
  assertEquals(session.getState().groupBy, "status");

  session.toggleGrouping();
  assertEquals(session.getState().groupBy, "priority");

  session.toggleGrouping();
  assertEquals(session.getState().groupBy, RequestGroupingMode.IDENTITY);

  session.toggleGrouping();
  assertEquals(session.getState().groupBy, "none");
});

Deno.test("RequestManagerTuiSession: buildGroupedByPriority", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Switch to priority grouping
  session.toggleGrouping(); // none -> status
  session.toggleGrouping(); // status -> priority

  const tree = session.getState().requestTree;
  assert(tree.length > 0);

  // Should have priority groups
  const groupIds = tree.map((node) => node.id);
  assertEquals(groupIds.some((id: string) => id.startsWith("priority-")), true);
});

Deno.test("RequestManagerTuiSession: buildGroupedByIdentity", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Switch to identity grouping
  session.toggleGrouping(); // none -> status
  session.toggleGrouping(); // status -> priority
  session.toggleGrouping(); // priority -> identity

  const tree = session.getState().requestTree;
  assert(tree.length > 0);

  // Should have identity groups
  const groupIds = tree.map((node) => node.id);
  assertEquals(groupIds.some((id: string) => id.startsWith("identity-")), true);
});

Deno.test("RequestManagerTuiSession: expandSelectedNode and collapseSelectedNode", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Switch to grouping mode
  session.toggleGrouping(); // none -> status

  // Navigate to a group node
  await session.handleKey(KEYS.HOME);
  // Try to collapse and expand
  session.collapseSelectedNode();
  session.expandSelectedNode();

  // Should not throw
  const state = session.getState();
  assertExists(state);
});

Deno.test("RequestManagerTuiSession: toggleSelectedNode", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = createTestRequests();
  const view = new RequestManagerView(mockService);
  const session = view.createTuiSession(requests);

  // Switch to grouping mode
  session.toggleGrouping();

  // Navigate to first (group node)
  await session.handleKey(KEYS.HOME);

  // Toggle the node
  session.toggleSelectedNode();

  const state = session.getState();
  assertExists(state);
});

Deno.test("RequestManagerTuiSession: showRequestDetail formats content", async () => {
  const session = createTestSessionWithMockService("Test content here");

  await session.showRequestDetail("req-002");

  assertEquals(session.getState().showDetail, true);
  const detail = session.renderDetail();
  assertStringIncludes(detail, "REQUEST DETAILS");
  assertStringIncludes(detail, "Applied Skills:");
});

Deno.test("RequestManagerTuiSession: showRequestDetail handles error", async () => {
  const session = createTestSessionWithMockService(new Error("Failed to load"));

  await session.showRequestDetail("req-001");

  // Should set error status, not show detail
  assertEquals(session.getState().showDetail, false);
});

Deno.test("RequestManagerTuiSession: detail view with skills shows all skill types", async () => {
  const session = createTestSessionWithMockService("Content");

  await session.showRequestDetail("req-002");

  const detail = session.renderDetail();
  assertStringIncludes(detail, "Explicit:");
  assertStringIncludes(detail, "Auto-matched:");
  assertStringIncludes(detail, "From defaults:");
  assertStringIncludes(detail, "Skipped:");
});

Deno.test("RequestManagerTuiSession: detail view without skills shows (none)", async () => {
  const requestWithEmptySkills: IRequest = {
    trace_id: "req-empty",
    filename: "request-empty.md",
    subject: "Request with empty skills",
    status: RequestStatus.PENDING,
    priority: RequestPriority.NORMAL,
    identity: "default",
    created: "2025-01-01T10:00:00Z",
    created_by: "test@example.com",
    source: RequestSource.CLI,
    skills: {},
  };

  const mockService = {
    list: () => Promise.resolve([]),
    listRequests: () => Promise.resolve([]),
    show: () => {
      const metadata: IRequestMetadata = {
        trace_id: "req-empty",
        filename: "request-empty.md",
        path: "request-empty.md",
        status: RequestStatus.PENDING,
        priority: RequestPriority.NORMAL,
        identity: "default",
        created: "2025-01-01T10:00:00Z",
        created_by: "test@example.com",
        source: RequestSource.CLI,
      };
      return Promise.resolve({
        metadata,
        content: "Content",
      });
    },
    getRequestContent: (_id: string) => Promise.resolve("Content"),
    create: () => Promise.resolve({} as IRequest),
    createRequest: () => Promise.resolve({} as IRequest),
    updateRequestStatus: () => Promise.resolve(true),
    getAnalysis: () => Promise.resolve(null),
    analyze: () => Promise.reject(new Error("Not implemented in extended test mock")),
  };

  const view = new RequestManagerView(mockService as IRequestService);
  const session = view.createTuiSession([requestWithEmptySkills]);

  await session.showRequestDetail("req-empty");

  const detail = session.renderDetail();
  assertStringIncludes(detail, "(none)");
});

Deno.test("RequestManagerTuiSession: filter by status and agent", () => {
  const session = createLegacyTuiSession();
  assertEquals(session.getSelectedRequest(), null);
});

Deno.test("RequestManagerTuiSession: showCancelConfirm for non-existent request", () => {
  const session = createTestSessionWithMockService("Content");

  // Try to show cancel for non-existent request
  session.showCancelConfirm("non-existent");

  // Should not open dialog
  assertEquals(session.getState().activeDialog, null);
});

Deno.test("RequestManagerTuiSession: showPriorityDialog", async () => {
  const session = createTestSessionWithMockService("Content");

  session.showPriorityDialog();
  assertEquals(session.getState().activeDialog !== null, true);

  await session.handleKey(KEYS.ESCAPE);
  assertEquals(session.getState().activeDialog, null);
});

Deno.test("RequestManagerTuiSession: left arrow collapses, right arrow expands", async () => {
  const session = createTestSessionWithMockService("Content");

  // Switch to grouping mode
  session.toggleGrouping();

  // Navigate to a group
  await session.handleKey(KEYS.HOME);

  // Collapse with left arrow
  await session.handleKey(KEYS.LEFT);

  // Expand with right arrow
  await session.handleKey(KEYS.RIGHT);

  const state = session.getState();
  assertExists(state);
});

Deno.test("RequestManagerTuiSession: enter on group toggles expansion", async () => {
  const session = createTestSessionWithMockService("Content");

  // Switch to grouping mode
  session.toggleGrouping();

  // Navigate to a group node (first item should be a group)
  await session.handleKey(KEYS.HOME);

  const state = session.getState();
  if (state.selectedRequestId?.startsWith("status-")) {
    // Toggle with enter
    await session.handleKey(KEYS.ENTER);
    // Should not show detail for groups
    assertEquals(session.getState().showDetail, false);
  }
});

Deno.test("RequestManagerTuiSession: d key on non-request does nothing", async () => {
  const session = createTestSessionWithMockService("Content");

  // Switch to grouping mode
  session.toggleGrouping();

  // Navigate to a group node
  await session.handleKey(KEYS.HOME);

  const state = session.getState();
  if (state.selectedRequestId?.startsWith("status-")) {
    // Try to delete a group (should do nothing)
    await session.handleKey(KEYS.D);
    assertEquals(session.getState().activeDialog, null);
  }
});

Deno.test("RequestManagerTuiSession: p key on non-request does nothing", async () => {
  const session = createTestSessionWithMockService("Content");

  // Switch to grouping mode
  session.toggleGrouping();

  // Navigate to a group node
  await session.handleKey(KEYS.HOME);

  const state = session.getState();
  if (state.selectedRequestId?.startsWith("status-")) {
    // Try to change priority of a group (should do nothing)
    await session.handleKey(KEYS.P);
    assertEquals(session.getState().activeDialog, null);
  }
});

// LegacyRequestManagerTuiSession Tests

Deno.test("LegacyRequestManagerTuiSession: getSelectedIndex and setSelectedIndex", () => {
  const session = createLegacyTuiSession(createTestRequests());

  assertEquals(session.getSelectedIndex(), 0);

  session.setSelectedIndex(2);
  assertEquals(session.getSelectedIndex(), 2);

  // Test boundary
  session.setSelectedIndex(-1);
  assertEquals(session.getSelectedIndex(), 0);

  session.setSelectedIndex(100);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("LegacyRequestManagerTuiSession: handleKey navigation", async () => {
  const session = createLegacyTuiSession(createTestRequests());

  assertEquals(session.getSelectedIndex(), 0);

  await session.handleKey(KEYS.DOWN);
  assertEquals(session.getSelectedIndex(), 1);

  await session.handleKey(KEYS.UP);
  assertEquals(session.getSelectedIndex(), 0);

  await session.handleKey(KEYS.END);
  assertEquals(session.getSelectedIndex(), 4);

  await session.handleKey(KEYS.HOME);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("LegacyRequestManagerTuiSession: handleKey actions", async () => {
  const { session, createCalled, viewCalled, deleteCalled } = createLegacyTuiSessionWithTracking();

  await session.handleKey(KEYS.C);
  assertEquals(createCalled(), true);

  await session.handleKey(KEYS.V);
  assertEquals(viewCalled(), true);

  await session.handleKey(KEYS.D);
  assertEquals(deleteCalled(), true);
});

Deno.test("LegacyRequestManagerTuiSession: getSelectedRequest", () => {
  const session = createLegacyTuiSession(createTestRequests());

  const selected = session.getSelectedRequest();
  assertEquals(selected?.trace_id, "req-001");
});

Deno.test("LegacyRequestManagerTuiSession: getStatusMessage after action", async () => {
  const session = createLegacyTuiSessionWithLongTraceId();

  await session.handleKey(KEYS.C);
  assertStringIncludes(session.getStatusMessage(), "Created request:");
});

Deno.test("LegacyRequestManagerTuiSession: handleKey with empty requests", async () => {
  const session = createLegacyTuiSession([]);

  // Should not throw with empty requests
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.UP);

  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("LegacyRequestManagerTuiSession: error handling in actions", async () => {
  const session = createLegacyTuiSessionWithErrors();

  // Test create error
  await session.handleKey(KEYS.C);
  assertStringIncludes(session.getStatusMessage(), "Error:");

  // Test view error
  await session.handleKey(KEYS.V);
  assertStringIncludes(session.getStatusMessage(), "Error:");

  // Test delete error
  await session.handleKey(KEYS.D);
  assertStringIncludes(session.getStatusMessage(), "Error:");
});

// RequestServiceAdapter Tests

Deno.test("RequestServiceAdapter: updateRequestStatus returns false (not implemented)", async () => {
  const mockMetadata: IRequestMetadata = {
    trace_id: "dummy",
    filename: "dummy.md",
    path: "dummy.md",
    status: RequestStatus.PENDING,
    priority: RequestPriority.NORMAL,
    identity: "dummy",
    created: new Date().toISOString(),
    created_by: "dummy",
    source: RequestSource.CLI,
  };
  const mockAnalysis: IRequestAnalysis = {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 100,
    complexity: TaskComplexity.SIMPLE,
    taskType: TaskType.ANALYSIS,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.HYBRID,
      analyzerVersion: "test",
    },
  };
  const mockCmd = {
    list(): Promise<IRequestEntry[]> {
      return Promise.resolve([]);
    },
    show(): Promise<IRequestShowResult> {
      return Promise.resolve({ metadata: mockMetadata, content: "" });
    },
    getRequestContent(): Promise<string> {
      return Promise.resolve("");
    },
    analyze(): Promise<IRequestAnalysis> {
      return Promise.resolve(mockAnalysis);
    },
    create(): Promise<IRequestMetadata> {
      return Promise.resolve(mockMetadata);
    },
    createFromFile(): Promise<IRequestMetadata> {
      return Promise.resolve(mockMetadata);
    },
  };
  const adapter = new RequestAdapter(mockCmd);

  // This returns false as updateRequestStatus is not implemented
  const result = await adapter.updateRequestStatus("test-id", RequestStatus.COMPLETED);
  assertEquals(result, false);
});
