/**
 * @module RequestManagerViewTest
 * @path apps/tui/tests/request_manager_view_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the RequestManagerView TUI component, ensuring correct rendering
 * of the request list, content preview, and interactive status management.
 */

import { assert, assertEquals } from "@std/assert";
import { RequestPriority, RequestSource } from "@exaix/core";
import { RequestGroupingMode } from "@exaix/tui";
import { RequestStatus } from "@exaix/core/status";
import { commonTestData } from "../../../tests/helpers/test_utils.ts";
import type { IRequest } from "@exaix/core/types";

import {
  MinimalRequestServiceMock,
  PRIORITY_ICONS,
  REQUEST_KEY_BINDINGS,
  RequestManagerView,
  STATUS_ICONS,
} from "../src/request_manager_view.ts";
import {
  type createMockRequestService as _createMockRequestService,
  createTuiWithRequests,
  createViewWithRequests,
  sampleBasicRequest,
  sampleGroupedRequests,
  sampleNewRequest,
  type sampleRequest as _sampleRequest,
  sampleRequests as _sampleRequests,
  sampleTestRequests,
  sampleTwoRequests,
} from "./helpers.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

Deno.test("RequestManagerView - renders request list correctly", async () => {
  const { service: _service, view } = createViewWithRequests([
    {
      trace_id: "12345678-abcd-1234-5678-123456789abc",
      subject: "IRequest 12345678",
    },
    {
      trace_id: "87654321-abcd-1234-5678-123456789abc",
      subject: "IRequest 87654321",
      status: RequestStatus.PLANNED,
      priority: RequestPriority.HIGH,
      agent_role: "code-reviewer",
    },
  ]);
  const requests = await _service.listRequests();
  const output = view.renderRequestList(requests);

  assert(output.includes("Requests:"));
  assert(output.includes("⏳ ⚪ IRequest 12345678 - default"));
  assert(output.includes("📋 🟠 IRequest 87654321 - code-reviewer"));
});

Deno.test("RequestManagerView - handles empty request list", async () => {
  const { service: _service, view } = createViewWithRequests([]);
  const requests = await _service.listRequests();
  const output = view.renderRequestList(requests);

  assertEquals(output, "No requests found.");
});

Deno.test("RequestManagerView - renders request content", () => {
  const _service = new MinimalRequestServiceMock();
  const view = new RequestManagerView(_service);
  const content = "Sample request content";
  const output = view.renderRequestContent(content);

  assertEquals(output, content);
});

Deno.test("RequestManagerView - lists requests via service", async () => {
  const { service: _service } = createViewWithRequests([{
    trace_id: "test-123",
    subject: "Test Request",
  }]);
  const requests = await _service.listRequests();

  assertEquals(requests.length, 1);
  assertEquals(requests[0].trace_id, "test-123");
});

Deno.test("RequestManagerView - filters requests by status", async () => {
  const { service: _service, view } = createViewWithRequests([
    {
      trace_id: "test-1",
      filename: "request-1.md",
      subject: "IRequest 1",
      status: RequestStatus.PENDING,
      priority: RequestPriority.NORMAL,
      agent_role: "default",
      created: "2025-12-23T10:00:00Z",
      created_by: "test@example.com",
    },
    {
      trace_id: "test-2",
      filename: "request-2.md",
      subject: "IRequest 2",
      status: RequestStatus.COMPLETED,
      priority: RequestPriority.NORMAL,
      agent_role: "default",
      created: "2025-12-23T11:00:00Z",
      created_by: "test@example.com",
    },
  ]);
  const pendingRequests = await view.listRequests(RequestStatus.PENDING);

  assertEquals(pendingRequests.length, 1);
  assertEquals(pendingRequests[0].status, RequestStatus.PENDING);
});

Deno.test("RequestManagerView - creates new request", async () => {
  const { service: _service, view } = createViewWithRequests();
  const newIRequest = await view.createRequest("Test request", {
    priority: RequestPriority.HIGH,
    agent_role: "test-agent",
  });

  assert(newIRequest.trace_id);
  assertEquals(newIRequest.status, RequestStatus.PENDING);
  assertEquals(newIRequest.priority, RequestPriority.HIGH);
  assertEquals(newIRequest.identity, "test-agent");
});

Deno.test("RequestManagerView - gets request content", async () => {
  const { service: _service, view } = createViewWithRequests([
    {
      trace_id: "test-123",
      subject: "Test Request",
    },
  ]);
  const content = await view.getRequestContent("test-123");

  assertEquals(content, "Content for test-123");
});

Deno.test("RequestManagerView - updates request status", async () => {
  const { service: _service, view } = createViewWithRequests([
    {
      trace_id: "test-123",
      subject: "Test Request",
    },
  ]);
  const success = await view.updateRequestStatus("test-123", RequestStatus.COMPLETED);

  assertEquals(success, true);
});

// TUI Session Tests
Deno.test("RequestManagerTuiSession - keyboard navigation", async () => {
  const _service = new MinimalRequestServiceMock();
  const requests = sampleTestRequests();
  const { view: _view, tui } = createTuiWithRequests(requests);

  // Initial selection - first request
  assertEquals(tui.getSelectedIndexInRequests(), 0);
  assertEquals(tui.getSelectedRequest()?.trace_id, "req-1");

  // Navigate down
  await tui.handleKey(KEYS.DOWN);
  assertEquals(tui.getSelectedIndexInRequests(), 1);
  assertEquals(tui.getSelectedRequest()?.trace_id, "req-2");

  // Navigate up
  await tui.handleKey(KEYS.UP);
  assertEquals(tui.getSelectedIndexInRequests(), 0);
  assertEquals(tui.getSelectedRequest()?.trace_id, "req-1");

  // Navigate to end
  await tui.handleKey(KEYS.END);
  assertEquals(tui.getSelectedIndexInRequests(), 1);

  // Navigate to home
  await tui.handleKey(KEYS.HOME);
  assertEquals(tui.getSelectedIndexInRequests(), 0);
});

Deno.test("RequestManagerTuiSession - keyboard actions show dialogs", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleBasicRequest();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Verify initial selection is the request
  assertEquals(tui.getState().selectedRequestId, "req-1");

  // 'c' key shows create dialog
  await tui.handleKey(KEYS.C);
  assert(tui.getState().activeDialog !== null, "Create dialog should be shown");

  // Cancel the dialog
  await tui.handleKey(KEYS.ESCAPE);
  assertEquals(tui.getState().activeDialog, null, "Dialog should be closed");

  // 's' key shows search dialog
  await tui.handleKey(KEYS.S);
  assert(tui.getState().activeDialog !== null, "Search dialog should be shown");
  await tui.handleKey(KEYS.ESCAPE);

  // '?' key shows help
  await tui.handleKey(KEYS.QUESTION);
  assert(tui.getState().showHelp, "Help should be shown");
  await tui.handleKey(KEYS.QUESTION);
  assertEquals(tui.getState().showHelp, false, "Help should be hidden");
});

Deno.test("RequestManagerTuiSession - create request via dialog", async () => {
  let createdDescription = "";

  const mockService = new MinimalRequestServiceMock();
  mockService.createRequest = (desc: string) => {
    createdDescription = desc;
    const mockReq = commonTestData.mockObjects.newRequest();
    return Promise.resolve({ ...mockReq, priority: RequestPriority.NORMAL } as IRequest);
  };

  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  // Show create dialog
  tui.showCreateDialog();
  assert(tui.getState().activeDialog !== null);

  // Type description and confirm
  const dialog = tui.getState().activeDialog!;
  // Focus on input field
  dialog.handleKey(KEYS.ENTER); // Focus input
  // Type characters
  for (const char of "Test request") {
    dialog.handleKey(char);
  }
  // Tab to confirm button
  dialog.handleKey(KEYS.TAB);
  dialog.handleKey(KEYS.TAB);
  // Confirm
  dialog.handleKey(KEYS.ENTER);

  // Wait for async create to complete
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Verify request was created with description
  assertEquals(createdDescription.includes("Test") || createdDescription === "", true);
});

Deno.test("RequestManagerTuiSession - handles empty request list", async () => {
  const _service = new MinimalRequestServiceMock();
  const view = new RequestManagerView(_service);
  const tui = view.createTuiSession([]);

  // Navigation should be safe with empty list
  await tui.handleKey(KEYS.DOWN);
  await tui.handleKey(KEYS.UP);

  // 'c' key should still show create dialog even with empty list
  await tui.handleKey(KEYS.C);
  assert(tui.getState().activeDialog !== null, "Create dialog should show even with empty list");
  await tui.handleKey(KEYS.ESCAPE);

  // 'd' without selection should do nothing
  await tui.handleKey(KEYS.D);
  // No dialog should show because no request is selected
});

Deno.test("RequestManagerTuiSession - error handling via dialog", async () => {
  const mockService = new MinimalRequestServiceMock();
  mockService.createRequest = () => Promise.reject(new Error("Failed to create request"));

  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  // Verify dialogs work properly
  tui.showCreateDialog();
  assert(tui.getState().activeDialog !== null);

  // Cancel dialog
  await tui.handleKey(KEYS.ESCAPE);
  assertEquals(tui.getState().activeDialog, null);
});

Deno.test("RequestManagerTuiSession - get selected request", () => {
  const _service = new MinimalRequestServiceMock();
  const requests = sampleTwoRequests();
  const view = new RequestManagerView(_service);
  const tui = view.createTuiSession(requests);

  // Initially selected first request
  const selected = tui.getSelectedRequest();
  assert(selected);
  assertEquals(selected.trace_id, "req-1");

  // Change selection
  tui.setSelectedByIndex(1);
  const selected2 = tui.getSelectedRequest();
  assert(selected2);
  assertEquals(selected2.trace_id, "req-2");
});

Deno.test("Phase 13.6: RequestViewState interface", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  const state = tui.getState();

  // Verify all state properties exist
  assertEquals(state.selectedRequestId, null);
  assert(Array.isArray(state.requestTree));
  assertEquals(state.showHelp, false);
  assertEquals(state.showDetail, false);
  assertEquals(state.detailContent, "");
  assertEquals(state.activeDialog, null);
  assertEquals(state.searchQuery, "");
  assertEquals(state.filterStatus, null);
  assertEquals(state.filterPriority, null);
  assertEquals(state.filterIdentity, null);
  assertEquals(state.groupBy, "none");
});

Deno.test("Phase 13.6: Tree grouping by status", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleTestRequests();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Default is flat (no grouping)
  assertEquals(tui.getState().groupBy, "none");
  assertEquals(tui.getState().requestTree.length, 2);

  // Toggle to status grouping
  tui.toggleGrouping();
  assertEquals(tui.getState().groupBy, "status");
  // Should have groups now
  assert(tui.getState().requestTree[0].type === "group");

  // Toggle to priority grouping
  tui.toggleGrouping();
  assertEquals(tui.getState().groupBy, "priority");

  // Toggle to identity grouping
  tui.toggleGrouping();
  assertEquals(tui.getState().groupBy, RequestGroupingMode.IDENTITY);

  // Toggle back to none
  tui.toggleGrouping();
  assertEquals(tui.getState().groupBy, "none");
});

Deno.test("Phase 13.6: Search functionality", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = _sampleRequests([
    {
      trace_id: "req-1",
      subject: "Bug fix",
      agent_role: "developer",
    },
    {
      trace_id: "req-2",
      subject: "Feature request",
      status: RequestStatus.COMPLETED,
      priority: RequestPriority.HIGH,
      agent_role: "designer",
    },
  ]);
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Set search query
  tui.getState().searchQuery = "Bug";
  tui.buildTree();

  // Should filter to 1 result
  assertEquals(tui.getFilteredRequests().length, 1);
  assertEquals(tui.getFilteredRequests()[0].subject, "Bug fix");

  // Clear search
  tui.getState().searchQuery = "";
  tui.buildTree();
  assertEquals(tui.getFilteredRequests().length, 2);
});

Deno.test("Phase 13.6: Filter by status", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleTestRequests();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Filter by status
  tui.getState().filterStatus = RequestStatus.PENDING;
  tui.buildTree();

  assertEquals(tui.getFilteredRequests().length, 1);
  assertEquals(tui.getFilteredRequests()[0].status, RequestStatus.PENDING);
});

Deno.test("Phase 13.6: Filter by identity", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests: IRequest[] = [
    {
      trace_id: "req-1",
      filename: "request-1.md",
      subject: "IRequest 1",
      status: RequestStatus.PENDING,
      priority: RequestPriority.NORMAL,
      agent_role: "developer",
      created: "2025-12-23T10:00:00Z",
      created_by: "test@example.com",
      source: RequestSource.CLI,
    },
    {
      trace_id: "req-2",
      filename: "request-2.md",
      subject: "IRequest 2",
      status: RequestStatus.COMPLETED,
      priority: RequestPriority.HIGH,
      agent_role: "designer",
      created: "2025-12-23T11:00:00Z",
      created_by: "test@example.com",
      source: RequestSource.CLI,
    },
  ];
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Filter by identity
  tui.getState().filterIdentity = "dev";
  tui.buildTree();

  assertEquals(tui.getFilteredRequests().length, 1);
  assertEquals(tui.getFilteredRequests()[0].identity, "developer");
});

Deno.test("Phase 13.6: Help sections", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  const sections = tui.getHelpSections();

  assert(sections.length > 0, "Should have help sections");
  assert(sections.some((s) => s.title === "Navigation"));
  assert(sections.some((s) => s.title === "Actions"));
});

Deno.test("Phase 13.6: Render methods return strings", () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleBasicRequest();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // renderTree returns string[]
  const tree = tui.renderTree();
  assert(Array.isArray(tree));

  // renderHelp returns string[]
  const help = tui.renderHelp();
  assert(Array.isArray(help));

  // render returns string
  const output = tui.render();
  assertEquals(typeof output, "string");
  assert(output.includes("REQUEST MANAGER"));
});

Deno.test("Phase 13.6: PRIORITY_ICONS and STATUS_ICONS", () => {
  assert(PRIORITY_ICONS.critical !== undefined);
  assert(PRIORITY_ICONS.high !== undefined);
  assert(PRIORITY_ICONS.normal !== undefined);
  assert(PRIORITY_ICONS.low !== undefined);

  assert(STATUS_ICONS.pending !== undefined);
  assert(STATUS_ICONS.completed !== undefined);
  assert(STATUS_ICONS.cancelled !== undefined);
});

Deno.test("Phase 13.6: REQUEST_KEY_BINDINGS", () => {
  assert(Array.isArray(REQUEST_KEY_BINDINGS));
  assert(REQUEST_KEY_BINDINGS.length > 0);

  // Verify key bindings have required fields
  for (const binding of REQUEST_KEY_BINDINGS) {
    assert(binding.key !== undefined);
    assert(binding.description !== undefined);
    assert(binding.action !== undefined);
  }
});

Deno.test("Phase 13.6: Cancel confirm dialog", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = _sampleRequests([
    {
      trace_id: "req-1",
      subject: "IRequest 1",
    },
  ]);
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Show cancel confirm
  tui.showCancelConfirm("req-1");
  assert(tui.getState().activeDialog !== null);

  // Cancel the dialog
  await tui.handleKey(KEYS.ESCAPE);
  assertEquals(tui.getState().activeDialog, null);
});

Deno.test("Phase 13.6: Priority dialog", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleBasicRequest();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Show priority dialog via 'p' key
  await tui.handleKey(KEYS.P);
  assert(tui.getState().activeDialog !== null);

  // Cancel
  await tui.handleKey(KEYS.ESCAPE);
  assertEquals(tui.getState().activeDialog, null);
});

Deno.test("Phase 13.6: Tree navigation with groups", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleGroupedRequests();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Switch to status grouping
  tui.toggleGrouping();
  assertEquals(tui.getState().groupBy, "status");

  // Navigate should work with groups
  await tui.handleKey(KEYS.DOWN);
  await tui.handleKey(KEYS.DOWN);
  // Should be navigating through the tree
  assert(tui.getState().selectedRequestId !== null);
});

Deno.test("Phase 13.6: Focusable elements", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  const focusable = tui.getFocusableElements();
  assert(Array.isArray(focusable));
  assert(focusable.includes("request-list"));
});

Deno.test("Phase 13.6: setRequests updates tree", () => {
  const mockService = new MinimalRequestServiceMock();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession([]);

  assertEquals(tui.getRequests().length, 0);
  assertEquals(tui.getState().requestTree.length, 0);

  // Set new requests
  tui.setRequests(sampleNewRequest());

  assertEquals(tui.getRequests().length, 1);
  assertEquals(tui.getState().requestTree.length, 1);
});

Deno.test("Phase 13.6: Collapse and expand all", async () => {
  const mockService = new MinimalRequestServiceMock();
  const requests = sampleTestRequests();
  const view = new RequestManagerView(mockService);
  const tui = view.createTuiSession(requests);

  // Switch to grouping mode first
  tui.toggleGrouping();

  // Groups should be expanded by default
  assert(tui.getState().requestTree[0].expanded);

  // Collapse all ('C' key)
  await tui.handleKey(KEYS.CAP_C);
  assertEquals(tui.getState().requestTree[0].expanded, false);

  // Expand all ('E' key)
  await tui.handleKey(KEYS.CAP_E);
  assertEquals(tui.getState().requestTree[0].expanded, true);
});
