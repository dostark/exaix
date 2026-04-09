/**
 * @module PlanReviewerView
 * @path src/tui/plan_reviewer_view.ts
 * @description Interactive TUI view for reviewing and approving/rejecting execution plans, featuring side-by-side diff visualization.
 * @architectural-layer TUI
 * * @related-files [src/services/plan_service.ts, src/tui/tui_dashboard.ts]
 */

import type { IPlanDetails, IPlanMetadata } from "../shared/types/plan.ts";
import { DEFAULT_UNKNOWN_LABEL } from "../shared/constants.ts";
import { TUI_ACTION_SEARCH, TUI_ELEMENT_ACTION_BUTTONS, TUI_LABEL_CANCEL } from "./helpers/constants.ts";
import type { IPlanService } from "../shared/interfaces/i_plan_service.ts";
import { BaseTreeView } from "./base/base_tree_view.ts";
import { coercePlanStatus, PlanStatus, type PlanStatusType } from "../shared/status/plan_status.ts";
import { ConfirmDialog, type DialogBase, InputDialog } from "./helpers/dialog_base.ts";
import { DialogStatus, TuiNodeType } from "../shared/enums.ts";
import { createGroupNode, createNode, flattenTree, type ITreeNode } from "./helpers/tree_view.ts";
import type { JSONObject } from "../shared/types/json.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "./helpers/keyboard.ts";

// ===== Interfaces =====

export type IPlan = IPlanMetadata;

/**
 * Plan-specific state extensions beyond BaseTreeView
 * BaseTreeView provides: selectedId, tree, filterText, isLoading, loadingMessage,
 * showHelp, activeDialog, useColors, spinnerFrame, lastRefresh, scrollOffset
 */
export interface IPlanViewExtensions {
  /** Show diff view */
  showDiff: boolean;
  /** Current diff content */
  diff: string;
}

export interface IDbLike {
  getPendingPlans(): Promise<IPlan[]>;
  getPlanDiff(planId: string): Promise<string>;
  updatePlanStatus(planId: string, status: PlanStatusType): Promise<void>;
  logActivity(activity: JSONObject): Promise<void>;
}

// ===== Plan Status Icons =====

const PLAN_NODE_TYPE = "plan" as const;

const PLAN_ICONS: Record<PlanStatusType | "folder", string> = {
  [PlanStatus.REVIEW]: "🔶",
  [PlanStatus.APPROVED]: "✅",
  [PlanStatus.REJECTED]: "❌",
  [PlanStatus.ACTIVE]: "⚙️",
  [PlanStatus.COMPLETED]: "🏁",
  [PlanStatus.FAILED]: "💥",
  [PlanStatus.ERROR]: "⚠️",
  [PlanStatus.NEEDS_REVISION]: "✍️",
  [PlanStatus.PENDING]: "⏳",
  folder: "📁",
} as const;

// ===== Plan Action Types =====
export enum IPlanAction {
  VIEW_DIFF = "view-diff",
  APPROVE = "approve",
  REJECT = "reject",
  REFRESH_VIEW = "refresh-view",
  APPROVE_ALL = "approve-all",
}

// ===== TUI Session =====

export class PlanReviewerTuiSession extends BaseTreeView<IPlan> {
  private plans: IPlan[];
  private readonly service: IPlanService;
  private planExtensions: IPlanViewExtensions;
  private pendingRejectId: string | null = null;

  constructor(plans: IPlan[], service: IPlanService, useColors = true) {
    super(useColors);
    this.plans = plans;
    this.service = service;
    this.planExtensions = {
      showDiff: false,
      diff: "",
    };
    this.buildTree(plans);
  }

  // ===== BaseTreeView Implementation =====

  override getViewName(): string {
    return "Plan Reviewer";
  }

  override getKeyBindings(): IKeyBinding<IPlanAction | string, KeyBindingCategory>[] {
    return [
      { key: KEYS.UP, action: "up", description: "Navigate up", category: KeyBindingCategory.NAVIGATION },
      { key: KEYS.DOWN, action: "down", description: "Navigate down", category: KeyBindingCategory.NAVIGATION },
      { key: KEYS.HOME, action: "home", description: "Navigate to top", category: KeyBindingCategory.NAVIGATION },
      { key: KEYS.END, action: "end", description: "Navigate to bottom", category: KeyBindingCategory.NAVIGATION },
      {
        key: KEYS.ENTER,
        action: IPlanAction.VIEW_DIFF,
        description: "View diff",
        category: KeyBindingCategory.ACTIONS,
      },
      { key: KEYS.A, action: IPlanAction.APPROVE, description: "Approve plan", category: KeyBindingCategory.ACTIONS },
      { key: KEYS.R, action: IPlanAction.REJECT, description: "Reject plan", category: KeyBindingCategory.ACTIONS },
      {
        key: KEYS.CAP_A,
        action: IPlanAction.APPROVE_ALL,
        description: "Approve all pending",
        category: KeyBindingCategory.ACTIONS,
      },
      {
        key: KEYS.CAP_R,
        action: IPlanAction.REFRESH_VIEW,
        description: "Refresh plans",
        category: KeyBindingCategory.ACTIONS,
      },
      { key: KEYS.SLASH, action: TUI_ACTION_SEARCH, description: "Search plans", category: KeyBindingCategory.ACTIONS },
      { key: KEYS.QUESTION, action: "help", description: "Show help", category: KeyBindingCategory.ACTIONS },
    ];
  }

  override getSelectedIndex(): number {
    if (!this.state.selectedId) return 0;
    const node = this.getSelectedNode();
    if (node?.type === TuiNodeType.PLAN && node.data) {
      const idx = this.plans.findIndex((p) => p.id === (node.data as IPlan).id);
      return idx >= 0 ? idx : 0;
    }
    return 0; // Default to 0 for groups to match older test expectations
  }

  override setSelectedIndex(idx: number): void {
    if (idx >= 0 && idx < this.plans.length) {
      this.state.selectedId = this.plans[idx].id;
      this.syncSelectedIndex();
    }
  }

  // ===== Tree Building =====

  protected override buildTree(plans: IPlan[]): void {
    const categories = this.categorizePlans(plans);
    this.state.tree = this.createGroupNodes(categories);
    this.setDefaultSelection();
  }

  private categorizePlans(plans: IPlan[]): {
    pending: ITreeNode<IPlan>[];
    approved: ITreeNode<IPlan>[];
    rejected: ITreeNode<IPlan>[];
    unknown: ITreeNode<IPlan>[];
  } {
    const pending: ITreeNode<IPlan>[] = [];
    const approved: ITreeNode<IPlan>[] = [];
    const rejected: ITreeNode<IPlan>[] = [];
    const unknown: ITreeNode<IPlan>[] = [];

    const filter = this.state.filterText.toLowerCase();

    for (const plan of plans) {
      if (
        filter && !plan.id.toLowerCase().includes(filter) &&
        !(plan.subject && plan.subject.toLowerCase().includes(filter))
      ) {
        continue;
      }

      const status = coercePlanStatus(plan.status, PlanStatus.REVIEW);
      const node = createNode<IPlan>(
        plan.id,
        plan.subject || plan.id,
        TuiNodeType.PLAN,
        {
          data: plan,
          icon: PLAN_ICONS[status] || PLAN_ICONS.folder,
        },
      );

      switch (status) {
        case PlanStatus.REVIEW:
          pending.push(node);
          break;
        case PlanStatus.APPROVED:
          approved.push(node);
          break;
        case PlanStatus.REJECTED:
          rejected.push(node);
          break;
        default:
          unknown.push(node);
      }
    }

    return { pending, approved, rejected, unknown };
  }

  private createGroupNodes(categories: ReturnType<typeof this.categorizePlans>): ITreeNode<IPlan>[] {
    const tree: ITreeNode<IPlan>[] = [];
    const { pending, approved, rejected, unknown } = categories;

    if (pending.length > 0) {
      tree.push(
        createGroupNode("pending-group", `Pending (${pending.length})`, TuiNodeType.GROUP, pending, {
          icon: PLAN_ICONS[PlanStatus.REVIEW],
          badge: pending.length,
          expanded: true,
        }),
      );
    }

    if (approved.length > 0) {
      tree.push(
        createGroupNode("approved-group", `Approved (${approved.length})`, TuiNodeType.GROUP, approved, {
          icon: PLAN_ICONS[PlanStatus.APPROVED],
          badge: approved.length,
          expanded: true,
        }),
      );
    }

    if (rejected.length > 0) {
      tree.push(
        createGroupNode("rejected-group", `Rejected (${rejected.length})`, TuiNodeType.GROUP, rejected, {
          icon: PLAN_ICONS[PlanStatus.REJECTED],
          badge: rejected.length,
          expanded: true,
        }),
      );
    }

    if (unknown.length > 0) {
      tree.push(
        createGroupNode("other-group", "Other", TuiNodeType.GROUP, unknown, {
          icon: PLAN_ICONS.folder,
          badge: unknown.length,
        }),
      );
    }

    return tree;
  }

  private setDefaultSelection(): void {
    if (!this.state.selectedId && this.state.tree.length > 0) {
      const flat = flattenTree(this.state.tree);
      const firstPlan = flat.find((flatNode) => flatNode.node.type === TuiNodeType.PLAN);
      if (firstPlan) {
        this.state.selectedId = firstPlan.node.id;
      } else {
        this.state.selectedId = flat[0].node.id;
      }
    }
  }

  // ===== Event Handlers =====

  public override async handleKey(key: string): Promise<boolean> {
    // Escape closes diff if visible
    if (key === KEYS.ESCAPE && this.planExtensions.showDiff) {
      this.planExtensions.showDiff = false;
      return true;
    }

    // If dialog is active, handle it first (might involve onDialogClosed which is async)
    if (this.state.activeDialog) {
      return await this.handleDialogKeys(key);
    }

    if (this.handleHelpKeys(key)) return true;

    if (key === KEYS.SLASH) {
      this.showSearchDialog();
      return true;
    }

    const binding = this.getKeyBindings().find((b) => b.key === key);
    const action = binding?.action;
    if (!action) {
      return this.handleNavigationKeys(key);
    }

    switch (action) {
      case IPlanAction.VIEW_DIFF:
        await this.toggleDiff();
        break;
      case IPlanAction.APPROVE:
        if (this.handleActionGuard()) return true;
        this.showApproveConfirmDialog();
        break;
      case IPlanAction.REJECT:
        if (this.handleActionGuard()) return true;
        this.showRejectDialog();
        break;
      case IPlanAction.REFRESH_VIEW:
        await this.refreshView();
        break;
      case IPlanAction.APPROVE_ALL:
        await this.executeApproveAll();
        break;
      default:
        return this.handleNavigationKeys(key);
    }
    return true;
  }

  private handleActionGuard(): boolean {
    const selected = this.getSelectedNode();
    if (selected?.type === PLAN_NODE_TYPE) return false;
    this.statusMessage = "Error: No plan selected";
    return true;
  }

  private showSearchDialog(): void {
    this.showInputDialog({
      title: "Search Plans",
      label: "Search",
      placeholder: "Enter search text...",
      defaultValue: this.state.filterText,
    });
  }

  protected override async onDialogClosed(dialog: DialogBase): Promise<void> {
    if (dialog.getState() === DialogStatus.CONFIRMED) {
      if (dialog instanceof ConfirmDialog) {
        const options = (dialog as ConfirmDialog).options;
        if (options?.title === "Approve Plan") {
          await this.executeApprove();
        } else if (options?.title === "Reject Plan" && this.pendingRejectId) {
          await this.executeReject(this.pendingRejectId, "Rejected by TUI reviewer");
          this.pendingRejectId = null;
        }
      } else if (dialog instanceof InputDialog) {
        const options = (dialog as InputDialog).options;
        if (options?.title === "Search Plans") {
          this.state.filterText = dialog.getValue();
          this.buildTree(this.plans);
        }
      }
    }
  }

  // ===== Actions =====

  private async toggleDiff(): Promise<void> {
    const selected = this.getSelectedNode();
    if (!selected) return;

    if (selected.type === TuiNodeType.GROUP) {
      selected.expanded = !selected.expanded;
      return;
    }
    if (selected.type === TuiNodeType.PLAN) {
      await this.showDiffAction(selected.data as IPlan);
    }
  }

  private async showDiffAction(plan: IPlan): Promise<void> {
    const diff = await this.executeWithLoading(
      `Loading diff for ${plan.id}...`,
      () => this.service.getDiff(plan.id),
      () => "",
    );

    if (diff !== null) {
      this.planExtensions.diff = diff;
      this.planExtensions.showDiff = true;
    }
  }

  private showApproveConfirmDialog(): void {
    const selected = this.getSelectedNode();
    if (!selected || selected.type !== PLAN_NODE_TYPE) return;
    const plan = selected.data as IPlan;

    this.showConfirmDialog({
      title: "Approve Plan",
      message: `Approve plan "${plan.subject}"?\nThis action will move the plan to active status.`,
      confirmText: "Approve",
      cancelText: TUI_LABEL_CANCEL,
    });
  }

  private async executeApprove(): Promise<void> {
    const selected = this.getSelectedNode();
    if (!selected || selected.type !== PLAN_NODE_TYPE) return;
    const planId = selected.id;

    await this.executeWithLoading(
      `Approving ${planId}...`,
      async () => {
        await this.service.approve(planId, "reviewer");
        await this.refreshView();
      },
      () => `Approved ${planId}`,
    );
  }

  private showRejectDialog(): void {
    const selected = this.getSelectedNode();
    if (!selected || selected.type !== PLAN_NODE_TYPE) return;
    const plan = selected.data as IPlan;

    this.pendingRejectId = plan.id;
    this.showConfirmDialog({
      title: "Reject Plan",
      message: `Reject plan "${plan.subject}"?\nThis action will move the plan to rejected status.`,
      confirmText: "Reject",
      cancelText: TUI_LABEL_CANCEL,
      destructive: true,
    });
  }

  private async executeReject(planId: string, reason: string): Promise<void> {
    await this.executeWithLoading(
      `Rejecting ${planId}...`,
      async () => {
        await this.service.reject(planId, "reviewer", reason);
        await this.refreshView();
      },
      () => `Rejected ${planId}`,
    );
  }

  private async refreshView(): Promise<void> {
    await this.executeWithLoading(
      "Refreshing plans...",
      async () => {
        const newPlans = await this.service.listPending();
        this.updatePlans(newPlans);
        this.state.lastRefresh = Date.now();
      },
      () => "Refreshed",
    );
  }

  // ===== State Accessors =====

  updatePlans(newPlans: IPlan[]): void {
    this.plans = newPlans;
    this.buildTree(newPlans);
  }

  getSelectedPlanDetails(): IPlan | undefined {
    const selected = this.getSelectedNode();
    return selected?.data as IPlan | undefined;
  }

  getExtensions(): IPlanViewExtensions {
    return this.planExtensions;
  }

  closeDiff(): void {
    this.planExtensions.showDiff = false;
  }

  getPlanTree(): ITreeNode<IPlan>[] {
    return this.state.tree;
  }

  // ===== Backward Compatibility for Tests =====

  renderPlanTree(): string[] {
    return this.renderTreeView();
  }

  renderHelp(): string[] {
    return [
      "Plan Reviewer Help",
      "==================",
      "Navigation:",
      "  ↑ / k      : Move up",
      "  ↓ / j      : Move down",
      "  Home       : First plan",
      "  End        : Last plan",
      "  /          : Search",
      "",
      "Actions:",
      "  Enter      : View diff",
      "  a          : Approve plan",
      "  r          : Reject plan",
      "  R (Shift+R): Refresh plans",
      "  ?          : Toggle help",
    ];
  }

  isDiffVisible(): boolean {
    return this.planExtensions.showDiff;
  }

  getDiffContent(): string {
    return this.planExtensions.diff;
  }

  renderDiff(): string[] {
    const lines = this.planExtensions.diff.split("\n");
    return [
      "DIFF VIEWER",
      "===========",
      ...lines,
    ];
  }

  renderActionButtons(): string {
    return "Approve (a) | Reject (r) | Approve all (A) | Refresh (R) | Help (?)";
  }

  private async executeApproveAll(): Promise<void> {
    const pendingPlans = this.plans.filter((p) => coercePlanStatus(p.status, PlanStatus.REVIEW) === PlanStatus.REVIEW);
    if (pendingPlans.length === 0) {
      this.statusMessage = "No pending plans to approve";
      return;
    }

    await this.executeWithLoading(
      `Approving ${pendingPlans.length} plans...`,
      async () => {
        for (const plan of pendingPlans) {
          await this.service.approve(plan.id, "reviewer");
        }
        await this.refreshView();
      },
      () => `Approved ${pendingPlans.length} plans`,
    );
  }

  getFocusableElements(): string[] {
    return ["plan-list", TUI_ELEMENT_ACTION_BUTTONS];
  }
}

/**
 * High-level view class for the Plan Reviewer.
 */
export class PlanReviewerView {
  constructor(private service: IPlanService) {}

  async listPending(): Promise<IPlan[]> {
    return await this.service.listPending();
  }

  async getDiff(planId: string): Promise<string> {
    return await this.service.getDiff(planId);
  }

  async approve(planId: string, reviewer: string): Promise<boolean> {
    return await this.service.approve(planId, reviewer);
  }

  async reject(planId: string, reviewer: string, reason?: string): Promise<boolean> {
    return await this.service.reject(planId, reviewer, reason);
  }

  createTuiSession(plans: IPlan[], useColors = true): PlanReviewerTuiSession {
    return new PlanReviewerTuiSession(plans, this.service, useColors);
  }

  renderPlanList(plans: IPlan[]): string {
    return plans.map((p) => `${p.id} ${p.subject} [${p.status || PlanStatus.PENDING}]`).join("\n");
  }

  renderDiff(diff: string): string {
    return diff;
  }
}

/**
 * Adapter for DB-like objects to IPlanService.
 */
export class DbLikePlanServiceAdapter implements IPlanService {
  constructor(private db: IDbLike) {}
  async listPending(): Promise<IPlan[]> {
    return await this.db.getPendingPlans();
  }
  async getDiff(planId: string): Promise<string> {
    return await this.db.getPlanDiff(planId);
  }
  async approve(planId: string, reviewer: string): Promise<boolean> {
    await this.db.updatePlanStatus(planId, PlanStatus.APPROVED);
    await this.db.logActivity({
      action_type: "plan.approve",
      plan_id: planId,
      reviewer,
      timestamp: new Date().toISOString(),
    });
    return true;
  }
  async reject(planId: string, reviewer: string, reason?: string): Promise<boolean> {
    await this.db.updatePlanStatus(planId, PlanStatus.REJECTED);
    await this.db.logActivity({
      action_type: "plan.reject",
      plan_id: planId,
      reviewer,
      reason,
      timestamp: new Date().toISOString(),
    });
    return true;
  }
  revise(_planId: string, _comments: string[]): Promise<void> {
    return Promise.resolve();
  }
  list(_status?: PlanStatusType): Promise<IPlan[]> {
    return this.listPending();
  }
  async show(planId: string): Promise<IPlanDetails> {
    const plans = await this.listPending();
    const p = plans.find((x) => x.id === planId);
    return {
      metadata: {
        id: planId,
        subject: p?.subject || DEFAULT_UNKNOWN_LABEL,
        status: p?.status || PlanStatus.PENDING,
        created_at: p?.created_at || new Date().toISOString(),
      },
      content: "Content not available in DB-like adapter",
    } as IPlanDetails;
  }
}

/**
 * Mock Plan Service for TUI tests.
 */
export class MinimalPlanServiceMock implements IPlanService {
  private plans: IPlan[] = [];
  constructor(plans: IPlan[] = []) {
    this.plans = plans;
  }
  async listPending(): Promise<IPlan[]> {
    return await Promise.resolve(this.plans);
  }
  async getDiff(_planId: string): Promise<string> {
    return await Promise.resolve("Mock diff content");
  }
  async approve(_planId: string, _reviewer: string): Promise<boolean> {
    return await Promise.resolve(true);
  }
  async reject(_planId: string, _reviewer: string, _reason?: string): Promise<boolean> {
    return await Promise.resolve(true);
  }
  revise(_planId: string, _comments: string[]): Promise<void> {
    return Promise.resolve();
  }
  list(_status?: PlanStatusType): Promise<IPlan[]> {
    return Promise.resolve(this.plans);
  }
  show(planId: string): Promise<IPlanDetails> {
    const p = this.plans.find((x) => x.id === planId);
    return Promise.resolve({
      metadata: {
        id: planId,
        subject: p?.subject || "Mock Plan",
        status: p?.status || PlanStatus.PENDING,
        created_at: p?.created_at || new Date().toISOString(),
      },
      content: "Mock Content",
    } as IPlanDetails);
  }
}
