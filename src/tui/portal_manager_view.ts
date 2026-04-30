/**
 * @module PortalManagerView
 * @path src/tui/portal_manager_view.ts
 * @description TUI view for managing portals (environment symlinks), supporting status visualization, opening/closing, and removal.
 * @architectural-layer TUI
 * @related-files ["src/services/portal/portal.ts", src/tui/tui_dashboard.ts]
 */

import type { IPortalDetails, IPortalInfo, IVerificationResult } from "@exaix/core/types/portal.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IPortalService } from "@exaix/core/types";
import { BaseTreeView } from "./base/base_tree_view.ts";
import { ConfirmDialog, type DialogBase } from "./helpers/dialog_base.ts";
import { type IHelpSection, renderHelpScreen } from "./helpers/help_renderer.ts";
import type { IKeyBinding } from "./helpers/keyboard.ts";
import { KeyBindingCategory, KEYS } from "./helpers/keyboard.ts";
import { KeyBindingsBase } from "./base/key_bindings_base.ts";
import {
  createGroupNode,
  createNode,
  flattenTree,
  type ITreeNode,
  type TreeRenderOptions,
} from "./helpers/tree_view.ts";
import { DialogStatus, type PortalAnalysisMode, type PortalExecutionStrategy, PortalStatus } from "@exaix/core";
import { TuiIcon, TuiNodeType } from "@exaix/tui";
import { formatKnowledge } from "@exaix/cli/formatters/portal_knowledge.ts";
import {
  TUI_ELEMENT_ACTION_BUTTONS,
  TUI_KEY_LABEL_ENTER,
  TUI_LABEL_CANCEL,
  TUI_LAYOUT_NARROW_WIDTH,
  TUI_PORTAL_ICONS,
} from "./helpers/constants.ts";

// ===== Portal View Extensions =====

export interface IPortalViewExtensions {
  /** Detail panel content */
  detailContent: string[];
  /** Last refresh timestamp */
  lastRefresh: number;
}

// ===== Portal Actions =====

export enum PortalAction {
  NAVIGATE_UP = "navigate-up",
  NAVIGATE_DOWN = "navigate-down",
  NAVIGATE_HOME = "navigate-home",
  NAVIGATE_END = "navigate-end",
  OPEN = "open",
  REFRESH = "refresh",
  REMOVE = "remove",
  COLLAPSE = "collapse",
  EXPAND = "expand",
  SEARCH = "search",
  CANCEL = "cancel",
  REFRESH_VIEW = "refresh-view",
  HELP = "help",
  EXPAND_ALL = "expand-all",
  COLLAPSE_ALL = "collapse-all",
  ANALYZE = "analyze",
}

// ===== Portal Status Icons =====

const PORTAL_ICONS = {
  active: TUI_PORTAL_ICONS.active,
  broken: TUI_PORTAL_ICONS.broken,
  inactive: TUI_PORTAL_ICONS.inactive,
  folder: TUI_PORTAL_ICONS.folder,
} as const;

// ===== Key Bindings =====

export class PortalKeyBindings extends KeyBindingsBase<PortalAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<PortalAction, KeyBindingCategory>[] = [
    {
      key: KEYS.UP,
      action: PortalAction.NAVIGATE_UP,
      description: "Move up",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.DOWN,
      action: PortalAction.NAVIGATE_DOWN,
      description: "Move down",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.HOME,
      action: PortalAction.NAVIGATE_HOME,
      description: "Go to first",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.END,
      action: PortalAction.NAVIGATE_END,
      description: "Go to last",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.ENTER,
      action: PortalAction.OPEN,
      description: "Open portal / expand",
      category: KeyBindingCategory.ACTIONS,
    },
    { key: "r", action: PortalAction.REFRESH, description: "Refresh portal", category: KeyBindingCategory.ACTIONS },
    { key: KEYS.D, action: PortalAction.REMOVE, description: "Remove portal", category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.LEFT,
      action: PortalAction.COLLAPSE,
      description: "Collapse node",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.RIGHT,
      action: PortalAction.EXPAND,
      description: "Expand node",
      category: KeyBindingCategory.NAVIGATION,
    },
    { key: KEYS.S, action: PortalAction.SEARCH, description: "Search/filter", category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.ESCAPE,
      action: PortalAction.CANCEL,
      description: "Clear filter / close dialog",
      category: KeyBindingCategory.ACTIONS,
    },
    { key: "R", action: PortalAction.REFRESH_VIEW, description: "Refresh view", category: KeyBindingCategory.VIEW },
    { key: KEYS.QUESTION, action: PortalAction.HELP, description: "Toggle help", category: KeyBindingCategory.VIEW },
    { key: KEYS.E, action: PortalAction.EXPAND_ALL, description: "Expand all", category: KeyBindingCategory.VIEW },
    {
      key: KEYS.C,
      action: PortalAction.COLLAPSE_ALL,
      description: "Collapse all",
      category: KeyBindingCategory.VIEW,
    },
  ];
}

export const PORTAL_KEY_BINDINGS = new PortalKeyBindings().KEY_BINDINGS;

// ===== TUI Session =====

export class PortalManagerTuiSession extends BaseTreeView<IPortalInfo> {
  private portals: IPortalInfo[];
  private readonly service: IPortalService;
  private portalExtensions: IPortalViewExtensions;

  constructor(portals: IPortalInfo[], service: IPortalService, useColors = true) {
    super(useColors);
    this.portals = portals;
    this.service = service;
    this.portalExtensions = {
      detailContent: [],
      lastRefresh: 0,
    };
    this.buildTree(portals);
  }

  // ===== Tree Building =====

  protected buildTree(portals: IPortalInfo[]): void {
    const active: ITreeNode<IPortalInfo>[] = [];
    const broken: ITreeNode<IPortalInfo>[] = [];
    const inactive: ITreeNode<IPortalInfo>[] = [];

    for (const portal of portals) {
      const node = createNode<IPortalInfo>(
        portal.alias,
        portal.alias,
        TuiNodeType.PORTAL,
        {
          data: portal,
          icon: portal.status === PortalStatus.ACTIVE ? TuiIcon.PORTAL_ACTIVE : TuiIcon.PORTAL_BROKEN,
          badge: portal.status,
        },
      );

      switch (portal.status) {
        case PortalStatus.ACTIVE:
          active.push(node);
          break;
        case PortalStatus.BROKEN:
          broken.push(node);
          break;
        default:
          inactive.push(node);
      }
    }

    this.state.tree = [];

    if (active.length > 0) {
      this.state.tree.push(
        createGroupNode("active-group", `Active (${active.length})`, TuiNodeType.GROUP, active, {
          icon: PORTAL_ICONS.active,
          badge: active.length,
          expanded: true,
        }),
      );
    }

    if (broken.length > 0) {
      this.state.tree.push(
        createGroupNode("broken-group", `Broken (${broken.length})`, TuiNodeType.GROUP, broken, {
          icon: PORTAL_ICONS.broken,
          badge: broken.length,
          expanded: true,
        }),
      );
    }

    if (inactive.length > 0) {
      this.state.tree.push(
        createGroupNode("inactive-group", `Inactive (${inactive.length})`, TuiNodeType.GROUP, inactive, {
          icon: PORTAL_ICONS.inactive,
          badge: inactive.length,
          expanded: true,
        }),
      );
    }

    // Select first portal if none selected
    if (!this.state.selectedId && portals.length > 0) {
      const flat = flattenTree(this.state.tree);
      const firstPortal = flat.find((f) => f.node.type === TuiNodeType.PORTAL);
      if (firstPortal) {
        this.state.selectedId = firstPortal.node.id;
      } else if (flat.length > 0) {
        this.state.selectedId = flat[0].node.id;
      }
    }
    this.syncSelectedIndex();
  }

  // ===== Backwards Compatibility =====

  // ===== Selection & Sync =====

  override setSelectedIndex(idx: number, _maxLength?: number): void {
    // Sync tree selection with index in portals array
    if (idx >= 0 && idx < this.portals.length) {
      this.state.selectedId = this.portals[idx].alias;
      this.syncSelectedIndex(); // Sync this.selectedIndex to tree index
    } else {
      this.state.selectedId = ""; // Clear selection for invalid index
      this.selectedIndex = -1;
    }
  }

  /**
   * Sync selectedIndex based on current selectedId in the tree
   */
  protected override syncSelectedIndex(): void {
    super.syncSelectedIndex();
  }

  override getSelectedIndex(): number {
    if (!this.state.selectedId) return 0;
    const node = this.getSelectedNode();
    if (node?.type === TuiNodeType.PORTAL && node.data) {
      const idx = this.portals.findIndex((p) => p.alias === (node.data as IPortalInfo).alias);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }

  // ===== Dialog Result Handling =====

  protected override onDialogClosed(dialog: DialogBase): void {
    const result = dialog.getResult();
    if (result.type === DialogStatus.CANCELLED || result.value !== true) return;

    if (dialog instanceof ConfirmDialog) {
      this.executeRemove();
    }
  }

  // ===== Key Handling =====

  override async handleKey(key: string): Promise<boolean> {
    // If dialog is active, handle it first (might involve onDialogClosed which is async)
    if (this.state.activeDialog) {
      return await this.handleDialogKeys(key);
    }

    if (this.handleHelpKeys(key)) return true;
    if (this.handleBaseKeysAndSync(key)) return true;
    return await this.handleActionKeys(key);
  }

  private handleBaseKeysAndSync(key: string): boolean {
    if (this.handleNavigationKeys(key)) return true;

    // If filter was cleared (handled by base), rebuild tree
    if (this.state.filterText === "" && key === "escape") {
      this.updatePortals(this.portals);
      return true;
    }
    return false;
  }

  private async handleActionKeys(key: string): Promise<boolean> {
    switch (key) {
      case KEYS.ENTER:
        await this.handleEnterKey();
        return true;
      case KEYS.R:
        if (this.handleActionGuard()) return true;
        await this.executeRefresh();
        return true;
      case KEYS.D:
        if (this.handleActionGuard()) return true;
        this.showRemoveConfirmDialog();
        return true;
      case KEYS.CAP_R:
        await this.refreshView();
        return true;
      case KEYS.QUESTION:
        this.state.showHelp = true;
        return true;
      case KEYS.E:
        this.expandAllNodes();
        return true;
      case KEYS.C:
        this.collapseAllNodes();
        return true;
      case KEYS.S:
        // In a real TUI, this would open a search input
        return true;
      case KEYS.A:
        if (this.handleActionGuard()) return true;
        await this.executeAnalyzeKnowledge();
        return true;
      default:
        return false;
    }
  }

  private handleActionGuard(): boolean {
    const selected = this.getSelectedNode();
    if (selected?.type === TuiNodeType.PORTAL) return false;
    this.statusMessage = "Error: No portal selected";
    return true;
  }

  private async handleEnterKey(): Promise<void> {
    const selected = this.getSelectedNode();
    if (!selected) {
      this.statusMessage = "Error: No portal selected";
      return;
    }
    if (selected.type === TuiNodeType.GROUP) {
      this.toggleCurrentNode();
      return;
    }
    await this.executeOpen();
  }

  // ===== Actions =====

  private async executeOpen(): Promise<void> {
    const selected = this.getSelectedNode();
    if (selected?.type !== TuiNodeType.PORTAL || !selected.data) return;
    const portal = selected.data;

    await this.executeWithLoading(
      `Opening ${portal.alias}...`,
      () => this.service.openPortal(portal.alias),
      () => `Opened ${portal.alias}`,
    );
  }

  private async executeRefresh(): Promise<void> {
    const selected = this.getSelectedNode();
    if (selected?.type !== TuiNodeType.PORTAL || !selected.data) return;
    const portal = selected.data;

    await this.executeWithLoading(
      `Refreshing ${portal.alias}...`,
      () => this.service.refreshPortal(portal.alias),
      () => `Refreshed ${portal.alias}`,
    );
  }

  private showRemoveConfirmDialog(): void {
    const selected = this.getSelectedNode();
    if (selected?.type !== TuiNodeType.PORTAL || !selected.data) return;
    const portal = selected.data;

    this.showConfirmDialog({
      title: "Remove Portal",
      message:
        `Are you sure you want to remove "${portal.alias}"?\nThis will delete the symlink but keep the context card.`,
      confirmText: "Remove",
      cancelText: TUI_LABEL_CANCEL,
      destructive: true,
    });
  }

  private async executeRemove(): Promise<void> {
    const selected = this.getSelectedNode();
    if (selected?.type !== TuiNodeType.PORTAL || !selected.data) return;
    const portal = selected.data;

    await this.executeWithLoading(
      `Removing ${portal.alias}...`,
      async () => {
        await this.service.removePortal(portal.alias);
        await this.refreshView();
      },
      () => `Removed ${portal.alias}`,
    );
  }

  private async executeAnalyzeKnowledge(): Promise<void> {
    const selected = this.getSelectedNode();
    if (selected?.type !== TuiNodeType.PORTAL || !selected.data) return;
    const portal = selected.data;

    await this.executeWithLoading(
      `Loading knowledge for ${portal.alias}...`,
      async () => {
        const knowledge = await this.service.getKnowledge(portal.alias);
        this.portalExtensions.detailContent = renderKnowledgeSection(knowledge);
      },
      () => `Knowledge loaded for ${portal.alias}`,
    );
  }

  private async refreshView(): Promise<void> {
    await this.executeWithLoading(
      "Refreshing portals...",
      async () => {
        const newPortals = await this.service.listPortals();
        this.updatePortals(newPortals);
        this.portalExtensions.lastRefresh = Date.now();
      },
      () => "Refreshed",
    );
  }

  // ===== State Accessors =====

  getSelectedPortal(): ITreeNode<IPortalInfo> | null {
    return this.getSelectedNode();
  }

  updatePortals(newPortals: IPortalInfo[]): void {
    this.portals = newPortals;
    this.buildTree(newPortals);

    if (!this.state.selectedId && newPortals.length > 0) {
      this.state.selectedId = newPortals[0].alias;
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= newPortals.length) {
      this.selectedIndex = Math.max(0, newPortals.length - 1);
      if (newPortals.length > 0) {
        this.state.selectedId = newPortals[this.selectedIndex].alias;
      } else {
        this.state.selectedId = null;
      }
    }
  }

  getSelectedPortalDetails(): IPortalInfo | undefined {
    const selected = this.getSelectedNode();
    return selected?.type === TuiNodeType.PORTAL ? selected.data : undefined;
  }

  getPortalTree(): ITreeNode<IPortalInfo>[] {
    return this.state.tree;
  }

  // ===== Rendering =====

  renderActionButtons(): string {
    if (!this.portals.length) return "";
    return `[Enter] Open   [r] Refresh   [d] Remove   [?] Help`;
  }

  renderPortalTree(options: Partial<TreeRenderOptions> = {}): string[] {
    return this.renderTreeView({
      selectedId: this.state.selectedId || undefined,
      ...options,
    });
  }

  renderHelp(): string[] {
    const sections: IHelpSection[] = [
      {
        title: "Navigation",
        items: [
          { key: "↑/↓", description: "Move selection" },
          { key: "Home/End", description: "Jump to first/last" },
          { key: "←/→", description: "Collapse/Expand" },
          { key: "e/c", description: "Expand/Collapse all" },
        ],
      },
      {
        title: "Actions",
        items: [
          { key: TUI_KEY_LABEL_ENTER, description: "Open portal" },
          { key: "r", description: "Refresh portal" },
          { key: "d", description: "Remove portal" },
          { key: "R", description: "Refresh view" },
        ],
      },
      {
        title: "View",
        items: [
          { key: "s", description: "Search portals" },
          { key: "?", description: "Toggle help" },
          { key: "Esc", description: "Close/Cancel" },
        ],
      },
    ];

    return renderHelpScreen({
      title: "Portal Manager Help",
      sections,
      useColors: this.state.useColors,
      width: TUI_LAYOUT_NARROW_WIDTH,
    });
  }

  getFocusableElements(): string[] {
    return ["portal-list", TUI_ELEMENT_ACTION_BUTTONS, "status-bar"];
  }

  override getKeyBindings(): IKeyBinding<PortalAction, KeyBindingCategory>[] {
    return PORTAL_KEY_BINDINGS as IKeyBinding<PortalAction, KeyBindingCategory>[];
  }

  override getViewName(): string {
    return "Portal Manager";
  }
}

// ===== Knowledge Rendering =====

/**
 * Render an IPortalKnowledge record into display lines for the TUI detail pane.
 * Returns a "no analysis" message when knowledge is null.
 */
export function renderKnowledgeSection(knowledge: IPortalKnowledge | null): string[] {
  if (!knowledge) {
    return ["No analysis available — run `exactl portal analyze`"];
  }
  return formatKnowledge(knowledge);
}

// ===== View Controller =====

export class PortalManagerView implements IPortalService {
  constructor(public readonly service: IPortalService) {}

  add(
    targetPath: string,
    alias: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    return this.service.add(targetPath, alias, options);
  }

  list(): Promise<IPortalInfo[]> {
    return this.service.list();
  }

  show(alias: string): Promise<IPortalDetails> {
    return this.service.show(alias);
  }

  remove(alias: string, options?: { keepCard?: boolean }): Promise<void> {
    return this.service.remove(alias, options);
  }

  verify(alias?: string): Promise<IVerificationResult[]> {
    return this.service.verify(alias);
  }

  refresh(alias: string): Promise<void> {
    return this.service.refresh(alias);
  }

  analyze(
    alias: string,
    options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string> {
    return this.service.analyze(alias, options);
  }

  createTuiSession(portals: IPortalInfo[], useColors = true): PortalManagerTuiSession {
    return new PortalManagerTuiSession(portals, this.service, useColors);
  }

  listPortals(): Promise<IPortalInfo[]> {
    return this.service.listPortals();
  }

  getPortalDetails(alias: string): Promise<IPortalDetails> {
    return this.service.getPortalDetails(alias);
  }

  openPortal(alias: string): Promise<boolean> {
    return this.service.openPortal(alias);
  }

  closePortal(alias: string): Promise<boolean> {
    return this.service.closePortal(alias);
  }

  refreshPortal(alias: string): Promise<boolean> {
    return this.service.refreshPortal(alias);
  }

  removePortal(alias: string, options?: { keepCard?: boolean }): Promise<boolean> {
    return this.service.removePortal(alias, options);
  }

  quickJumpToPortalDir(alias: string): Promise<string> {
    return this.service.quickJumpToPortalDir(alias);
  }

  getPortalFilesystemPath(alias: string): Promise<string> {
    return this.service.getPortalFilesystemPath(alias);
  }

  getPortalActivityLog(alias: string): string[] {
    return this.service.getPortalActivityLog(alias);
  }

  getKnowledge(portalAlias: string): Promise<IPortalKnowledge | null> {
    return this.service.getKnowledge(portalAlias);
  }

  renderPortalList(portals: IPortalInfo[]): string {
    return portals.map((p) => {
      let line = `${p.alias} [${p.status}] (${p.targetPath})`;
      if (p.status && p.status !== PortalStatus.ACTIVE) {
        line += `  ⚠️ ERROR: ${p.status}`;
      }
      return line;
    }).join("\n");
  }
}
