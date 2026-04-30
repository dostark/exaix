/**
 * @module SkillsManagerView
 * @path src/tui/skills_manager_view.ts
 * @description Interactive TUI view for managing Skills (agent capabilities), supporting discovery, status filtering, and skill deletion.
 * @architectural-layer TUI
 * @related-files ["src/services/skills/skills.ts", src/tui/tui_dashboard.ts]
 */

import { DialogStatus, MemoryBankSource, MemoryScope, MessageType, SkillStatus } from "@exaix/core";
import { GroupingField, SkillGroupingMode, TuiNodeType } from "@exaix/tui";
import type { ISkillsService } from "@exaix/core/types";
import { BaseTreeView } from "./base/base_tree_view.ts";
import type { DialogBase } from "./helpers/dialog_base.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "./helpers/keyboard.ts";
import { KeyBindingsBase } from "./base/key_bindings_base.ts";
import { createGroupNode, createNode, getFirstNodeId, type ITreeNode } from "./helpers/tree_view.ts";
import { type IHelpSection, renderHelpScreen } from "./helpers/help_renderer.ts";
import {
  TUI_ACTION_SEARCH,
  TUI_KEY_LABEL_ENTER,
  TUI_LABEL_CANCEL,
  TUI_LAYOUT_DIALOG_WIDTH,
  TUI_LAYOUT_MEDIUM_WIDTH,
  TUI_LIMIT_MEDIUM,
  TUI_SKILL_ICON,
  TUI_SOURCE_ICONS,
  TUI_STATUS_ICONS,
} from "./helpers/constants.ts";
import type { ISkill, ISkillMatch, SkillDefinition } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest } from "@exaix/core/types/skill.ts";

// ===== Interfaces =====

/**
 * Service interface for skills operations
 */
export type ISkillsViewService = ISkillsService;
export type ISkillSummary = ISkill;

export interface ISkillsViewExtensions {
  /** Whether detail view is shown */
  showDetail: boolean;
  /** Detail content for expanded skill */
  detailContent: string;
  /** Filter by memory source */
  filterSource: "all" | MemoryBankSource;
  /** Filter by skill status */
  filterStatus: "all" | SkillStatus;
  /** Current grouping mode */
  groupBy: SkillGroupingMode;
}

// ===== Icons and Visual Constants =====

export const SOURCE_ICONS: Record<string, string> = {
  core: TUI_SOURCE_ICONS.core,
  project: TUI_SOURCE_ICONS.project,
  learned: TUI_SOURCE_ICONS.learned,
};

export const STATUS_ICONS: Record<string, string> = {
  active: TUI_STATUS_ICONS.active,
  draft: TUI_STATUS_ICONS.draft,
  deprecated: TUI_STATUS_ICONS.deprecated,
};

export const SKILL_ICON = TUI_SKILL_ICON;

// ===== Portal Actions =====

export enum SkillsAction {
  NAVIGATE_UP = "navigate-up",
  NAVIGATE_DOWN = "navigate-down",
  NAVIGATE_HOME = "navigate-home",
  NAVIGATE_END = "navigate-end",
  COLLAPSE = "collapse",
  EXPAND = "expand",
  VIEW_DETAIL = "view-detail",
  DELETE = "delete",
  SEARCH = "search",
  FILTER_SOURCE = "filter-source",
  FILTER_STATUS = "filter-status",
  TOGGLE_GROUPING = "toggle-grouping",
  REFRESH = "refresh",
  COLLAPSE_ALL = "collapse-all",
  EXPAND_ALL = "expand-all",
  HELP = "help",
  BACK = "back",
  CLOSE = "close",
}
export class SkillsKeyBindings extends KeyBindingsBase<SkillsAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<SkillsAction, KeyBindingCategory>[] = [
    {
      key: KEYS.UP,
      description: "Navigate up",
      action: SkillsAction.NAVIGATE_UP,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.DOWN,
      description: "Navigate down",
      action: SkillsAction.NAVIGATE_DOWN,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.HOME,
      description: "Jump to first",
      action: SkillsAction.NAVIGATE_HOME,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.END,
      description: "Jump to last",
      action: SkillsAction.NAVIGATE_END,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.LEFT,
      description: "Collapse group",
      action: SkillsAction.COLLAPSE,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.RIGHT,
      description: "Expand group",
      action: SkillsAction.EXPAND,
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.ENTER,
      description: "View skill details",
      action: SkillsAction.VIEW_DETAIL,
      category: KeyBindingCategory.NAVIGATION,
    },
    { key: KEYS.D, description: "Delete skill", action: SkillsAction.DELETE, category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.SLASH,
      description: "Search skills",
      action: SkillsAction.SEARCH,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.F,
      description: "Filter by source",
      action: SkillsAction.FILTER_SOURCE,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.S,
      description: "Filter by status",
      action: SkillsAction.FILTER_STATUS,
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.G,
      description: "Toggle grouping",
      action: SkillsAction.TOGGLE_GROUPING,
      category: KeyBindingCategory.VIEW,
    },
    { key: KEYS.R, description: "Force refresh", action: SkillsAction.REFRESH, category: KeyBindingCategory.VIEW },
    { key: KEYS.C, description: "Collapse all", action: SkillsAction.COLLAPSE_ALL, category: KeyBindingCategory.VIEW },
    { key: KEYS.E, description: "Expand all", action: SkillsAction.EXPAND_ALL, category: KeyBindingCategory.VIEW },
    { key: KEYS.QUESTION, description: "Show help", action: SkillsAction.HELP, category: KeyBindingCategory.HELP },
    { key: KEYS.Q, description: "Back", action: SkillsAction.BACK, category: KeyBindingCategory.HELP },
    { key: KEYS.ESCAPE, description: "Close", action: SkillsAction.CLOSE, category: KeyBindingCategory.HELP },
  ];
}

export const SKILLS_KEY_BINDINGS = new SkillsKeyBindings().KEY_BINDINGS;

// ===== Help Sections =====

const SKILLS_HELP_SECTIONS: IHelpSection[] = [
  {
    title: "Navigation",
    items: [
      { key: "↑/↓ or j/k", description: "Move up/down" },
      { key: "Home/End", description: "Jump to first/last" },
      { key: "← / →", description: "Collapse/Expand group" },
      { key: TUI_KEY_LABEL_ENTER, description: "View skill details" },
    ],
  },
  {
    title: "Actions",
    items: [
      { key: "d", description: "Delete selected skill" },
      { key: "/", description: "Search skills" },
      { key: "f", description: "Filter by source" },
      { key: "s", description: "Filter by status" },
      { key: "g", description: "Cycle grouping mode" },
      { key: "R", description: "Force refresh" },
    ],
  },
  {
    title: "View Controls",
    items: [
      { key: "c", description: "Collapse all groups" },
      { key: "E", description: "Expand all groups" },
      { key: "?", description: "Toggle this help" },
      { key: "q / Esc", description: "Close detail/help/dialog" },
    ],
  },
];

// ===== Skills Manager View Class =====

/**
 * View/controller for skills management
 */
export class SkillsManagerView {
  private selectedSkillId: string | null = null;
  private skills: ISkillSummary[] = [];

  constructor(private readonly skillsService: ISkillsViewService) {}

  async getSkillsList(filter?: { source?: MemoryBankSource; status?: SkillStatus }): Promise<ISkillSummary[]> {
    this.skills = await this.skillsService.listSkills(filter);
    return this.skills;
  }

  getCachedSkills(): ISkillSummary[] {
    return [...this.skills];
  }

  async getSkillDetail(skillId: string): Promise<ISkillSummary | null> {
    return await this.skillsService.getSkill(skillId);
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    return await this.skillsService.deleteSkill(skillId);
  }

  selectSkill(skillId: string): void {
    this.selectedSkillId = skillId;
  }

  getSelectedSkill(): string | null {
    return this.selectedSkillId;
  }

  createTuiSession(useColors = true): SkillsManagerTuiSession {
    return new SkillsManagerTuiSession(this, useColors);
  }
}

// ===== Minimal Mock for Tests =====

export class MinimalSkillsServiceMock implements ISkillsService {
  private skills: ISkill[] = [];

  constructor(skills: ISkill[] = []) {
    this.skills = skills;
  }

  listSkills(filter?: { source?: MemoryBankSource; status?: SkillStatus }): Promise<ISkill[]> {
    let result = [...this.skills];
    if (filter?.source) {
      result = result.filter((s) => s.source === filter.source);
    }
    if (filter?.status) {
      result = result.filter((s) => s.status === filter.status);
    }
    return Promise.resolve(result);
  }

  getSkill(skillId: string): Promise<ISkill | null> {
    return Promise.resolve(this.skills.find((s) => s.id === skillId) || null);
  }

  deleteSkill(skillId: string): Promise<boolean> {
    const idx = this.skills.findIndex((s) => s.id === skillId);
    if (idx >= 0) {
      this.skills.splice(idx, 1);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  setSkills(skills: ISkill[]): void {
    this.skills = skills;
  }

  matchSkills(_request: ISkillMatchRequest): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    return Promise.resolve({ matches: [], totalAvailable: 0 });
  }

  buildSkillContext(_skillIds: string[]): Promise<string> {
    return Promise.resolve("");
  }

  recordSkillUsage(_skillId: string): Promise<void> {
    return Promise.resolve();
  }

  deriveSkillFromLearnings(
    _learningIds: string[],
    _skillDef: SkillDefinition,
  ): Promise<ISkill> {
    return Promise.resolve({
      id: "new-skill-id",
      skill_id: "new-skill-id",
      name: "Derived Skill",
      description: "Successfully derived skill",
      created_at: new Date().toISOString(),
      usage_count: 0,
      status: SkillStatus.ACTIVE,
      version: "1.0.0",
      source: MemoryBankSource.LEARNED,
      scope: MemoryScope.GLOBAL,
      triggers: { keywords: [] },
      instructions: "Do things.",
    } as ISkill);
  }

  rebuildIndex(): Promise<void> {
    return Promise.resolve();
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  createSkill(skillDef: SkillDefinition): Promise<ISkill> {
    const newSkill: ISkill = {
      ...skillDef,
      id: `skill-${Date.now()}`,
      skill_id: `skill-${Date.now()}`,
      created_at: new Date().toISOString(),
      usage_count: 0,
    };
    this.skills.push(newSkill);
    return Promise.resolve(newSkill);
  }
}

// ===== TUI Session Class =====

/**
 * Interactive TUI session for Skills Manager View
 */
export class SkillsManagerTuiSession extends BaseTreeView<ISkillSummary> {
  private readonly skillsView: SkillsManagerView;
  private skillsViewExtensions: ISkillsViewExtensions;
  private skills: ISkillSummary[] = [];
  private pendingDeleteSkillId: string | null = null;
  private pendingDialogType: "search" | "filter-source" | "filter-status" | "delete" | null = null;

  constructor(skillsView: SkillsManagerView, useColors = true) {
    super(useColors);
    this.skillsView = skillsView;
    this.skillsViewExtensions = {
      showDetail: false,
      detailContent: "",
      filterSource: "all",
      filterStatus: "all",
      groupBy: SkillGroupingMode.SOURCE,
    };
  }

  // ===== Initialization =====

  async initialize(): Promise<void> {
    this.setLoading(true, "Loading skills...");
    try {
      await this.loadSkills();
      this.buildTree();

      // Select first skill if available
      const firstId = getFirstNodeId(this.state.tree);
      if (firstId && !this.isGroupNode(firstId)) {
        this.state.selectedId = firstId;
      }
    } finally {
      this.setLoading(false);
    }
  }

  private async loadSkills(): Promise<void> {
    const filter: { source?: MemoryBankSource; status?: SkillStatus } = {};
    if (this.skillsViewExtensions.filterSource !== "all") {
      filter.source = this.skillsViewExtensions.filterSource as MemoryBankSource;
    }
    if (this.skillsViewExtensions.filterStatus !== "all") {
      filter.status = this.skillsViewExtensions.filterStatus as SkillStatus;
    }
    this.skills = await this.skillsView.getSkillsList(filter);
  }

  // ===== Tree Building =====

  protected override buildTree(): void {
    let filteredSkills = [...this.skills];

    // Apply search filter
    if (this.state.filterText) {
      const query = this.state.filterText.toLowerCase();
      filteredSkills = filteredSkills.filter(
        (s) =>
          s.id.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query) ||
          s.triggers?.keywords?.some((k) => k.toLowerCase().includes(query)),
      );
    }

    // Build tree based on grouping
    if (this.skillsViewExtensions.groupBy === SkillGroupingMode.NONE) {
      this.state.tree = filteredSkills.map((s) => this.createSkillNode(s));
    } else if (this.skillsViewExtensions.groupBy === SkillGroupingMode.SOURCE) {
      this.state.tree = this.buildGroupedTree(filteredSkills, GroupingField.SOURCE);
    } else {
      this.state.tree = this.buildGroupedTree(filteredSkills, GroupingField.STATUS);
    }
  }

  private buildGroupedTree(skills: ISkillSummary[], groupBy: GroupingField): ITreeNode<ISkillSummary>[] {
    const groups = new Map<string, ISkillSummary[]>();

    for (const skill of skills) {
      const key = groupBy === GroupingField.SOURCE ? skill.source : skill.status;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(skill);
    }

    const tree: ITreeNode<ISkillSummary>[] = [];
    const order = groupBy === GroupingField.SOURCE
      ? [MemoryBankSource.CORE, MemoryBankSource.PROJECT, MemoryBankSource.LEARNED]
      : [SkillStatus.ACTIVE, SkillStatus.DRAFT, SkillStatus.DEPRECATED];

    for (const key of order) {
      const groupSkills = groups.get(key);
      if (groupSkills && groupSkills.length > 0) {
        const icon = groupBy === GroupingField.SOURCE ? SOURCE_ICONS[key] : STATUS_ICONS[key];
        const label = `${icon} ${key.charAt(0).toUpperCase() + key.slice(1)} Skills (${groupSkills.length})`;
        tree.push(
          createGroupNode<ISkillSummary>(
            `group-${key}`,
            label,
            TuiNodeType.GROUP,
            groupSkills.map((s) => this.createSkillNode(s)),
            { expanded: true },
          ),
        );
      }
    }

    return tree;
  }

  private createSkillNode(skill: ISkillSummary): ITreeNode<ISkillSummary> {
    const statusIcon = STATUS_ICONS[skill.status] || "⚪";
    return createNode<ISkillSummary>(`skill-${skill.id}`, `${SKILL_ICON} ${skill.name} ${statusIcon}`, "skill", {
      data: skill,
    });
  }

  private isGroupNode(nodeId: string): boolean {
    return nodeId.startsWith("group-");
  }

  private getSkillIdFromNodeId(nodeId: string): string | null {
    if (nodeId.startsWith("skill-")) {
      return nodeId.substring(6);
    }
    return null;
  }

  async showDetail(): Promise<void> {
    if (!this.state.selectedId || this.isGroupNode(this.state.selectedId)) {
      return;
    }

    const skillId = this.getSkillIdFromNodeId(this.state.selectedId);
    if (!skillId) return;

    this.setLoading(true, "Loading skill details...");
    try {
      const skill = await this.skillsView.getSkillDetail(skillId);
      if (skill) {
        this.skillsViewExtensions.detailContent = this.formatDetailContent(skill);
        this.skillsViewExtensions.showDetail = true;
      }
    } finally {
      this.setLoading(false);
    }
  }

  private formatDetailContent(skill: ISkillSummary): string {
    const lines: string[] = [];
    lines.push(`Skill: ${skill.name}`);
    lines.push(`ID: ${skill.id}`);
    lines.push(`Version: ${skill.version}`);
    lines.push(`Status: ${STATUS_ICONS[skill.status]} ${skill.status.toUpperCase()}`);
    lines.push(`Source: ${SOURCE_ICONS[skill.source]} ${skill.source}`);

    if (skill.description) {
      lines.push("");
      lines.push("Description:");
      lines.push(`  ${skill.description}`);
    }

    if (skill.triggers) {
      lines.push("");
      lines.push("Triggers:");
      if (skill.triggers.keywords?.length) {
        lines.push(`  Keywords: ${skill.triggers.keywords.join(", ")}`);
      }
      if (skill.triggers.task_types?.length) {
        lines.push(`  Task Types: ${skill.triggers.task_types.join(", ")}`);
      }
      if (skill.triggers.file_patterns?.length) {
        lines.push(`  File Patterns: ${skill.triggers.file_patterns.join(", ")}`);
      }
    }

    if (skill.instructions) {
      lines.push("");
      lines.push("Instructions:");
      const instrLines = skill.instructions.split("\n").slice(0, TUI_LIMIT_MEDIUM);
      for (const line of instrLines) {
        lines.push(`  ${line}`);
      }
      if (skill.instructions.split("\n").length > TUI_LIMIT_MEDIUM) {
        lines.push("  ...(truncated)");
      }
    }

    return lines.join("\n");
  }

  hideDetail(): void {
    this.skillsViewExtensions.showDetail = false;
    this.skillsViewExtensions.detailContent = "";
  }

  // ===== Dialogs =====

  showSearchDialog(): void {
    this.showInputDialog({
      title: "Search Skills",
      label: "Enter search term:",
      placeholder: "name, ID, or keyword...",
      defaultValue: this.state.filterText,
    });
    this.pendingDialogType = TUI_ACTION_SEARCH;
  }

  showFilterSourceDialog(): void {
    this.showInputDialog({
      title: "Filter by Source",
      label: "Source (all, core, project, learned):",
      placeholder: "source...",
      defaultValue: this.skillsViewExtensions.filterSource,
    });
    this.pendingDialogType = "filter-source";
  }

  showFilterStatusDialog(): void {
    this.showInputDialog({
      title: "Filter by Status",
      label: "Status (all, active, draft, deprecated):",
      placeholder: "status...",
      defaultValue: this.skillsViewExtensions.filterStatus,
    });
    this.pendingDialogType = "filter-status";
  }

  showDeleteConfirm(): void {
    if (!this.state.selectedId || this.isGroupNode(this.state.selectedId)) {
      return;
    }

    const skillId = this.getSkillIdFromNodeId(this.state.selectedId);
    if (!skillId) return;

    const skill = this.skills.find((s) => s.id === skillId);
    if (!skill) return;

    // Don't allow deleting core skills
    if (skill.source === "core") {
      this.setStatus("Cannot delete core skills", MessageType.ERROR);
      return;
    }

    this.showConfirmDialog({
      title: "Delete Skill",
      message: `Are you sure you want to delete skill "${skill.name}"?`,
      confirmText: "Delete",
      cancelText: TUI_LABEL_CANCEL,
    });
    this.pendingDeleteSkillId = skillId;
    this.pendingDialogType = "delete";
  }

  // ===== Dialog Handlers =====

  protected override onDialogClosed(dialog: DialogBase): void {
    const result = dialog.getResult();
    if (result.type !== DialogStatus.CONFIRMED) {
      this.pendingDialogType = null;
      this.pendingDeleteSkillId = null;
      return;
    }

    const value = result.value as string;
    switch (this.pendingDialogType) {
      case TUI_ACTION_SEARCH:
        this.handleSearchResult(value);
        break;
      case "filter-source":
        this.handleFilterSourceResult(value);
        break;
      case "filter-status":
        this.handleFilterStatusResult(value);
        break;
      case "delete":
        this.handleDeleteConfirm();
        break;
    }
    this.pendingDialogType = null;
  }

  // ===== Dialog Handlers =====

  private handleSearchResult(value: string): void {
    this.state.filterText = value;
    this.buildTree();
    this.setStatus(value ? `Search: "${value}"` : "Search cleared", MessageType.INFO);
  }

  private handleFilterSourceResult(value: string): void {
    const normalized = value.toLowerCase().trim();
    if (normalized === "all" || normalized === "core" || normalized === "project" || normalized === "learned") {
      this.skillsViewExtensions.filterSource = normalized as ISkillsViewExtensions["filterSource"];
      this.loadSkills().then(() => {
        this.buildTree();
        this.setStatus(`Filter: source=${normalized}`, MessageType.INFO);
      });
    } else {
      this.setStatus("Invalid source. Use: all, core, project, learned", MessageType.ERROR);
    }
  }

  private handleFilterStatusResult(value: string): void {
    const normalized = value.toLowerCase().trim();
    if (
      normalized === "all" || normalized === SkillStatus.ACTIVE || normalized === SkillStatus.DRAFT ||
      normalized === SkillStatus.DEPRECATED
    ) {
      this.skillsViewExtensions.filterStatus = normalized as ISkillsViewExtensions["filterStatus"];
      this.loadSkills().then(() => {
        this.buildTree();
        this.setStatus(`Filter: status=${normalized}`, MessageType.INFO);
      });
    } else {
      this.setStatus("Invalid status. Use: all, active, draft, deprecated", MessageType.ERROR);
    }
  }

  private async handleDeleteConfirm(): Promise<void> {
    if (!this.pendingDeleteSkillId) return;

    try {
      this.setLoading(true, "Deleting skill...");
      const success = await this.skillsView.deleteSkill(this.pendingDeleteSkillId);
      if (success) {
        await this.loadSkills();
        this.buildTree();
        this.setStatus(`Deleted skill: ${this.pendingDeleteSkillId}`, MessageType.SUCCESS);
      } else {
        this.setStatus("Failed to delete skill", MessageType.ERROR);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Delete failed: ${msg}`, MessageType.ERROR);
    } finally {
      this.setLoading(false);
      this.pendingDeleteSkillId = null;
    }
  }

  // ===== Grouping =====

  cycleGrouping(): void {
    const modes = [SkillGroupingMode.SOURCE, SkillGroupingMode.STATUS, SkillGroupingMode.NONE];
    const currentIdx = modes.indexOf(this.skillsViewExtensions.groupBy);
    this.skillsViewExtensions.groupBy = modes[(currentIdx + 1) % modes.length];
    this.buildTree();
    this.setStatus(`Grouping: ${this.skillsViewExtensions.groupBy}`, MessageType.INFO);
  }

  // ===== Refresh =====

  override async refresh(): Promise<void> {
    this.setLoading(true, "Refreshing...");
    try {
      await this.loadSkills();
      this.buildTree();
      this.setStatus("Refreshed", MessageType.SUCCESS);
    } finally {
      this.setLoading(false);
    }
  }

  // ===== Base Implementation =====

  override getKeyBindings(): IKeyBinding<string>[] {
    return SKILLS_KEY_BINDINGS.map((b) => ({ ...b, action: b.action as string }));
  }

  override getViewName(): string {
    return "Skills Manager";
  }

  // ===== Rendering =====

  render(): string {
    const lines: string[] = [];

    // Header
    lines.push("╔══════════════════════════════════════════════════════════════╗");
    lines.push("║                    🎯 SKILLS MANAGER                         ║");
    lines.push("╠══════════════════════════════════════════════════════════════╣");

    // Filter info
    const filterInfo = [];
    if (this.skillsViewExtensions.filterSource !== "all") {
      filterInfo.push(`source=${this.skillsViewExtensions.filterSource}`);
    }
    if (this.skillsViewExtensions.filterStatus !== "all") {
      filterInfo.push(`status=${this.skillsViewExtensions.filterStatus}`);
    }
    if (this.state.filterText) filterInfo.push(`search="${this.state.filterText}"`);
    if (filterInfo.length > 0) {
      lines.push(`║ Filters: ${filterInfo.join(", ").padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 10)}║`);
      lines.push("╠══════════════════════════════════════════════════════════════╣");
    }

    // Tree view
    if (this.state.tree.length === 0) {
      lines.push("║                                                              ║");
      lines.push("║   No skills found.                                           ║");
      lines.push("║                                                              ║");
    } else {
      const treeLines = this.renderTreeView({
        indentSize: 2,
      });
      for (const line of treeLines.slice(0, 15)) {
        lines.push(`║ ${line.padEnd(TUI_LAYOUT_MEDIUM_WIDTH)}║`);
      }
    }

    lines.push("╠══════════════════════════════════════════════════════════════╣");

    // Status bar
    const statusText = this.renderStatusBar();
    lines.push(`║ ${statusText.padEnd(TUI_LAYOUT_MEDIUM_WIDTH)}║`);

    // Key hints
    lines.push("║ ↑↓:nav  Enter:detail  /:search  f:source  s:status  ?:help   ║");
    lines.push("╚══════════════════════════════════════════════════════════════╝");

    return lines.join("\n");
  }

  renderHelp(): string[] {
    return renderHelpScreen({
      title: "Skills Manager Help",
      sections: SKILLS_HELP_SECTIONS,
    });
  }

  renderDetail(): string {
    return this.skillsViewExtensions.detailContent;
  }

  // ===== Input Handling =====

  public override async handleKey(key: string): Promise<boolean> {
    // 1. Handle dialogs (delegated to base)
    if (await this.handleDialogKeys(key)) return true;

    // 2. Handle detail view
    if (this.skillsViewExtensions.showDetail) {
      return this.handleDetailKeysSync(key);
    }

    // 3. Handle help screen (delegated to base)
    if (this.handleHelpKeys(key)) return true;

    // 4. Handle navigation (delegated to base)
    // Avoid keys that we handle specifically in this subclass or asynchronously
    if (this.shouldDelegateNavigation(key) && this.handleNavigationKeys(key)) {
      return true;
    }

    // 5. Handle action keys
    if (await this.handleActionKeys(key)) return true;

    switch (key) {
      case KEYS.ENTER:
        await this.showDetail();
        return true;
      case KEYS.CAP_R:
        await this.refresh();
        return true;
    }
    return false;
  }

  private handleDetailKeysSync(key: string): boolean {
    if (key === KEYS.ESCAPE || key === KEYS.Q) {
      this.hideDetail();
    }
    return true;
  }

  private shouldDelegateNavigation(key: string): boolean {
    // BASE handles c and e by default
    return key !== KEYS.R && key !== KEYS.CAP_R;
  }

  private handleActionKeys(key: string): boolean {
    switch (key) {
      case KEYS.CAP_R:
        return false; // Handle asynchronously
      case KEYS.SLASH:
        this.showSearchDialog();
        return true;
      case KEYS.F:
        this.showFilterSourceDialog();
        return true;
      case KEYS.S:
        this.showFilterStatusDialog();
        return true;
      case KEYS.G:
        this.cycleGrouping();
        return true;
      case KEYS.D:
        this.showDeleteConfirm();
        return true;
      default:
        return false;
    }
  }

  /**
   * Override base help key handling to support 'q' for closing help
   */
  protected override handleHelpKeys(key: string): boolean {
    if (this.state.showHelp) {
      if (key === KEYS.QUESTION || key === KEYS.ESCAPE || key === KEYS.Q) {
        this.state.showHelp = false;
        return true;
      }
      return true; // Consume all keys when help is shown
    }

    if (key === KEYS.QUESTION) {
      this.state.showHelp = true;
      return true;
    }

    return false;
  }

  isShowingHelp(): boolean {
    return this.state.showHelp;
  }

  isShowingDetail(): boolean {
    return this.skillsViewExtensions.showDetail;
  }

  getExtensions(): ISkillsViewExtensions {
    return { ...this.skillsViewExtensions };
  }

  getSelectedId(): string | null {
    return this.state.selectedId;
  }

  getState(): typeof this.state & ISkillsViewExtensions & { selectedSkillId: string | null } {
    return {
      ...this.state,
      ...this.skillsViewExtensions,
      selectedSkillId: this.state.selectedId,
    };
  }

  override hasActiveDialog(): boolean {
    return this.state.activeDialog !== null;
  }

  renderDialog(): string[] {
    if (this.state.activeDialog) {
      return this.state.activeDialog.render({
        useColors: this.state.useColors,
        width: TUI_LAYOUT_DIALOG_WIDTH,
        height: TUI_LIMIT_MEDIUM,
      });
    }
    return [];
  }
}

// ===== View Factory =====

/**
 * Create a SkillsManagerView instance
 */
export function createSkillsManagerView(service: ISkillsViewService): SkillsManagerView {
  return new SkillsManagerView(service);
}
