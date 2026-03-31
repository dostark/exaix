/**
 * @module PlanServiceUnitTest
 * @path tests/services/plan/plan_service_unit_test.ts
 * @description Unit tests for the PlanService (src/services/plan/plan.ts).
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PlanService } from "../../../src/services/plan/plan.ts";
import { PlanStatus } from "../../../src/shared/status/plan_status.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { createStubConfig, createStubDb, createStubDisplay } from "../../helpers/test_helpers.ts";

function createPlanTestEnv(root: string) {
  const config = createMockConfig(root);
  const configService = createStubConfig(config);
  const db = createStubDb();
  const display = createStubDisplay();

  const service = new PlanService(
    config,
    configService,
    db,
    display,
    () => Promise.resolve("reviewer"),
  );

  const plansDir = join(root, config.paths.workspace, config.paths.plans);
  const activeDir = join(root, config.paths.workspace, config.paths.active);
  const rejectedDir = join(root, config.paths.workspace, config.paths.rejected);
  const archiveDir = join(root, config.paths.workspace, config.paths.archive);

  return { service, plansDir, activeDir, rejectedDir, archiveDir, config };
}

function createReviewPlanContent(overrides?: Record<string, string>): string {
  const fields: Record<string, string> = {
    trace_id: "test-trace-123",
    created_at: new Date().toISOString(),
    status: PlanStatus.REVIEW,
    identity_id: "coder",
    request_id: "req-1",
    subject: "Test plan",
    ...overrides,
  };

  const yamlLines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${yamlLines.join("\n")}\n---\n\n# Plan\n\n## Steps\n\n1. Step one\n2. Step two\n`;
}

// ──────────────────────────────────────────────────────────────────────
// approve
// ──────────────────────────────────────────────────────────────────────

Deno.test("PlanService.approve: moves plan from Plans to Active", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-approve-" });
  try {
    const { service, plansDir, activeDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    const planId = "test-plan-001";
    await Deno.writeTextFile(
      join(plansDir, `${planId}.md`),
      createReviewPlanContent(),
    );

    await service.approve(planId);

    // Source should be gone
    let sourceExists = false;
    try {
      await Deno.stat(join(plansDir, `${planId}.md`));
      sourceExists = true;
    } catch {
      sourceExists = false;
    }
    assertEquals(sourceExists, false);

    // Target should exist
    const targetContent = await Deno.readTextFile(join(activeDir, `${planId}.md`));
    assertEquals(targetContent.includes(`status: "${PlanStatus.APPROVED}"`), true);
    assertEquals(targetContent.includes("approved_by"), true);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.approve: throws for non-existent plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-approve-missing-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    await assertRejects(
      () => service.approve("nonexistent"),
      Error,
      "Plan not found",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.approve: throws for non-review status", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-approve-wrongstatus-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    const planId = "wrong-status";
    await Deno.writeTextFile(
      join(plansDir, `${planId}.md`),
      createReviewPlanContent({ status: PlanStatus.APPROVED }),
    );

    await assertRejects(
      () => service.approve(planId),
      Error,
      "Only plans with status='review'",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.approve: with skills injects into frontmatter", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-approve-skills-" });
  try {
    const { service, plansDir, activeDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    const planId = "skills-plan";
    await Deno.writeTextFile(
      join(plansDir, `${planId}.md`),
      createReviewPlanContent(),
    );

    await service.approve(planId, ["typescript", "deno"]);

    const content = await Deno.readTextFile(join(activeDir, `${planId}.md`));
    assertEquals(content.includes("skills"), true);
    assertEquals(content.includes("typescript"), true);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────
// reject
// ──────────────────────────────────────────────────────────────────────

Deno.test("PlanService.reject: moves plan to Rejected directory", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-reject-" });
  try {
    const { service, plansDir, rejectedDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    const planId = "reject-plan";
    await Deno.writeTextFile(
      join(plansDir, `${planId}.md`),
      createReviewPlanContent(),
    );

    await service.reject(planId, "Not good enough");

    // Source should be gone
    let sourceExists = false;
    try {
      await Deno.stat(join(plansDir, `${planId}.md`));
      sourceExists = true;
    } catch {
      sourceExists = false;
    }
    assertEquals(sourceExists, false);

    // Rejected file should exist
    const rejectedContent = await Deno.readTextFile(join(rejectedDir, `${planId}_rejected.md`));
    assertEquals(rejectedContent.includes(`status: "${PlanStatus.REJECTED}"`), true);
    assertEquals(rejectedContent.includes("rejection_reason"), true);
    assertEquals(rejectedContent.includes("Not good enough"), true);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.reject: throws for non-existent plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-reject-missing-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    await assertRejects(
      () => service.reject("nonexistent", "reason"),
      Error,
      "Plan not found",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────
// list
// ──────────────────────────────────────────────────────────────────────

Deno.test("PlanService.list: returns empty array when no plans exist", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-list-empty-" });
  try {
    const { service } = createPlanTestEnv(root);
    const plans = await service.list();
    assertEquals(plans, []);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.list: lists all plans without filter", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-list-all-" });
  try {
    const { service, plansDir, activeDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);
    await ensureDir(activeDir);

    await Deno.writeTextFile(
      join(plansDir, "plan-1.md"),
      createReviewPlanContent({ status: PlanStatus.REVIEW }),
    );
    await Deno.writeTextFile(
      join(activeDir, "plan-2.md"),
      createReviewPlanContent({ status: PlanStatus.APPROVED }),
    );

    const plans = await service.list();
    assertEquals(plans.length, 2);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.list: filters by status", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-list-filter-" });
  try {
    const { service, plansDir, activeDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);
    await ensureDir(activeDir);

    await Deno.writeTextFile(
      join(plansDir, "plan-review.md"),
      createReviewPlanContent({ status: PlanStatus.REVIEW }),
    );
    await Deno.writeTextFile(
      join(activeDir, "plan-approved.md"),
      createReviewPlanContent({ status: PlanStatus.APPROVED }),
    );

    const reviewPlans = await service.list(PlanStatus.REVIEW);
    assertEquals(reviewPlans.length, 1);
    assertEquals(reviewPlans[0].status, PlanStatus.REVIEW);

    const approvedPlans = await service.list(PlanStatus.APPROVED);
    assertEquals(approvedPlans.length, 1);
    assertEquals(approvedPlans[0].status, PlanStatus.APPROVED);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────
// show
// ──────────────────────────────────────────────────────────────────────

Deno.test("PlanService.show: returns details for existing plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-show-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    await Deno.writeTextFile(
      join(plansDir, "show-plan.md"),
      createReviewPlanContent({ subject: "Show this plan" }),
    );

    const details = await service.show("show-plan");
    assertEquals(details.metadata.id, "show-plan");
    assertEquals(details.metadata.status, PlanStatus.REVIEW);
    assertEquals(details.metadata.subject, "Show this plan");
    assertEquals(details.content.includes("Step one"), true);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.show: throws for non-existent plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-show-missing-" });
  try {
    const { service } = createPlanTestEnv(root);
    await assertRejects(
      () => service.show("nonexistent"),
      Error,
      "Plan not found",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────
// revise
// ──────────────────────────────────────────────────────────────────────

Deno.test("PlanService.revise: appends revision comments to plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-revise-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    const planId = "revise-plan";
    await Deno.writeTextFile(
      join(plansDir, `${planId}.md`),
      createReviewPlanContent(),
    );

    await service.revise(planId, ["Fix the SQL injection", "Add unit tests"]);

    const content = await Deno.readTextFile(join(plansDir, `${planId}.md`));
    assertEquals(content.includes(`status: "${PlanStatus.NEEDS_REVISION}"`), true);
    assertEquals(content.includes("Revision Comments"), true);
    assertEquals(content.includes("Fix the SQL injection"), true);
    assertEquals(content.includes("Add unit tests"), true);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("PlanService.revise: throws for non-existent plan", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-svc-revise-missing-" });
  try {
    const { service, plansDir } = createPlanTestEnv(root);
    await ensureDir(plansDir);

    await assertRejects(
      () => service.revise("nonexistent", ["comment"]),
      Error,
      "Plan not found",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
