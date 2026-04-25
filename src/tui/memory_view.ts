/**
 * @module MemoryView
 * @path src/tui/memory_view.ts
 * @description TUI view for interacting with memory banks, supporting search, filtering, and review of pending memory proposals.
 * @architectural-layer TUI
 * * @related-files [src/services/memory_service.ts, src/tui/tui_dashboard.ts]
 */

import { TuiSessionBase } from "./tui_common.ts";
import { TUI_ELEMENT_ACTION_BUTTONS } from "./helpers/constants.ts";
import { TuiNodeType } from "@exaix/core";
// Redundant import removed
import { MemoryFormatter } from "./memory_view/formatters.ts";
import { TreeBuilder } from "./memory_view/tree_builder.ts";
import { DialogProcessor } from "./memory_view/dialog_processor.ts";
import { KeyHandler } from "./memory_view/key_handlers.ts";
import type { IMemoryService, ITreeNode } from "./memory_view/types.ts";
import {
  AddLearningDialog,
  BulkApproveDialog,
  ConfirmApproveDialog,
  ConfirmRejectDialog,
  PromoteDialog,
} from "./dialogs/memory_dialogs.ts";
import type { DialogBase } from "./helpers/dialog_base.ts";
import { renderSpinner } from "./helpers/markdown_renderer.ts";
import { KEYS } from "./helpers/keyboard.ts";
import { coerceMemoryTuiScope, type IMemoryTuiScopeType, MemoryTuiScope } from "./memory_view/memory_scope.ts";
import { MEMORY_STALE_MS } from "./tui.config.ts";

// ===== Interfaces =====

export interface IMemoryViewState {
  activeScope: IMemoryTuiScopeType;
  selectedNodeId: string | null;
  searchQuery: string;
  searchActive: boolean;
  tree: ITreeNode[];
  detailContent: string;
  pendingCount: number;
  activeDialog: DialogBase | null;
  isLoading: boolean;
  loadingMessage: string;
  spinnerFrame: number;
  useColors: boolean;
  lastRefresh: number;
}

// Service Adapter moved to src/services/adapters/memory_adapter.ts

// ===== TUI Session =====

/**
 * TUI Session for Memory View
 *
 * Manages state and user interaction for Memory Bank navigation.
 */
export class MemoryViewTuiSession extends TuiSessionBase {
  private state: IMemoryViewState;
  private service: IMemoryService;
  private flatNodes: ITreeNode[] = [];
  private keyHandler: KeyHandler;

  constructor(service: IMemoryService, useColors = true) {
    super();
    this.service = service;
    this.keyHandler = new KeyHandler();
    this.state = {
      activeScope: MemoryTuiScope.PROJECTS,
      selectedNodeId: null,
      searchQuery: "",
      searchActive: false,
      tree: [],
      detailContent: "Select a project or memory item to view details.",
      pendingCount: 0,
      activeDialog: null,
      isLoading: false,
      loadingMessage: "",
      spinnerFrame: 0,
      useColors,
      lastRefresh: Date.now(),
    };
  }

  // ===== State Accessors =====

  getState(): IMemoryViewState {
    return { ...this.state };
  }

  getActiveScope(): IMemoryTuiScopeType {
    return this.state.activeScope;
  }

  getSelectedNodeId(): string | null {
    return this.state.selectedNodeId;
  }

  setTree(tree: ITreeNode[]): void {
    this.state.tree = tree;
  }

  getTree(): ITreeNode[] {
    return this.state.tree;
  }

  getDetailContent(): string {
    return this.state.detailContent;
  }

  getPendingCount(): number {
    return this.state.pendingCount;
  }

  isLoading(): boolean {
    return this.state.isLoading;
  }

  getLoadingMessage(): string {
    return this.state.loadingMessage;
  }

  setUseColors(useColors: boolean): void {
    this.state.useColors = useColors;
  }

  /** Advance spinner animation frame */
  tickSpinner(): void {
    this.state.spinnerFrame = (this.state.spinnerFrame + 1) % 10;
  }

  isSearchActive(): boolean {
    return this.state.searchActive;
  }

  getSearchQuery(): string {
    return this.state.searchQuery;
  }

  getActiveDialog(): DialogBase | null {
    return this.state.activeDialog;
  }

  hasActiveDialog(): boolean {
    return this.state.activeDialog !== null && this.state.activeDialog.isActive();
  }

  // ===== Initialization =====

  /**
   * Initialize the view by loading memory bank data
   */
  async initialize(): Promise<void> {
    this.state.isLoading = true;
    this.state.loadingMessage = "Loading memory banks...";

    try {
      await this.loadTree();
      await this.loadPendingCount();

      // Select first node if available
      if (this.flatNodes.length > 0) {
        this.state.selectedNodeId = this.flatNodes[0].id;
        await this.loadDetailForNode(this.flatNodes[0]);
      }
    } finally {
      this.state.isLoading = false;
      this.state.loadingMessage = "";
      this.state.lastRefresh = Date.now();
    }
  }

  /**
   * Refresh data if stale (>30 seconds)
   */
  async refreshIfStale(): Promise<void> {
    const staleMs = MEMORY_STALE_MS; // 30 seconds
    if (Date.now() - this.state.lastRefresh > staleMs) {
      await this.refresh();
    }
  }

  /**
   * Force refresh all data
   */
  override async refresh(): Promise<void> {
    this.state.isLoading = true;
    this.state.loadingMessage = "Refreshing...";

    try {
      await this.loadTree();
      await this.loadPendingCount();
      this.state.lastRefresh = Date.now();
    } finally {
      this.state.isLoading = false;
      this.state.loadingMessage = "";
    }
  }

  /**
   * Load the memory bank tree structure
   */
  async loadTree(): Promise<void> {
    this.state.tree = await TreeBuilder.buildTree(this.service);
    this.flattenTree();
  }

  /**
   * Load pending proposals count
   */
  async loadPendingCount(): Promise<void> {
    const pending = await this.service.listPending();
    this.state.pendingCount = pending.length;
  }

  /**
   * Flatten tree for navigation
   */
  private flattenTree(): void {
    this.flatNodes = [];
    const flatten = (nodes: ITreeNode[]) => {
      for (const node of nodes) {
        this.flatNodes.push(node);
        if (node.expanded && node.children.length > 0) {
          flatten(node.children);
        }
      }
    };
    flatten(this.state.tree);
  }

  // ===== Navigation =====

  /**
   * Handle keyboard input
   */
  async handleKey(key: string): Promise<boolean> {
    // Dialog mode handling
    if (this.state.activeDialog && this.state.activeDialog.isActive()) {
      this.state.activeDialog.handleKey(key);
      if (!this.state.activeDialog.isActive()) {
        await this.processDialogResult();
      }
      return true;
    }

    // Search mode handling
    if (this.state.searchActive) {
      const result = KeyHandler.handleSearchKey(
        key,
        this.state.searchQuery,
        () => {
          this.state.searchActive = false;
          this.state.searchQuery = "";
          this.loadTree();
        },
        () => {
          this.executeSearch();
          this.state.searchActive = false;
        },
      );
      if (result.newQuery !== undefined) {
        this.state.searchQuery = result.newQuery;
      }
      return result.handled;
    }

    // Shortcut keys
    const shortcutHandled = await KeyHandler.handleShortcutKey(key, {
      jumpToScope: (scope) => this.jumpToScope(coerceMemoryTuiScope(scope)),
      startSearch: () => {
        this.state.searchActive = true;
        this.state.searchQuery = "";
      },
      showHelp: () => {
        this.state.detailContent = this.renderHelpContent();
      },
      approveProposal: () => this.approveSelectedProposal(),
      rejectProposal: () => this.rejectSelectedProposal(),
      approveAll: () => this.approveAllProposals(),
      addLearning: () => this.openAddLearningDialog(),
      promoteLearning: () => this.promoteSelectedLearning(),
      refresh: () => this.refresh(),
    });
    if (shortcutHandled) return true;

    // Navigation keys
    const navHandled = await KeyHandler.handleNavigationKey(
      key,
      this.flatNodes,
      this.state.selectedNodeId,
      async (nodeId, node) => {
        this.state.selectedNodeId = nodeId;
        await this.loadDetailForNode(node);
      },
    );
    if (navHandled) return true;

    // Handle expand/collapse
    if (key === KEYS.ENTER || key === KEYS.RIGHT) {
      await this.toggleExpand();
      return true;
    }
    if (key === KEYS.LEFT) {
      await this.collapseOrParent();
      return true;
    }

    return false;
  }

  /**
   * Jump to a specific scope
   */
  async jumpToScope(scope: IMemoryTuiScopeType): Promise<void> {
    this.state.activeScope = scope;
    const scopeNode = this.flatNodes.find((n) => n.id === scope);
    if (scopeNode) {
      this.state.selectedNodeId = scopeNode.id;
      await this.loadDetailForNode(scopeNode);
    }
  }

  /**
   * Toggle expand/collapse on current node
   */
  async toggleExpand(): Promise<void> {
    const node = this.findNodeById(this.state.selectedNodeId);
    if (!node) return;

    if (node.children.length > 0) {
      node.expanded = !node.expanded;
      this.flattenTree();
    }
    await this.loadDetailForNode(node);
  }

  /**
   * Collapse current node or move to parent
   */
  async collapseOrParent(): Promise<void> {
    const node = this.findNodeById(this.state.selectedNodeId);
    if (!node) return;

    if (node.expanded && node.children.length > 0) {
      node.expanded = false;
      this.flattenTree();
    } else {
      // Move to parent
      const parent = this.findParentNode(this.state.selectedNodeId);
      if (parent) {
        this.state.selectedNodeId = parent.id;
        await this.loadDetailForNode(parent);
      }
    }
  }

  /**
   * Find a node by ID in the tree
   */
  findNodeById(nodeId: string | null): ITreeNode | null {
    if (!nodeId) return null;
    const find = (nodes: ITreeNode[]): ITreeNode | null => {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        const found = find(node.children);
        if (found) return found;
      }
      return null;
    };
    return find(this.state.tree);
  }

  /**
   * Find parent node
   */
  private findParentNode(nodeId: string | null): ITreeNode | null {
    if (!nodeId) return null;
    const findParent = (nodes: ITreeNode[], parent: ITreeNode | null): ITreeNode | null => {
      for (const node of nodes) {
        if (node.id === nodeId) return parent;
        const found = findParent(node.children, node);
        if (found) return found;
      }
      return null;
    };
    return findParent(this.state.tree, null);
  }

  // ===== Actions =====

  private async fetchPendingProposal(action: string): Promise<Awaited<ReturnType<typeof this.service.getPending>>> {
    const node = this.findNodeById(this.state.selectedNodeId);
    if (!node || !node.id.startsWith("pending:")) {
      this.statusMessage = `Select a pending proposal to ${action}`;
      return null;
    }
    const proposalId = node.id.replace("pending:", "");
    const proposal = await this.service.getPending(proposalId);
    if (!proposal) {
      this.statusMessage = "Proposal not found";
      return null;
    }
    return proposal;
  }

  /**
   * Open approve dialog for selected pending proposal
   */
  async approveSelectedProposal(): Promise<void> {
    const proposal = await this.fetchPendingProposal("approve");
    if (!proposal) return;
    this.state.activeDialog = new ConfirmApproveDialog(proposal);
  }

  /**
   * Open reject dialog for selected pending proposal
   */
  async rejectSelectedProposal(): Promise<void> {
    const proposal = await this.fetchPendingProposal("reject");
    if (!proposal) return;
    this.state.activeDialog = new ConfirmRejectDialog(proposal);
  }

  /**
   * Open bulk approve dialog
   */
  async approveAllProposals(): Promise<void> {
    const pending = await this.service.listPending();
    if (pending.length === 0) {
      this.statusMessage = "No pending proposals to approve";
      return;
    }

    this.state.activeDialog = new BulkApproveDialog(pending.length);
  }

  /**
   * Open add learning dialog
   */
  openAddLearningDialog(): void {
    const node = this.findNodeById(this.state.selectedNodeId);
    let defaultPortal: string | undefined;

    if (node?.id.startsWith(`${TuiNodeType.PROJECT}:`)) {
      defaultPortal = node.id.replace(`${TuiNodeType.PROJECT}:`, "");
    }

    this.state.activeDialog = new AddLearningDialog(defaultPortal);
  }

  /**
   * Open promote dialog for selected learning
   */
  promoteSelectedLearning(): void {
    const node = this.findNodeById(this.state.selectedNodeId);
    if (!node || node.type !== "learning") {
      this.statusMessage = "Select a learning to promote";
      return;
    }

    // Check if it's a project learning
    const parent = this.findParentNode(node.id);
    if (!parent || !parent.id.startsWith(`${TuiNodeType.PROJECT}:`)) {
      this.statusMessage = "Can only promote project learnings";
      return;
    }

    const portal = parent.id.replace(`${TuiNodeType.PROJECT}:`, "");
    this.state.activeDialog = new PromoteDialog(node.label, portal);
  }

  /**
   * Process dialog result after it closes
   */
  private async processDialogResult(): Promise<void> {
    const dialog = this.state.activeDialog;
    if (!dialog) return;

    this.state.activeDialog = null;

    const context = {
      service: this.service,
      onStatusUpdate: (msg: string) => {
        this.statusMessage = msg;
      },
      onTreeReload: () => this.loadTree(),
      onPendingCountReload: () => this.loadPendingCount(),
    };

    // Handle different dialog types with typed results
    if (dialog instanceof ConfirmApproveDialog) {
      await DialogProcessor.processConfirmApproveDialog(dialog, context);
    } else if (dialog instanceof ConfirmRejectDialog) {
      await DialogProcessor.processConfirmRejectDialog(dialog, context);
    } else if (dialog instanceof BulkApproveDialog) {
      await DialogProcessor.processBulkApproveDialog(dialog, context);
    } else if (dialog instanceof AddLearningDialog) {
      await DialogProcessor.processAddLearningDialog(dialog, context);
    } else if (dialog instanceof PromoteDialog) {
      await DialogProcessor.processPromoteDialog(dialog, context);
    }
  }

  // ===== Detail Content =====

  /**
   * Load detail content for a node
   */
  async loadDetailForNode(node: ITreeNode): Promise<void> {
    switch (node.type) {
      case "scope":
        this.state.detailContent = MemoryFormatter.formatScopeDetail(node);
        break;
      case TuiNodeType.PROJECT:
        this.state.detailContent = await MemoryFormatter.formatProjectDetail(node, this.service);
        break;
      case "execution":
        this.state.detailContent = await MemoryFormatter.formatExecutionDetail(node, this.service);
        break;
      case "learning":
        this.state.detailContent = MemoryFormatter.formatLearningDetail(node, this.state.useColors);
        break;
      default:
        this.state.detailContent = `Selected: ${node.label}`;
    }
  }

  // ===== Search =====

  /**
   * Execute search query
   */
  async executeSearch(): Promise<void> {
    if (!this.state.searchQuery.trim()) {
      await this.loadTree();
      return;
    }

    const results = await this.service.search(this.state.searchQuery);

    // Build search results tree
    const searchNode: ITreeNode = {
      id: "search-results",
      type: TuiNodeType.SCOPE,
      label: `Search: "${this.state.searchQuery}"`,
      expanded: true,
      children: [],
      badge: results.length,
    };

    for (const result of results.slice(0, 20)) {
      const score = result.relevance_score?.toFixed(2) ?? "0.00";
      searchNode.children.push({
        id: `search:${result.id ?? result.trace_id ?? result.title}`,
        type: TuiNodeType.LEARNING,
        label: `${result.title} (${score})`,
        expanded: false,
        children: [],
        data: result,
      });
    }

    this.state.tree = [searchNode];
    this.flattenTree();

    if (this.flatNodes.length > 0) {
      this.state.selectedNodeId = this.flatNodes[0].id;
    }

    this.state.detailContent = [
      `# Search Results`,
      "",
      `Found ${results.length} results for "${this.state.searchQuery}"`,
      "",
      ...results.slice(0, 10).map((r) => {
        const score = r.relevance_score?.toFixed(2) ?? "0.00";
        return `- ${r.title} [${r.type}] (score: ${score})`;
      }),
    ].join("\n");
  }

  // ===== Help =====

  private renderHelpContent(): string {
    return [
      "# Memory View Help",
      "",
      "## Navigation",
      "- ↑/↓: Navigate items",
      "- ←/→: Collapse/Expand",
      "- Enter: Select/Toggle",
      "- Home/End: First/Last item",
      "",
      "## Shortcuts",
      "- g: Jump to Global Memory",
      "- p: Jump to Projects",
      "- e: Jump to Executions",
      "- n: Jump to Pending",
      "- s or /: Search",
      "- R: Refresh data",
      "- ?: Show this help",
      "",
      "## Actions",
      "- a: Approve selected proposal",
      "- r: Reject selected proposal",
      "- A: Approve all pending",
      "- L: Add new learning",
      "- P: Promote to global",
      "",
      "Press any key to close.",
    ].join("\n");
  }

  // ===== Rendering =====

  /**
   * Render the tree panel
   */
  renderTreePanel(): string {
    return TreeBuilder.renderTree(
      this.state.tree,
      this.state.selectedNodeId,
      this.state.isLoading,
      this.state.spinnerFrame,
      this.state.loadingMessage,
    );
  }

  /**
   * Render the status bar
   */
  renderStatusBar(): string {
    if (this.state.isLoading) {
      const spinner = renderSpinner(this.state.spinnerFrame);
      return `${spinner} ${this.state.loadingMessage}`;
    }
    if (this.state.searchActive) {
      return `Search: ${this.state.searchQuery}█`;
    }
    const pending = this.state.pendingCount > 0 ? ` | ${this.state.pendingCount} pending` : "";
    return `[g]lobal [p]rojects [e]xecutions [s]earch [R]efresh [?]help${pending}`;
  }

  /**
   * Render action buttons for current selection
   */
  renderActionButtons(): string {
    const node = this.findNodeById(this.state.selectedNodeId);
    if (!node) return "[L] Add Learning";

    if (node.id.startsWith("pending:")) {
      return "[a] Approve  [r] Reject  [A] Approve All  [Enter] View Details";
    }
    if (node.id === MemoryTuiScope.PENDING) {
      return "[A] Approve All  [Enter] Expand";
    }
    if (node.type === TuiNodeType.PROJECT) {
      return "[L] Add Learning  [Enter] View  [Tab] Switch Panel";
    }
    if (node.type === "learning") {
      const parent = this.findParentNode(node.id);
      if (parent?.id.startsWith(`${TuiNodeType.PROJECT}:`)) {
        return "[P] Promote to Global  [Enter] View Details";
      }
    }
    return "[L] Add Learning  [Enter] Select  [Tab] Switch Panel";
  }

  /**
   * Get focusable elements for accessibility
   */
  getFocusableElements(): string[] {
    return ["tree-panel", "detail-panel", "search-input", TUI_ELEMENT_ACTION_BUTTONS];
  }

  /**
   * Render dialog overlay if active
   */
  renderDialog(width: number, height: number): string | null {
    if (!this.state.activeDialog || !this.state.activeDialog.isActive()) {
      return null;
    }
    return this.state.activeDialog.render({ width, height, useColors: this.useColors }).join("\n");
  }
}

// ===== View =====

/**
 * Memory Bank View
 *
 * Controller for Memory Bank TUI interface.
 */
export class MemoryView {
  private service: IMemoryService;

  constructor(service: IMemoryService) {
    this.service = service;
  }

  /**
   * Create a new TUI session
   */
  createTuiSession(): MemoryViewTuiSession {
    return new MemoryViewTuiSession(this.service);
  }

  getService(): IMemoryService {
    return this.service;
  }
}
