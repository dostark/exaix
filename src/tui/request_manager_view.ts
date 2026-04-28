/**
 * @module RequestManagerView
 * @path src/tui/request_manager_view.ts
 * @description TUI view for managing user requests, featuring tree-based navigation, status/priority grouping, and request creation.
 * @architectural-layer TUI
 * * @related-files [src/services/request_service.ts, src/tui/tui_dashboard.ts]
 */

import { KEYS } from "./helpers/keyboard.ts";
import { KeyBindingCategory } from "./helpers/keyboard.ts";
// --- Imports for Phase 13.6 ---
import { TuiSessionBase } from "./tui_common.ts";
import type { AnalysisMode } from "../shared/types/request.ts";
import { isRequestStatus, RequestStatus, type RequestStatusType } from "@exaix/core/status/request_status.ts";
import { createGroupNode, createNode, findNode, flattenTree, type ITreeNode, renderTree } from "./helpers/tree_view.ts";
import { type IHelpSection, renderHelpScreen } from "./helpers/help_renderer.ts";
import type { IKeyBinding } from "./helpers/keyboard.ts";
import { KeyBindingsBase } from "./base/key_bindings_base.ts";

// --- Extracted utilities ---
import {
  isGroupNode as helperIsGroupNode,
  MainKeyHandler,
  NavigationHandler,
  TreeManipulationHandler,
} from "./request_manager/key_handlers.ts";
import { RequestFormatter } from "./request_manager/formatters.ts";
import {
  processDialogCompletion as helperProcessDialogCompletion,
  type RequestDialogTypeUnion,
} from "./request_manager/dialog_handlers.ts";
import {
  MessageType,
  type NavDirection,
  RequestDialogType,
  RequestGroupingMode,
  RequestOperation,
  RequestPriority,
  RequestSource,
  TuiNodeType,
} from "@exaix/core";
import { ConfirmDialog, InputDialog } from "./helpers/dialog_base.ts";

import type {
  IRequestEntry as IRequest,
  IRequestMetadata,
  IRequestOptions,
  IRequestShowResult,
} from "../shared/types/request.ts";
import type { IRequestService } from "../shared/interfaces/i_request_service.ts";
import {
  TUI_ELEMENT_ACTION_BUTTONS,
  TUI_KEY_LABEL_ENTER,
  TUI_PRIORITY_ICONS,
  TUI_STATUS_ICONS,
} from "./helpers/constants.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";

/**
 * View state interface
 */
export interface IRequestViewState {
  selectedRequestId: string | null;
  requestTree: ITreeNode[];
  showHelp: boolean;
  showDetail: boolean;
  showArchived: boolean;
  detailContent: string;
  activeDialog: InputDialog | ConfirmDialog | null;
  searchQuery: string;
  filterStatus: RequestStatusType | null;
  filterPriority: string | null;
  filterIdentity: string | null;
  groupBy: RequestGroupingMode;
}
/**
 * Internal action types for request management.
 */
export type InternalRequestAction = RequestOperation;

// --- Phase 13.6: Visual constants ---
export const PRIORITY_ICONS: Record<string, string> = {
  [RequestPriority.CRITICAL]: TUI_PRIORITY_ICONS.critical,
  [RequestPriority.HIGH]: TUI_PRIORITY_ICONS.high,
  [RequestPriority.NORMAL]: TUI_PRIORITY_ICONS.normal,
  [RequestPriority.LOW]: TUI_PRIORITY_ICONS.low,
};

export const STATUS_ICONS: Record<string, string> = {
  [RequestStatus.PENDING]: TUI_STATUS_ICONS.pending,
  [RequestStatus.PLANNED]: TUI_STATUS_ICONS.queued,
  [RequestStatus.IN_PROGRESS]: TUI_STATUS_ICONS.running,
  [RequestStatus.COMPLETED]: TUI_STATUS_ICONS.completed,
  [RequestStatus.CANCELLED]: TUI_STATUS_ICONS.cancelled,
  [RequestStatus.FAILED]: TUI_STATUS_ICONS.failed,
  [RequestStatus.ANALYZING]: "🔍",
};

export const STATUS_COLORS: Record<string, string> = {
  [RequestStatus.PENDING]: "yellow",
  [RequestStatus.PLANNED]: "cyan",
  [RequestStatus.IN_PROGRESS]: "blue",
  [RequestStatus.COMPLETED]: "green",
  [RequestStatus.CANCELLED]: "dim",
  [RequestStatus.FAILED]: "red",
  [RequestStatus.ANALYZING]: "magenta",
};

// --- Phase 13.6: Key bindings ---

export enum RequestAction {
  NAVIGATE_UP = "navigate-up",
  NAVIGATE_DOWN = "navigate-down",
  NAVIGATE_HOME = "navigate-home",
  NAVIGATE_END = "navigate-end",
  COLLAPSE = "collapse",
  EXPAND = "expand",
  VIEW_DETAIL = "view-detail",
  CREATE = "create",
  DELETE = "delete",
  PRIORITY = "priority",
  SEARCH = "search",
  FILTER_STATUS = "filter-status",
  FILTER_IDENTITY = "filter-identity",
  TOGGLE_GROUPING = "toggle-grouping",
  TOGGLE_ARCHIVED = "toggle-archived",
  REFRESH = "refresh",
  COLLAPSE_ALL = "collapse-all",
  EXPAND_ALL = "expand-all",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}

export class RequestKeyBindings extends KeyBindingsBase<RequestAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<RequestAction, KeyBindingCategory>[] = [
    {
      key: KEYS.UP,
      description: "Navigate up",
      action: RequestAction.NAVIGATE_UP,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.DOWN,
      description: "Navigate down",
      action: RequestAction.NAVIGATE_DOWN,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.HOME,
      description: "Jump to first",
      action: RequestAction.NAVIGATE_HOME,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.END,
      description: "Jump to last",
      action: RequestAction.NAVIGATE_END,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.LEFT,
      description: "Collapse group",
      action: RequestAction.COLLAPSE,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.RIGHT,
      description: "Expand group",
      action: RequestAction.EXPAND,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.ENTER,
      description: "View request details",
      action: RequestAction.VIEW_DETAIL,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.C,
      description: "Create new request",
      action: RequestAction.CREATE,
      category: KeyBindingCategory.ACTIONS,
    },
    { key: KEYS.D, description: "Cancel request", action: RequestAction.DELETE, category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.P,
      description: "Change priority",
      action: RequestAction.PRIORITY,
      category: KeyBindingCategory.ACTIONS,
    },
    { key: KEYS.S, description: "Search requests", action: RequestAction.SEARCH, category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.F,
      description: "Filter by status",
      action: RequestAction.FILTER_STATUS,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.A,
      description: "Filter by identity",
      action: RequestAction.FILTER_IDENTITY,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.G,
      description: "Toggle grouping",
      action: RequestAction.TOGGLE_GROUPING,
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.H,
      description: "Toggle archived/history",
      action: RequestAction.TOGGLE_ARCHIVED,
      category: KeyBindingCategory.VIEW,
    },
    { key: KEYS.R, description: "Force refresh", action: RequestAction.REFRESH, category: KeyBindingCategory.VIEW },
    {
      key: KEYS.CAP_C,
      description: "Collapse all",
      action: RequestAction.COLLAPSE_ALL,
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_E,
      description: "Expand all",
      action: RequestAction.EXPAND_ALL,
      category: KeyBindingCategory.VIEW,
    },
    { key: KEYS.QUESTION, description: "Show help", action: RequestAction.HELP, category: KeyBindingCategory.HELP },
    { key: KEYS.Q, description: "Quit", action: RequestAction.QUIT, category: KeyBindingCategory.HELP },
    { key: KEYS.ESCAPE, description: "Cancel/close", action: RequestAction.CANCEL, category: KeyBindingCategory.HELP },
  ];
}

export const REQUEST_KEY_BINDINGS = new RequestKeyBindings().KEY_BINDINGS;

// --- Minimal RequestService mock for TUI session tests ---
/**
 * Minimal IRequestService mock for TUI session tests.
 */
export class MinimalRequestServiceMock implements IRequestService {
  constructor(private requests: IRequest[] = []) {}
  listRequests(_status?: RequestStatusType, _includeArchived?: boolean): Promise<IRequest[]> {
    return Promise.resolve(this.requests);
  }
  getRequestContent(_: string): Promise<string> {
    return Promise.resolve("");
  }
  getAnalysis(_: string): Promise<IRequestAnalysis | null> {
    return Promise.resolve(null);
  }
  analyze(
    _: string,
    _options?: { mode?: AnalysisMode; force?: boolean },
  ): Promise<IRequestAnalysis> {
    return Promise.resolve({} as IRequestAnalysis);
  }
  createRequest(_: string, __?: IRequestOptions): Promise<IRequest> {
    return Promise.resolve({} as IRequest);
  }
  updateRequestStatus(_requestId: string, _status: RequestStatusType): Promise<boolean> {
    return Promise.resolve(true);
  }

  create(description: string, options?: IRequestOptions, _source?: RequestSource): Promise<IRequestMetadata> {
    return Promise.resolve({
      trace_id: "new-request",
      path: "request-1.md",
      subject: description,
      status: RequestStatus.PENDING,
      priority: options?.priority || RequestPriority.NORMAL,
      identity: options?.identity || options?.agent || "default",
      created: new Date().toISOString(),
      filename: "request-1.md",
      source: RequestSource.TUI,
      created_by: "test-user",
    } as IRequestMetadata);
  }

  async list(status?: RequestStatusType): Promise<IRequest[]> {
    return await this.listRequests(status);
  }

  show(requestId: string): Promise<IRequestShowResult> {
    const r = this.requests.find((x: IRequest) => x.trace_id === requestId || x.filename === requestId);
    if (!r) throw new Error("Request not found");
    return Promise.resolve({
      metadata: r,
      content: "Mock content",
    });
  }
}

// --- Phase 13.6: Enhanced TUI Session ---
/**
 * Enhanced TUI session for Request Manager.
 * Features: tree view, grouping, detail panel, search/filter, help screen.
 */
export class RequestManagerTuiSession extends TuiSessionBase {
  // Enhanced state
  protected state: IRequestViewState;

  // Request list cache
  protected requests: IRequest[] = [];

  // Track pending dialog type for result handling
  private pendingDialogType: RequestDialogTypeUnion = null;

  // Pending cancel request ID for confirm dialog
  private pendingCancelRequestId: string | null = null;

  constructor(
    requests: IRequest[],
    protected readonly service: IRequestService,
    useColors = true,
  ) {
    super(useColors);
    this.requests = requests;

    this.state = {
      selectedRequestId: requests[0]?.trace_id || null,
      requestTree: [],
      showHelp: false,
      showDetail: false,
      showArchived: false,
      detailContent: "",
      activeDialog: null,
      searchQuery: "",
      filterStatus: null,
      filterPriority: null,
      filterIdentity: null,
      groupBy: RequestGroupingMode.NONE,
    };

    // Build initial tree
    this.buildTree();
  }

  // ===== State Accessors =====

  getState(): IRequestViewState {
    return this.state;
  }

  getRequests(): IRequest[] {
    return this.requests;
  }

  getSelectedRequest(): IRequest | null {
    if (!this.state.selectedRequestId) return null;
    return this.requests.find((r) => r.trace_id === this.state.selectedRequestId) || null;
  }

  /**
   * Check if an ID is a group node ID (not a request ID).
   */
  private isGroupNode(id: string): boolean {
    return helperIsGroupNode(this.state.requestTree, id);
  }

  /**
   * Get the index of the currently selected request (for backwards compatibility).
   * Returns the index in the requests array, or 0 if nothing selected.
   */
  getSelectedIndexInRequests(): number {
    if (!this.state.selectedRequestId) return 0;
    const idx = this.requests.findIndex((r) => r.trace_id === this.state.selectedRequestId);
    return idx >= 0 ? idx : 0;
  }

  /**
   * Set selection by index (for backwards compatibility).
   * Selects the request at the given index in the requests array.
   */
  setSelectedByIndex(idx: number): void {
    if (idx >= 0 && idx < this.requests.length) {
      this.state.selectedRequestId = this.requests[idx].trace_id;
    }
  }

  // ===== Tree Building =====

  buildTree(): void {
    const filtered = this.getFilteredRequests();

    switch (this.state.groupBy) {
      case RequestGroupingMode.STATUS:
        this.state.requestTree = this.buildGroupedByStatus(filtered);
        break;
      case RequestGroupingMode.PRIORITY:
        this.state.requestTree = this.buildGroupedByPriority(filtered);
        break;
      case RequestGroupingMode.IDENTITY:
        this.state.requestTree = this.buildGroupedByIdentity(filtered);
        break;
      default:
        this.state.requestTree = this.buildFlatTree(filtered);
    }

    // Ensure selection is valid
    if (this.state.selectedRequestId) {
      const node = findNode(this.state.requestTree, this.state.selectedRequestId);
      if (!node) {
        // Selection not found, select first available
        const flat = flattenTree(this.state.requestTree);
        const first = flat.find((n) => n.node.type === "item");
        this.state.selectedRequestId = first?.node.id || null;
      }
    }
  }

  private buildFlatTree(requests: IRequest[]): ITreeNode[] {
    return requests.map((r) => this.createRequestNode(r));
  }

  private buildGroupedByStatus(requests: IRequest[]): ITreeNode[] {
    const groups = new Map<RequestStatusType, IRequest[]>();
    for (const req of requests) {
      const status = req.status;
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status)!.push(req);
    }

    return Array.from(groups.entries()).map(([status, reqs]) => {
      const icon = STATUS_ICONS[status] || "❓";
      return createGroupNode(
        `status-${status}`,
        `${icon} ${status} (${reqs.length})`,
        TuiNodeType.GROUP,
        reqs.map((r) => this.createRequestNode(r)),
        { expanded: true },
      );
    });
  }

  private buildGroupedByPriority(requests: IRequest[]): ITreeNode[] {
    const priorityOrder = [RequestPriority.CRITICAL, RequestPriority.HIGH, RequestPriority.NORMAL, RequestPriority.LOW];
    const groups = new Map<string, IRequest[]>();

    for (const req of requests) {
      const priority = req.priority || RequestPriority.NORMAL;
      if (!groups.has(priority)) groups.set(priority, []);
      groups.get(priority)!.push(req);
    }

    return priorityOrder
      .filter((p) => groups.has(p))
      .map((priority) => {
        const reqs = groups.get(priority)!;
        const icon = PRIORITY_ICONS[priority] || "⚪";
        return createGroupNode(
          `priority-${priority}`,
          `${icon} ${priority} (${reqs.length})`,
          TuiNodeType.GROUP,
          reqs.map((r) => this.createRequestNode(r)),
          { expanded: true },
        );
      });
  }

  private buildGroupedByIdentity(requests: IRequest[]): ITreeNode[] {
    const groups = new Map<string, IRequest[]>();
    for (const req of requests) {
      const identity = req.identity || "unassigned";
      if (!groups.has(identity)) groups.set(identity, []);
      groups.get(identity)!.push(req);
    }

    return Array.from(groups.entries()).map(([identity, reqs]) => {
      return createGroupNode(
        `identity-${identity}`,
        `👤 ${identity} (${reqs.length})`,
        TuiNodeType.GROUP,
        reqs.map((r) => this.createRequestNode(r)),
        { expanded: true },
      );
    });
  }

  private createRequestNode(request: IRequest): ITreeNode {
    const statusIcon = STATUS_ICONS[request.status] || "❓";
    const priorityIcon = PRIORITY_ICONS[request.priority] || "⚪";
    const date = new Date(request.created).toLocaleString();
    const label = `${statusIcon} ${priorityIcon} ${request.subject} - ${request.identity} - ${date}`;

    return createNode(request.trace_id, label, "item");
  }

  // ===== Filtering =====

  getFilteredRequests(): IRequest[] {
    let filtered = this.requests;

    // Apply status filter
    if (this.state.filterStatus) {
      filtered = filtered.filter((r) => r.status === this.state.filterStatus);
    }

    // Apply priority filter
    if (this.state.filterPriority) {
      filtered = filtered.filter((r) => r.priority === this.state.filterPriority);
    }

    // Apply identity filter
    if (this.state.filterIdentity) {
      const query = this.state.filterIdentity.toLowerCase();
      filtered = filtered.filter((r) => r.identity.toLowerCase().includes(query));
    }

    // Apply search query
    if (this.state.searchQuery) {
      const query = this.state.searchQuery.toLowerCase();
      filtered = filtered.filter((r) =>
        (r.subject && r.subject.toLowerCase().includes(query)) ||
        (r.trace_id && r.trace_id.toLowerCase().includes(query)) ||
        (r.identity && r.identity.toLowerCase().includes(query)) ||
        (r.created_by && r.created_by.toLowerCase().includes(query))
      );
    }

    return filtered;
  }

  // ===== Grouping =====

  toggleGrouping(): void {
    const modes = [
      RequestGroupingMode.NONE,
      RequestGroupingMode.STATUS,
      RequestGroupingMode.PRIORITY,
      RequestGroupingMode.IDENTITY,
    ];
    const currentIdx = modes.indexOf(this.state.groupBy);
    this.state.groupBy = modes[(currentIdx + 1) % modes.length];
    this.buildTree();
    this.setStatus(`Grouping: ${this.state.groupBy}`, MessageType.INFO);
  }

  toggleShowArchived(): void {
    this.state.showArchived = !this.state.showArchived;
    this.refresh();
    this.setStatus(`Show Archived: ${this.state.showArchived ? "ON" : "OFF"}`, MessageType.INFO);
  }

  // ===== Navigation =====

  navigateTree(direction: NavDirection): void {
    this.state.selectedRequestId = NavigationHandler.navigate(
      this.state.requestTree,
      this.state.selectedRequestId,
      direction,
    );
  }

  // Node expansion/collapse
  expandSelectedNode(): void {
    this.state.requestTree = TreeManipulationHandler.expandNode(
      this.state.requestTree,
      this.state.selectedRequestId,
    );
  }

  collapseSelectedNode(): void {
    this.state.requestTree = TreeManipulationHandler.collapseNode(
      this.state.requestTree,
      this.state.selectedRequestId,
    );
  }

  toggleSelectedNode(): void {
    this.state.requestTree = TreeManipulationHandler.toggleNode(
      this.state.requestTree,
      this.state.selectedRequestId,
    );
  }

  // ===== Detail View =====

  async showRequestDetail(requestId: string): Promise<void> {
    try {
      const content = await this.service.getRequestContent(requestId);
      const request = this.requests.find((r) => r.trace_id === requestId);
      let analysis: IRequestAnalysis | null = null;

      try {
        analysis = await this.service.getAnalysis(requestId);
      } catch (e) {
        // Silently fail if analysis is missing
        console.warn(`Could not load analysis for ${requestId}: ${e}`);
      }

      this.state.detailContent = this.formatDetailContent(request, content, analysis);
      this.state.showDetail = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to load details: ${msg}`, MessageType.ERROR);
    }
  }

  private formatDetailContent(
    request: IRequest | undefined,
    content: string,
    analysis: IRequestAnalysis | null,
  ): string {
    return RequestFormatter.formatDetailContent(request, content, analysis);
  }

  renderDetail(): string {
    return this.state.detailContent;
  }

  // ===== Dialogs =====

  showSearchDialog(): void {
    this.state.activeDialog = new InputDialog({
      title: "Search Requests",
      label: "Enter search term:",
      placeholder: "title, ID, or agent...",
      defaultValue: this.state.searchQuery,
    });
    this.pendingDialogType = RequestDialogType.SEARCH;
  }

  showFilterStatusDialog(): void {
    this.state.activeDialog = new InputDialog({
      title: "Filter by Status",
      label: "Status (pending, planned, in_progress, completed, cancelled):",
      placeholder: "status...",
      defaultValue: this.state.filterStatus || "",
    });
    this.pendingDialogType = RequestDialogType.FILTER_STATUS;
  }

  showFilterIdentityDialog(): void {
    this.state.activeDialog = new InputDialog({
      title: "Filter by Identity",
      label: "Enter identity name (or empty for all):",
      placeholder: "identity name...",
      defaultValue: this.state.filterIdentity || "",
    });
    this.pendingDialogType = RequestDialogType.FILTER_IDENTITY; // Reuse enum if needed, or update enum
  }

  showCreateDialog(): void {
    this.state.activeDialog = new InputDialog({
      title: "Create Request",
      label: "Enter request description:",
      placeholder: "What would you like to request?",
    });
    this.pendingDialogType = RequestDialogType.CREATE;
  }

  showCancelConfirm(requestId: string): void {
    const request = this.requests.find((r) => r.trace_id === requestId);
    if (!request) return;

    this.state.activeDialog = new ConfirmDialog({
      title: "Cancel Request",
      message: `Are you sure you want to cancel request "${request.subject}"?`,
      confirmText: "Cancel Request",
      cancelText: "Keep",
    });
    this.pendingCancelRequestId = requestId;
  }

  showPriorityDialog(): void {
    this.state.activeDialog = new InputDialog({
      title: "Change Priority",
      label: "Enter new priority (low, normal, high, critical):",
      placeholder: "priority...",
    });
    this.pendingDialogType = RequestDialogType.PRIORITY;
  }

  // Dialog result handlers
  private handleSearchResult(value: string): void {
    this.state.searchQuery = value;
    this.buildTree();
    this.setStatus(value ? `Search: "${value}"` : "Search cleared", MessageType.INFO);
  }

  private handleFilterStatusResult(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      this.state.filterStatus = null;
      this.buildTree();
      this.setStatus("Status filter cleared", MessageType.INFO);
      return;
    }

    if (!isRequestStatus(trimmed)) {
      this.setStatus(
        `Invalid status: ${trimmed}. Expected one of: ${Object.values(RequestStatus).join(", ")}`,
        MessageType.ERROR,
      );
      return;
    }

    this.state.filterStatus = trimmed;
    this.buildTree();
    this.setStatus(`Filtering: status=${trimmed}`, MessageType.INFO);
  }

  private handleFilterIdentityResult(value: string): void {
    this.state.filterIdentity = value || null;
    this.buildTree();
    this.setStatus(value ? `Filtering: identity=${value}` : "Identity filter cleared", MessageType.INFO);
  }

  private async handleCreateResult(description: string): Promise<void> {
    if (!description) return;

    try {
      this.startLoading("Creating request...");
      const newRequest = await this.service.createRequest(description, { priority: RequestPriority.NORMAL });
      this.requests.push(newRequest);
      this.buildTree();
      this.setStatus(`Created request: ${newRequest.trace_id.slice(0, 8)}`, MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to create: ${msg}`, MessageType.ERROR);
    } finally {
      this.stopLoading();
    }
  }

  private async handleCancelConfirm(): Promise<void> {
    if (!this.pendingCancelRequestId) return;

    const requestId = this.pendingCancelRequestId;
    this.pendingCancelRequestId = null;

    try {
      this.startLoading("Cancelling request...");
      await this.service.updateRequestStatus(requestId, RequestStatus.CANCELLED);

      // Update local state
      const request = this.requests.find((r) => r.trace_id === requestId);
      if (request) {
        request.status = RequestStatus.CANCELLED;
      }
      this.buildTree();
      this.setStatus(`Cancelled request: ${requestId.slice(0, 8)}`, MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to cancel: ${msg}`, MessageType.ERROR);
    } finally {
      this.stopLoading();
    }
  }

  /**
   * Handle completed dialogs (delegated from handleKey).
   * Extracted to keep handleKey concise and improve testability.
   */
  private async processDialogCompletion(
    dialog: InputDialog | ConfirmDialog | null,
    dialogType: RequestDialogTypeUnion,
  ): Promise<void> {
    await helperProcessDialogCompletion(dialog, dialogType, {
      handleSearchResult: this.handleSearchResult.bind(this),
      handleFilterStatusResult: this.handleFilterStatusResult.bind(this),
      handleFilterIdentityResult: this.handleFilterIdentityResult.bind(this),
      handleCreateResult: this.handleCreateResult.bind(this),
      handlePriorityResult: this.handlePriorityResult.bind(this),
      processConfirmDialog: this.processConfirmDialog.bind(this),
      setStatus: this.setStatus.bind(this),
    });
  }

  private async processConfirmDialog(_dialog: ConfirmDialog): Promise<void> {
    try {
      await this.handleCancelConfirm();
    } catch (e) {
      this.setStatus(`Error: ${e}`, MessageType.ERROR);
    }
  }

  private handlePriorityResult(value: string): void {
    if (!value || !this.state.selectedRequestId) return;

    const validPriorities = [
      RequestPriority.LOW,
      RequestPriority.NORMAL,
      RequestPriority.HIGH,
      RequestPriority.CRITICAL,
    ];
    if (!validPriorities.includes(value.toLowerCase() as RequestPriority)) {
      this.setStatus("Invalid priority. Use: low, normal, high, critical", MessageType.ERROR);
      return;
    }

    // For now, just update local state (service may not support this)
    const request = this.requests.find((r) => r.trace_id === this.state.selectedRequestId);
    if (request) {
      request.priority = value.toLowerCase() as RequestPriority;
      this.buildTree();
      this.setStatus(`Priority changed to ${value}`, MessageType.SUCCESS);
    }
  }

  // ===== Help =====

  getHelpSections(): IHelpSection[] {
    return [
      {
        title: "Navigation",
        items: [
          { key: "↑/↓", description: "Navigate requests" },
          { key: "Home/End", description: "Jump to first/last" },
          { key: "←/→", description: "Collapse/Expand group" },
          { key: TUI_KEY_LABEL_ENTER, description: "View request details" },
        ],
      },
      {
        title: "Actions",
        items: [
          { key: "c", description: "Create new request" },
          { key: "d", description: "Cancel selected request" },
          { key: "p", description: "Change priority" },
          { key: "R", description: "Refresh list" },
        ],
      },
      {
        title: "Search & Filter",
        items: [
          { key: "s", description: "Search requests" },
          { key: "f", description: "Filter by status" },
          { key: "a", description: "Filter by agent" },
          { key: "g", description: "Toggle grouping" },
          { key: "h", description: "Toggle archived/history" },
        ],
      },
      {
        title: "View",
        items: [
          { key: "c/E", description: "Collapse/Expand all" },
          { key: "?", description: "Toggle help" },
          { key: "q/ESC", description: "Close/Exit" },
        ],
      },
    ];
  }

  renderHelp(): string[] {
    return renderHelpScreen({
      title: "Request Manager Help",
      sections: this.getHelpSections(),
      useColors: this.useColors,
      width: 60,
    });
  }

  // ===== Rendering =====

  renderTree(): string[] {
    if (this.state.requestTree.length === 0) {
      return ["No requests found."];
    }

    return renderTree(this.state.requestTree, {
      selectedId: this.state.selectedRequestId || undefined,
      useColors: this.useColors,
    });
  }

  render(): string {
    // If help is showing
    if (this.state.showHelp) {
      return this.renderHelp().join("\n");
    }

    // If detail is showing
    if (this.state.showDetail) {
      return this.renderDetail();
    }

    // Build header
    const lines: string[] = [];
    lines.push("═══════════════════════════════════════════════════════════════");
    lines.push("                     REQUEST MANAGER                            ");
    lines.push("═══════════════════════════════════════════════════════════════");
    lines.push("");

    // Show current filters
    const filters: string[] = [];
    if (this.state.searchQuery) filters.push(`search="${this.state.searchQuery}"`);
    if (this.state.filterStatus || this.state.filterIdentity) {
      filters.push(`Status: ${this.state.filterStatus || "all"} | Identity: ${this.state.filterIdentity || "all"}`);
    }
    if (filters.length > 0) {
      lines.push(`Filters: ${filters.join(", ")}`);
    }
    lines.push(
      `Grouping: ${this.state.groupBy} | Archived: ${
        this.state.showArchived ? "Show" : "Hide"
      } | Total: ${this.requests.length} | Shown: ${this.getFilteredRequests().length}`,
    );
    lines.push("───────────────────────────────────────────────────────────────");
    lines.push("");

    // Tree
    lines.push(...this.renderTree());
    lines.push("");

    // Status bar
    if (this.spinnerState.active) {
      lines.push(`${this.spinnerState.message}`);
    } else if (this.statusMessage) {
      lines.push(this.statusMessage);
    }

    lines.push("───────────────────────────────────────────────────────────────");
    lines.push("↑↓:Navigate  Enter:View  c:Create  d:Cancel  s:Search  ?:Help");

    return lines.join("\n");
  }

  // ===== Key Handling =====

  async handleKey(key: string): Promise<boolean> {
    // Handle active dialog first
    if (this.state.activeDialog) {
      this.state.activeDialog.handleKey(key);

      // Check if dialog completed
      if (!this.state.activeDialog.isActive()) {
        const dialog = this.state.activeDialog;
        const dialogType = this.pendingDialogType;
        this.state.activeDialog = null;
        this.pendingDialogType = null;
        // Delegate dialog completion handling to helpers
        await this.processDialogCompletion(dialog, dialogType);
      }
      return true;
    }

    // Handle detail view
    if (this.state.showDetail) {
      return this.handleDetailKey(key);
    }

    // Handle help
    if (this.state.showHelp) {
      return this.handleHelpKey(key);
    }

    // Main key handling
    return await this.handleMainKey(key);
  }

  private handleDetailKey(key: string): boolean {
    if (key === KEYS.ESCAPE || key === KEYS.Q) {
      this.state.showDetail = false;
    }
    return true;
  }

  private handleHelpKey(key: string): boolean {
    if (key === KEYS.QUESTION || key === KEYS.ESCAPE || key === KEYS.Q) {
      this.state.showHelp = false;
    }
    return true;
  }

  private async handleMainKey(key: string): Promise<boolean> {
    return await MainKeyHandler.handle(
      key,
      {
        selectedRequestId: this.state.selectedRequestId,
        requestTree: this.state.requestTree,
      },
      {
        navigateTree: this.navigateTree.bind(this),
        collapseSelectedNode: this.collapseSelectedNode.bind(this),
        expandSelectedNode: this.expandSelectedNode.bind(this),
        toggleSelectedNode: this.toggleSelectedNode.bind(this),
        toggleGrouping: this.toggleGrouping.bind(this),
        toggleShowArchived: this.toggleShowArchived.bind(this),
        refresh: this.refresh.bind(this),
        showRequestDetail: this.showRequestDetail.bind(this),
        showCreateDialog: this.showCreateDialog.bind(this),
        showCancelConfirm: this.showCancelConfirm.bind(this),
        showPriorityDialog: this.showPriorityDialog.bind(this),
        showSearchDialog: this.showSearchDialog.bind(this),
        showFilterStatusDialog: this.showFilterStatusDialog.bind(this),
        showFilterIdentityDialog: this.showFilterIdentityDialog.bind(this),
        setShowHelp: (show: boolean) => this.state.showHelp = show,
        updateTree: (tree: ITreeNode[]) => this.state.requestTree = tree,
      },
    );
  }

  // ===== Lifecycle =====

  override async refresh(): Promise<void> {
    try {
      this.startLoading("Refreshing requests...");
      const requests = await this.service.listRequests(undefined, this.state.showArchived);
      this.requests = requests;
      this.buildTree();
      this.setStatus("Requests refreshed", MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Refresh failed: ${msg}`, MessageType.ERROR);
    } finally {
      this.stopLoading();
    }
  }

  setRequests(requests: IRequest[]): void {
    this.requests = requests;
    this.buildTree();
  }

  getFocusableElements(): string[] {
    return ["request-list", TUI_ELEMENT_ACTION_BUTTONS];
  }
}

// --- Legacy TUI Session (backwards compatibility) ---
/**
 * Legacy TUI session for Request Manager. Encapsulates state and user interaction logic.
 * @deprecated Use RequestManagerTuiSession instead
 */
export class LegacyRequestManagerTuiSession {
  private selectedIndex = 0;
  private statusMessage = "";

  /**
   * @param requests Initial list of requests
   * @param service Service for request operations
   */
  constructor(private readonly requests: IRequest[], private readonly service: IRequestService) {}

  /** Get the currently selected request index. */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /** Set the selected request index, clamped to valid range. */
  setSelectedIndex(idx: number): void {
    if (idx < 0 || idx >= this.requests.length) {
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = idx;
    }
  }

  /** Handle a TUI key event. */
  async handleKey(key: string): Promise<void> {
    if (this.requests.length === 0) return;

    switch (key) {
      case KEYS.DOWN:
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.requests.length - 1);
        break;
      case "up":
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        break;
      case "end":
        this.selectedIndex = this.requests.length - 1;
        break;
      case "home":
        this.selectedIndex = 0;
        break;
      case "c":
        await this.#triggerAction(RequestOperation.CREATE);
        break;
      case "v":
        await this.#triggerAction(RequestOperation.VIEW);
        break;
      case "d":
        await this.#triggerAction(RequestOperation.DELETE);
        break;
    }

    if (this.selectedIndex >= this.requests.length) {
      this.selectedIndex = Math.max(0, this.requests.length - 1);
    }
  }

  /**
   * Trigger a request action and update status.
   * @param action Action to perform
   */
  async #triggerAction(action: InternalRequestAction) {
    try {
      switch (action) {
        case RequestOperation.CREATE: {
          const newRequest = await this.service.createRequest("New request from TUI", {
            priority: RequestPriority.NORMAL,
          });
          this.statusMessage = `Created request: ${newRequest.trace_id.slice(0, 8)}`;
          break;
        }
        case RequestOperation.VIEW: {
          const request = this.requests[this.selectedIndex];
          if (request) {
            const _content = await this.service.getRequestContent(request.trace_id);
            this.statusMessage = `Viewing: ${request.trace_id.slice(0, 8)}`;
            // In a real implementation, this would open a detail view
          }
          break;
        }
        case RequestOperation.DELETE: {
          const delRequest = this.requests[this.selectedIndex];
          if (delRequest) {
            await this.service.updateRequestStatus(delRequest.trace_id, RequestStatus.CANCELLED);
            this.statusMessage = `Cancelled request: ${delRequest.trace_id.slice(0, 8)}`;
          }
          break;
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "message" in e) {
        this.statusMessage = `Error: ${(e as Error).message}`;
      } else {
        this.statusMessage = `Error: ${String(e)}`;
      }
    }
  }

  /** Get the current status message. */
  getStatusMessage(): string {
    return this.statusMessage;
  }

  /** Get the currently selected request. */
  getSelectedRequest(): IRequest | null {
    return this.requests[this.selectedIndex] || null;
  }
}

/**
 * View/controller for Request Manager. Delegates to injected IRequestService.
 */
export class RequestManagerView implements IRequestService {
  constructor(public readonly service: IRequestService) {}

  /** Create a new TUI session for the given requests. */
  createTuiSession(requests: IRequest[]): RequestManagerTuiSession {
    return new RequestManagerTuiSession(requests, this.service);
  }

  listRequests(status?: RequestStatusType): Promise<IRequest[]> {
    return this.service.listRequests(status);
  }

  getRequestContent(requestId: string): Promise<string> {
    return this.service.getRequestContent(requestId);
  }

  getAnalysis(requestId: string): Promise<IRequestAnalysis | null> {
    return this.service.getAnalysis(requestId);
  }

  analyze(
    requestId: string,
    options?: { mode?: AnalysisMode; force?: boolean },
  ): Promise<IRequestAnalysis> {
    return this.service.analyze(requestId, options);
  }

  createRequest(description: string, options?: IRequestOptions): Promise<IRequest> {
    return this.service.createRequest(description, options);
  }

  updateRequestStatus(requestId: string, status: RequestStatusType): Promise<boolean> {
    return this.service.updateRequestStatus(requestId, status);
  }

  create(description: string, options?: IRequestOptions, source?: RequestSource): Promise<IRequestMetadata> {
    return this.service.create(description, options, source);
  }

  list(status?: RequestStatusType): Promise<IRequest[]> {
    return this.service.list(status);
  }

  show(requestId: string): Promise<IRequestShowResult> {
    return this.service.show(requestId);
  }

  /** Render a list of requests for display. */
  renderRequestList(requests: IRequest[]): string {
    if (requests.length === 0) {
      return "No requests found.";
    }

    const lines = ["Requests:", ""];
    for (const request of requests) {
      const priorityIcon = request.priority === "critical"
        ? "🔴"
        : request.priority === "high"
        ? "🟠"
        : request.priority === "low"
        ? "🔵"
        : "⚪";
      const statusIcon = request.status === RequestStatus.PENDING
        ? "⏳"
        : request.status === RequestStatus.PLANNED
        ? "📋"
        : request.status === RequestStatus.COMPLETED
        ? "✅"
        : request.status === RequestStatus.CANCELLED
        ? "❌"
        : "❓";

      lines.push(
        `${statusIcon} ${priorityIcon} ${request.subject} - ${request.identity} - ${
          new Date(request.created).toLocaleString()
        }`,
      );
    }
    return lines.join("\n");
  }

  /** Render request content for display. */
  renderRequestContent(content: string): string {
    return content;
  }
}
