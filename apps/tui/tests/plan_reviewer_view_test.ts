/**
 * @module PlanReviewerViewTest
 * @path apps/tui/tests/plan_reviewer_view_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Validates the PlanReviewerView's terminal interaction logic, covering diff visualization
 * for pending plans, keyboard-driven approval/rejection workflows, and real-time status updates.
 */

import { assert, assertEquals } from "@std/assert";
import { PlanStatus } from "@exaix/core/status";
import { ExaPathDefaults } from "@exaix/core";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

import {
  DbLikePlanServiceAdapter,
  type IPlan,
  MinimalPlanServiceMock,
  PlanReviewerTuiSession,
  PlanReviewerView,
} from "../src/plan_reviewer_view.ts";
import { createPlanReviewerSession, sampleBasicPlans, samplePendingPlans, samplePlansWithStatuses } from "./helpers.ts";
import { PlanAdapter } from "../../../apps/common/adapters/plan_adapter.ts";
import { PlanCommands } from "../../../apps/exactl/src/commands/plan_commands.ts";
import type { IPlanDetails } from "@exaix/core/types";
import type { JSONObject, JSONValue } from "@exaix/core/types";
import { createStubConfig, createStubContext, createStubDb } from "@exaix/testing";

function yamlFrontmatter(obj: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    lines.push(`${k}: "${v}"`);
  }
  lines.push("---\n");
  return lines.join("\n");
}

interface ReviewerLog {
  action_type: string;
  plan_id: string;
  reviewer?: string;
  reason?: string | null;
  timestamp?: string;
}

function asString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asObject(value: JSONValue | undefined): JSONObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JSONObject : undefined;
}

async function setupWorkspace(planId: string, frontmatter: Record<string, string>, body = "") {
  const root = await Deno.makeTempDir();
  const inbox = `${root}/Workspace/Plans`;
  await Deno.mkdir(inbox, { recursive: true });
  const content = yamlFrontmatter(frontmatter) + body;
  await Deno.writeTextFile(`${inbox}/${planId}.md`, content);
  return root;
}

// Helper for setting up PlanCommands based tests
async function setupPlanReviewerTest(options: {
  planId?: string;
  frontmatter?: Record<string, string>;
  body?: string;
} = {}) {
  const planId = options.planId || "p1";
  const frontmatter = options.frontmatter || { status: PlanStatus.REVIEW, subject: "Test Plan" };
  const body = options.body || "# Body\n";

  const root = await setupWorkspace(planId, frontmatter, body);
  const db = createStubDb();
  const baseContext = createStubContext();
  const config = {
    ...baseContext.config.getAll(),
    system: {
      ...baseContext.config.getAll().system,
      root,
    },
    paths: { ...ExaPathDefaults },
  };
  const context: ConstructorParameters<typeof PlanCommands>[0] = {
    ...baseContext,
    db,
    config: createStubConfig(config),
  };
  const cmd = new PlanCommands(context);
  const view = new PlanReviewerView(new PlanAdapter(cmd));

  return { root, view, cmd, db, planId };
}

// Helper for TUI session tests with service overrides
function createInteractiveSession(
  plans: IPlan[] = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }],
  overrides: Partial<MinimalPlanServiceMock> = {},
) {
  const mockService = new MinimalPlanServiceMock();
  Object.assign(mockService, overrides);
  const session = new PlanReviewerTuiSession(plans, mockService);
  return { session, mockService };
}

Deno.test("lists pending plans via PlanCommands", async () => {
  const { view, root } = await setupPlanReviewerTest({
    planId: "p1",
    frontmatter: { status: PlanStatus.REVIEW, subject: "Add login" },
  });

  try {
    const pending = await view.listPending();
    assertEquals(pending.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("returns plan content as diff via PlanCommands", async () => {
  const { view, root, planId } = await setupPlanReviewerTest({
    planId: "p2",
    frontmatter: { status: PlanStatus.REVIEW, subject: "Change README" },
    body: "- old\n+ new\n",
  });

  try {
    const diff = await view.getDiff(planId);
    assertEquals(diff.includes("+ new"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("approve moves plan and logs activity via PlanCommands", async () => {
  const { view, root, planId } = await setupPlanReviewerTest({
    planId: "p3",
    frontmatter: { status: PlanStatus.REVIEW, subject: "Refactor" },
  });

  try {
    const ok = await view.approve(planId, "reviewer-1");
    assert(ok);
    // Check that plan file moved to Workspace/Active
    const activePath = `${root}/Workspace/Active/${planId}.md`;
    const exists = await Deno.stat(activePath).then(() => true).catch(() => false);
    assertEquals(exists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ReviewerLog import removed for test compatibility
Deno.test("DB-like path logs reviewer and reason", async () => {
  const logs: ReviewerLog[] = [];
  const dbLike = {
    getPendingPlans: () => Promise.resolve([{ id: "p", subject: "T", status: PlanStatus.REVIEW }]),
    getPlanDiff: () => Promise.resolve("diff"),
    updatePlanStatus: (_id: string, _status: string) => Promise.resolve(),
    logActivity: (evt: ReviewerLog) => {
      logs.push(evt);
      return Promise.resolve();
    },
  };
  // Adapter must match DbLike interface: logActivity(activity: JSONObject)
  const dbLikeAdapter = {
    ...dbLike,
    logActivity: (activity: JSONObject) => {
      const payload = asObject(activity.payload);
      // Map ReviewerLogLike to ReviewerLog
      logs.push({
        action_type: asString(activity.action_type) ?? asString(activity.action) ?? "",
        plan_id: asString(activity.plan_id) ?? asString(activity.target) ?? "",
        reviewer: asString(activity.reviewer) ?? asString(payload?.reviewer),
        reason: asString(activity.reason) ?? asString(payload?.reason),
        timestamp: asString(activity.timestamp),
      });
      return Promise.resolve();
    },
  };
  const view = new PlanReviewerView(new DbLikePlanServiceAdapter(dbLikeAdapter));
  await view.approve("p", "alice@example.com");
  await view.reject("p", "alice@example.com", "too risky");
  const approveLog = logs.find((l) => (l as ReviewerLog).action_type === "plan.approve");
  const rejectLog = logs.find((l) => (l as ReviewerLog).action_type === "plan.reject");
  assert(approveLog && (approveLog as ReviewerLog).reviewer === "alice@example.com");
  assert(
    rejectLog && (rejectLog as ReviewerLog).reviewer === "alice@example.com" &&
      (rejectLog as ReviewerLog).reason === "too risky",
  );
});

Deno.test("reject moves plan to Workspace/Rejected and logs reason via PlanCommands", async () => {
  const { view, root, planId } = await setupPlanReviewerTest({
    planId: "p4",
    frontmatter: { status: PlanStatus.REVIEW, subject: "WIP" },
  });

  try {
    const ok = await view.reject(planId, "reviewer-2", "needs changes");
    assert(ok);
    const rejectedPath = `${root}/Workspace/Rejected/${planId}_rejected.md`;
    const exists = await Deno.stat(rejectedPath).then(() => true).catch(() => false);
    assertEquals(exists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("handles very large plan content via PlanCommands", async () => {
  const large = "a".repeat(100_000);
  const { view, root, planId } = await setupPlanReviewerTest({
    planId: "p5",
    frontmatter: { status: PlanStatus.REVIEW, subject: "Big change" },
    body: large,
  });

  try {
    const diff = await view.getDiff(planId);
    assertEquals(diff.length, large.length + 19);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("PlanReviewerTuiSession: error handling in #triggerAction (service throws)", async () => {
  let called = false;
  const plans = [{ id: "p1", subject: "T1", status: PlanStatus.REVIEW }];
  const { session } = createInteractiveSession(plans, {
    listPending: () => Promise.resolve([]),
    getDiff: () => Promise.resolve(""),
    approve: () => {
      called = true;
      throw new Error("fail-approve");
    },
    reject: () => {
      throw new Error("fail-reject");
    },
  });

  session.setSelectedIndex(0);

  // Press 'a' to show dialog, then confirm
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.ENTER); // confirm
  assertEquals(session.getStatusMessage(), "Error: fail-approve");

  // Press 'r' to show dialog, then confirm
  await session.handleKey(KEYS.R);
  await session.handleKey(KEYS.ENTER); // confirm
  assertEquals(session.getStatusMessage(), "Error: fail-reject");
  assert(called);
});

Deno.test("PlanReviewerView: reject throws if reason missing", async () => {
  // Do not provide getPendingPlans so PlanCommands path is used
  const view = new PlanReviewerView({
    listPending: () => Promise.resolve([] as IPlan[]),
    getDiff: () => Promise.resolve(""),
    approve: () => Promise.resolve(true),
    reject: (_id: string, _r: string, reason?: string) => {
      if (!reason) return Promise.reject(new Error("Rejection reason is required"));
      return Promise.resolve(true);
    },
    revise: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    show: (id: string) => Promise.resolve({ metadata: { id, status: PlanStatus.REVIEW }, content: "" } as IPlanDetails),
  });
  let threw = false;
  try {
    await view.reject("pid", "reviewer");
  } catch (e) {
    threw = true;
    if (e instanceof Error) {
      assertEquals(e.message, "Rejection reason is required");
    } else {
      throw e;
    }
  }
  assert(threw);
});

Deno.test("PlanReviewerView: renderPlanList and renderDiff", () => {
  const view = new PlanReviewerView(new MinimalPlanServiceMock());
  const plans = [
    { id: "p1", subject: "T1", status: PlanStatus.PENDING },
    { id: "p2", subject: "T2", status: PlanStatus.APPROVED },
  ];
  const list = view.renderPlanList(plans);
  assert(list.includes("p1 T1 [pending]"));
  assert(list.includes("p2 T2 [approved]"));
  const diff = view.renderDiff("SOME_DIFF");
  assertEquals(diff, "SOME_DIFF");
});

Deno.test("PlanReviewerTuiSession: edge cases (no plans, invalid selection)", () => {
  const { session } = createPlanReviewerSession([]);
  session.handleKey(KEYS.DOWN); // should not throw
  session.setSelectedIndex(-1);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("PlanReviewerView: works with DB-like service", async () => {
  let updated = false, logged = false;
  const dbLike = {
    getPendingPlans: () => Promise.resolve([{ id: "p", subject: "T", status: PlanStatus.REVIEW }]),
    getPlanDiff: (id: string) => Promise.resolve(`diff-${id}`),
    updatePlanStatus: () => {
      updated = true;
      return Promise.resolve();
    },
    logActivity: () => {
      logged = true;
      return Promise.resolve();
    },
  };
  const view = new PlanReviewerView(new DbLikePlanServiceAdapter(dbLike));
  const pending = await view.listPending();
  assertEquals(pending.length, 1);
  const diff = await view.getDiff("p");
  assertEquals(diff, "diff-p");
  await view.approve("p", "r");
  await view.reject("p", "r", "reason");
  assert(updated && logged);
});

// PlanReviewerTuiSession keyboard interaction tests
Deno.test("PlanReviewerTuiSession keyboard navigation - down arrow", async () => {
  const { session } = createPlanReviewerSession(sampleBasicPlans());

  // Start at index 0
  assertEquals(session.getSelectedIndex(), 0);

  // Press down - should go to index 1
  await session.handleKey(KEYS.DOWN);
  assertEquals(session.getSelectedIndex(), 1);

  // Press down again - should go to index 2
  await session.handleKey(KEYS.DOWN);
  assertEquals(session.getSelectedIndex(), 2);

  // Press down at end - should stay at index 2
  await session.handleKey(KEYS.DOWN);
  assertEquals(session.getSelectedIndex(), 2);
});

Deno.test("PlanReviewerTuiSession keyboard navigation - up arrow", async () => {
  const { session } = createPlanReviewerSession(sampleBasicPlans());

  // Start at index 2
  session.setSelectedIndex(2);
  assertEquals(session.getSelectedIndex(), 2);

  // Press up - should go to index 1
  await session.handleKey(KEYS.UP);
  assertEquals(session.getSelectedIndex(), 1);

  // Press up again - should go to index 0
  await session.handleKey(KEYS.UP);
  assertEquals(session.getSelectedIndex(), 0);

  // Press up at beginning - should stay at index 0
  await session.handleKey(KEYS.UP);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("PlanReviewerTuiSession keyboard navigation - end key", async () => {
  const { session } = createPlanReviewerSession(sampleBasicPlans());

  // Start at index 0
  assertEquals(session.getSelectedIndex(), 0);

  // Press end - should go to last index (2)
  await session.handleKey(KEYS.END);
  assertEquals(session.getSelectedIndex(), 2);
});

Deno.test("PlanReviewerTuiSession keyboard navigation - home key", async () => {
  const { session } = createPlanReviewerSession(sampleBasicPlans());

  // Navigate to end first
  await session.handleKey(KEYS.END);

  // Press home - with tree view, navigates to first tree node
  await session.handleKey(KEYS.HOME);
  const homeIndex = session.getSelectedIndex();
  assert(homeIndex >= 0, "Home should navigate to valid index");
});

Deno.test("PlanReviewerTuiSession keyboard actions - a (approve plan)", async () => {
  let approvedPlan = "";
  const plans = [
    { id: "plan1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "plan2", subject: "Plan 2", status: PlanStatus.REVIEW },
  ];
  const { session } = createInteractiveSession(plans, {
    approve: (planId: string) => {
      approvedPlan = planId;
      return Promise.resolve(true);
    },
    listPending: () => Promise.resolve(plans),
  });

  // Select first plan and press a (shows dialog)
  session.setSelectedIndex(0);
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.ENTER); // confirm
  assertEquals(approvedPlan, "plan1");
});

Deno.test("PlanReviewerTuiSession keyboard actions - r (reject plan)", async () => {
  let rejectedPlan = "";
  const plans = [
    { id: "plan1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "plan2", subject: "Plan 2", status: PlanStatus.REVIEW },
  ];
  const { session } = createInteractiveSession(plans, {
    reject: (planId: string) => {
      rejectedPlan = planId;
      return Promise.resolve(true);
    },
    listPending: () => Promise.resolve(plans),
  });

  // Select first plan and press r (shows dialog)
  session.setSelectedIndex(0);
  await session.handleKey(KEYS.R);
  await session.handleKey(KEYS.ENTER); // confirm
  assertEquals(rejectedPlan, "plan1");
});

Deno.test("PlanReviewerTuiSession keyboard actions - error handling", async () => {
  const plans = [{ id: "plan1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const { session } = createInteractiveSession(plans, {
    approve: () => {
      throw new Error("Failed to approve plan");
    },
    listPending: () => Promise.resolve(plans),
  });

  // Try to approve plan (shows dialog first)
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.ENTER); // confirm
  assertEquals(session.getStatusMessage(), "Error: Failed to approve plan");
});

Deno.test("PlanReviewerTuiSession keyboard actions - no plans", async () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());

  // Keyboard actions should be ignored when no plans
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.UP);
  await session.handleKey(KEYS.A);
  await session.handleKey(KEYS.R);

  // Should remain at index 0
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("PlanReviewerTuiSession keyboard actions - invalid keys ignored", async () => {
  const plans = [{ id: "plan1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  const initialIndex = session.getSelectedIndex();

  // Invalid keys should be ignored
  await session.handleKey(KEYS.X);
  await session.handleKey(KEYS.Y);
  await session.handleKey(KEYS.Z);

  // Selection should remain unchanged
  assertEquals(session.getSelectedIndex(), initialIndex);
});

// ============================================================
// Phase 13.4 Enhanced Plan Reviewer Tests
// ============================================================

Deno.test("Phase 13.4: Plan tree is built with status groups", () => {
  const plans = [
    { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "p2", subject: "Plan 2", status: PlanStatus.APPROVED },
    { id: "p3", subject: "Plan 3", status: PlanStatus.REJECTED },
    { id: "p4", subject: "Plan 4", status: PlanStatus.REVIEW },
  ];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  const tree = session.getPlanTree();
  assert(tree.length > 0, "Tree should have groups");

  // Find pending group
  const pendingGroup = tree.find((n) => n.id === "pending-group");
  assert(pendingGroup, "Should have pending group");
  assertEquals(pendingGroup.children.length, 2, "Pending group should have 2 plans");

  // Find approved group
  const approvedGroup = tree.find((n) => n.id === "approved-group");
  assert(approvedGroup, "Should have approved group");
  assertEquals(approvedGroup.children.length, 1, "Approved group should have 1 plan");

  // Find rejected group
  const rejectedGroup = tree.find((n) => n.id === "rejected-group");
  assert(rejectedGroup, "Should have rejected group");
  assertEquals(rejectedGroup.children.length, 1, "Rejected group should have 1 plan");
});

Deno.test("Phase 13.4: Plan tree rendering", () => {
  const plans = samplePlansWithStatuses().slice(0, 2); // Just p1 and p2
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  const lines = session.renderPlanTree();
  assert(Array.isArray(lines), "Should return array of lines");
  assert(lines.length > 0, "Should have rendered content");
  assert(lines.some((l) => l.includes("Pending")), "Should show Pending group");
});

Deno.test("Phase 13.4: Help screen toggle", async () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  // Initially help is hidden
  assertEquals(session.isHelpVisible(), false, "Help should be hidden initially");

  // Press ? to show help
  await session.handleKey(KEYS.QUESTION);
  assertEquals(session.isHelpVisible(), true, "Help should be visible after ?");

  // Press ? to hide help
  await session.handleKey(KEYS.QUESTION);
  assertEquals(session.isHelpVisible(), false, "Help should be hidden after second ?");
});

Deno.test("Phase 13.4: Help screen rendering", () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  const helpLines = session.renderHelp();
  assert(Array.isArray(helpLines), "Help should be an array");
  assert(helpLines.length > 0, "Help should have content");
  assert(helpLines.some((l) => l.includes("Navigation")), "Should have Navigation section");
  assert(helpLines.some((l) => l.includes("Actions")), "Should have Actions section");
});

Deno.test("Phase 13.4: Confirm dialog for approve", async () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  let approveTriggered = false;
  const { session } = createInteractiveSession(plans, {
    approve: () => {
      approveTriggered = true;
      return Promise.resolve(true);
    },
    listPending: () => Promise.resolve([]),
  });

  // Press a - should show confirm dialog, not immediately approve
  await session.handleKey(KEYS.A);
  assertEquals(session.hasActiveDialog(), true, "Should have dialog open");
  assertEquals(approveTriggered, false, "Approve should not trigger yet");

  // Cancel the dialog
  await session.handleKey(KEYS.ESCAPE);
  assertEquals(session.hasActiveDialog(), false, "Dialog should be closed");
  assertEquals(approveTriggered, false, "Approve should not trigger after cancel");
});

Deno.test("Phase 13.4: Confirm dialog for reject", async () => {
  const plans: IPlan[] = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  let rejectTriggered = false;
  const { session } = createInteractiveSession(plans, {
    reject: () => {
      rejectTriggered = true;
      return Promise.resolve(true);
    },
    listPending: () => Promise.resolve([]),
  });

  // Press r - should show confirm dialog
  await session.handleKey(KEYS.R);
  assertEquals(session.hasActiveDialog(), true, "Should have dialog open");
  assertEquals(rejectTriggered, false, "Reject should not trigger yet");

  // Confirm the dialog
  await session.handleKey(KEYS.ENTER);
  assertEquals(rejectTriggered, true, "Reject should trigger after confirm");
});

Deno.test("Phase 13.4: Diff view toggle", async () => {
  const plans: IPlan[] = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const { session } = createInteractiveSession(plans, {
    getDiff: () => Promise.resolve("+ added line\n- removed line"),
  });

  // Initially diff is hidden
  assertEquals(session.isDiffVisible(), false);

  // Press enter to view diff
  await session.handleKey(KEYS.ENTER);
  assertEquals(session.isDiffVisible(), true, "Diff should be visible after enter");
  assert(session.getDiffContent().includes("+ added line"), "Diff content should include added line");

  // Press escape to close diff
  await session.handleKey(KEYS.ESCAPE);
  assertEquals(session.isDiffVisible(), false, "Diff should be hidden after escape");
});

Deno.test("Phase 13.4: Diff rendering", async () => {
  const plans: IPlan[] = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const { session } = createInteractiveSession(plans, {
    getDiff: () => Promise.resolve("+ added\n- removed\n@@ context @@"),
  });

  await session.handleKey(KEYS.ENTER);

  const diffLines = session.renderDiff();
  assert(diffLines.length > 0, "Should have diff lines");
  assert(diffLines.some((l: string) => l.includes("DIFF VIEWER")), "Should have diff header");
});

Deno.test("Phase 13.4: Expand/Collapse all", async () => {
  const plans = [
    { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "p2", subject: "Plan 2", status: PlanStatus.APPROVED },
    { id: "p3", subject: "Plan 3", status: PlanStatus.REJECTED },
  ];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  // Collapse all
  await session.handleKey(KEYS.C);
  const collapsedTree = session.getPlanTree();
  const allCollapsed = collapsedTree.every((n) => !n.expanded);
  assertEquals(allCollapsed, true, "All groups should be collapsed after 'c'");

  // Expand all
  await session.handleKey(KEYS.E);
  const expandedTree = session.getPlanTree();
  const allExpanded = expandedTree.every((n) => n.expanded);
  assertEquals(allExpanded, true, "All groups should be expanded after 'e'");
});

Deno.test("Phase 13.4: Approve all pending", async () => {
  const plans = [
    { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "p2", subject: "Plan 2", status: PlanStatus.REVIEW },
    { id: "p3", subject: "Plan 3", status: PlanStatus.APPROVED },
  ];
  const approved: string[] = [];
  const { session } = createInteractiveSession(plans, {
    approve: (planId: string) => {
      approved.push(planId);
      return Promise.resolve(true);
    },
    listPending: () => Promise.resolve(samplePendingPlans()),
  });

  // Press A to approve all pending
  await session.handleKey(KEYS.CAP_A);

  // Should have approved 2 plans
  assertEquals(approved.length, 2, "Should approve 2 pending plans");
  assert(approved.includes("p1"), "Should include p1");
  assert(approved.includes("p2"), "Should include p2");
});

Deno.test("Phase 13.4: Refresh view with R key", async () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  let listCalled = false;
  const { session } = createInteractiveSession(plans, {
    listPending: () => {
      listCalled = true;
      return Promise.resolve([
        { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
        { id: "p2", subject: "Plan 2", status: PlanStatus.REVIEW },
      ]);
    },
  });

  await session.handleKey(KEYS.CAP_R);
  assertEquals(listCalled, true, "Should call listPending on R");
});

Deno.test("Phase 13.4: Loading state management", async () => {
  const plans: IPlan[] = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  let resolvePromise: () => void;
  const slowPromise = new Promise<string>((resolve) => {
    resolvePromise = () => resolve("diff content");
  });
  const { session } = createInteractiveSession(plans, {
    getDiff: () => slowPromise,
  });

  // Initial state
  assertEquals(session.isLoading(), false, "Should not be loading initially");

  // Start operation (don't await)
  const opPromise = session.handleKey(KEYS.ENTER);

  // Should be loading now
  assertEquals(session.isLoading(), true, "Should be loading during operation");
  assert(session.getLoadingMessage().includes("Loading diff"), "Loading message should mention diff");

  // Complete the operation
  resolvePromise!();
  await opPromise;

  // Should be done loading
  assertEquals(session.isLoading(), false, "Should not be loading after completion");
});

Deno.test("Phase 13.4: Action buttons include help shortcut", () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  const buttons = session.renderActionButtons();
  assert(buttons.includes("Help"), "Should include Help in action buttons");
  assert(buttons.includes("?"), "Should show ? shortcut");
  assert(buttons.includes("Approve all"), "Should show Approve all");
});

Deno.test("Phase 13.4: View name getter", () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());
  assertEquals(session.getViewName(), "Plan Reviewer");
});

Deno.test("Phase 13.4: Key bindings are defined", () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());

  const bindings = session.getKeyBindings();
  assert(Array.isArray(bindings), "Should return array of bindings");
  assert(bindings.length > 0, "Should have bindings");

  const keys = bindings.map((b) => b.key);
  assert(keys.includes("up"), "Should have up key");
  assert(keys.includes("down"), "Should have down key");
  assert(keys.includes("a"), "Should have a key (approve)");
  assert(keys.includes("r"), "Should have r key (reject)");
  assert(keys.includes("A"), "Should have A key (approve all)");
  assert(keys.includes("?"), "Should have ? key");
});

Deno.test("Phase 13.4: Empty plan list creates empty tree", () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());

  const tree = session.getPlanTree();
  assertEquals(tree.length, 0, "Empty plans should create empty tree");
});

Deno.test("Phase 13.4: Get active dialog when none", () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());

  const dialog = session.getActiveDialog();
  assertEquals(dialog, null, "Should return null when no dialog");
  assertEquals(session.hasActiveDialog(), false, "hasActiveDialog should be false");
});

Deno.test("Phase 13.4: Update plans rebuilds tree", () => {
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  assertEquals(session.getPlanTree().length, 1, "Should have 1 group initially");

  // Update with more plans
  session.updatePlans([
    { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "p2", subject: "Plan 2", status: PlanStatus.APPROVED },
  ]);

  const newTree = session.getPlanTree();
  assertEquals(newTree.length, 2, "Should have 2 groups after update");
});

Deno.test("Phase 13.4: Focusable elements", () => {
  const session = new PlanReviewerTuiSession([], new MinimalPlanServiceMock());

  const focusables = session.getFocusableElements();
  assert(Array.isArray(focusables), "Should be array");
  assert(focusables.includes("plan-list"), "Should include plan-list");
  assert(focusables.includes("action-buttons"), "Should include action-buttons");
});

Deno.test("Phase 13.4: Left arrow collapses expanded group", async () => {
  const plans = [
    { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
    { id: "p2", subject: "Plan 2", status: PlanStatus.REVIEW },
  ];
  const session = new PlanReviewerTuiSession(plans, new MinimalPlanServiceMock());

  // Expand all first
  await session.handleKey(KEYS.E);

  // Navigate to pending group (home)
  await session.handleKey(KEYS.HOME);

  const treeBefore = session.getPlanTree();
  const pendingGroupBefore = treeBefore.find((n) => n.id === "pending-group");
  assertEquals(pendingGroupBefore?.expanded, true, "Should be expanded");

  // Press left to collapse
  await session.handleKey(KEYS.LEFT);

  const treeAfter = session.getPlanTree();
  const pendingGroupAfter = treeAfter.find((n) => n.id === "pending-group");
  assertEquals(pendingGroupAfter?.expanded, false, "Should be collapsed after left");
});

Deno.test("Phase 13.4: createTuiSession accepts useColors parameter", () => {
  const mockService = new MinimalPlanServiceMock();
  const view = new PlanReviewerView(mockService);
  const plans = [{ id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW }];

  // Create with colors
  const tuiWithColors = view.createTuiSession(plans, true);
  assert(tuiWithColors, "Should create TUI with colors");

  // Create without colors
  const tuiWithoutColors = view.createTuiSession(plans, false);
  assert(tuiWithoutColors, "Should create TUI without colors");
});
