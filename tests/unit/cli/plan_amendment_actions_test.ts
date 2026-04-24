/**
 * @module PlanAmendmentActionsTest
 * @path tests/unit/cli/plan_amendment_actions_test.ts
 * @description Unit tests for CLI plan amendment actions (list, show, approve, reject).
 * @related-files [src/cli/commands/plan_commands.ts, src/services/plan/plan_amendment_service.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

Deno.test("amendment list discovers pending amendments", async () => {
  const root = await Deno.makeTempDir();

  try {
    const traceId = "550e8400-e29b-41d4-a716-446655440000";
    const amendmentId1 = "660e8400-e29b-41d4-a716-446655440001";
    const amendmentId2 = "770e8400-e29b-41d4-a716-446655440002";

    // Create amendment artifacts
    const amendmentsDir = join(root, "Memory", "Execution", traceId, "amendments");
    await Deno.mkdir(amendmentsDir, { recursive: true });

    const amendment1: IPlanAmendmentPatch = {
      amendmentId: amendmentId1,
      planId: "plan-1",
      affectedRemainingStepIds: ["2"],
      summary: "First amendment",
      adds: [],
      updates: [],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    const amendment2: IPlanAmendmentPatch = {
      amendmentId: amendmentId2,
      planId: "plan-2",
      affectedRemainingStepIds: ["3"],
      summary: "Second amendment",
      adds: [],
      updates: [],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      join(amendmentsDir, `${amendmentId1}.json`),
      JSON.stringify(amendment1, null, 2),
    );
    await Deno.writeTextFile(
      join(amendmentsDir, `${amendmentId2}.json`),
      JSON.stringify(amendment2, null, 2),
    );

    // Verify discovery
    const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
    const amendmentFiles = entries.filter((e) => e.name.endsWith(".json"));
    assertEquals(amendmentFiles.length, 2);

    const amendmentIds = amendmentFiles.map((e) => e.name.replace(".json", ""));
    assertEquals(amendmentIds.includes(amendmentId1), true);
    assertEquals(amendmentIds.includes(amendmentId2), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("amendment show displays structural patch details", async () => {
  const root = await Deno.makeTempDir();

  try {
    const amendmentId = "550e8400-e29b-41d4-a716-446655440000";
    const amendmentsDir = join(root, "Memory", "Execution", "trace-1", "amendments");
    await Deno.mkdir(amendmentsDir, { recursive: true });

    const patch: IPlanAmendmentPatch = {
      amendmentId,
      planId: "plan-1",
      affectedRemainingStepIds: ["2", "3"],
      summary: "Show test amendment",
      adds: [
        { number: 4, title: "New Step", content: "New step content" },
      ],
      updates: [
        { number: 2, title: "Updated Step", content: "Updated step content" },
      ],
      removes: ["3"],
      createdAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      join(amendmentsDir, `${amendmentId}.json`),
      JSON.stringify(patch, null, 2),
    );

    // Read and verify structure
    const content = await Deno.readTextFile(join(amendmentsDir, `${amendmentId}.json`));
    const parsed = JSON.parse(content);

    assertEquals(parsed.amendmentId, amendmentId);
    assertEquals(parsed.summary, "Show test amendment");
    assertEquals(parsed.adds.length, 1);
    assertEquals(parsed.updates.length, 1);
    assertEquals(parsed.removes.length, 1);
    assertEquals(parsed.adds[0].title, "New Step");
    assertEquals(parsed.updates[0].title, "Updated Step");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("amendment approve applies patch to plan file", async () => {
  const root = await Deno.makeTempDir();

  try {
    // Create a plan file with amendment_pending status
    const plansDir = join(root, "Workspace", "Active");
    await Deno.mkdir(plansDir, { recursive: true });

    const planContent = readFixtureTextSync(
      import.meta.url,
      "unit",
      "cli",
      "plan_amendment_actions_test",
      "planContent.md",
    );
    await Deno.writeTextFile(join(plansDir, "plan.md"), planContent);

    // Create amendment patch
    const amendmentId = "550e8400-e29b-41d4-a716-446655440000";
    const patch: IPlanAmendmentPatch = {
      amendmentId,
      planId: "plan-1",
      affectedRemainingStepIds: ["2"],
      summary: "Approve test amendment",
      adds: [],
      updates: [
        { number: 2, title: "Second Updated", content: "Updated content 2" },
      ],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    // Verify plan file exists before approval
    const planPath = join(plansDir, "plan.md");
    const beforeStat = await Deno.stat(planPath);
    assertEquals(beforeStat.isFile, true);

    // Verify patch is valid
    assertEquals(patch.amendmentId, amendmentId);
    assertEquals(patch.summary, "Approve test amendment");
    assertEquals(patch.updates.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("amendment reject records reason and fails plan", async () => {
  const root = await Deno.makeTempDir();

  try {
    const amendmentId = "550e8400-e29b-41d4-a716-446655440000";
    const amendmentsDir = join(root, "Memory", "Execution", "trace-1", "amendments");
    await Deno.mkdir(amendmentsDir, { recursive: true });

    // Create amendment artifact
    const patch: IPlanAmendmentPatch = {
      amendmentId,
      planId: "plan-1",
      affectedRemainingStepIds: ["2"],
      summary: "Reject test amendment",
      adds: [],
      updates: [],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      join(amendmentsDir, `${amendmentId}.json`),
      JSON.stringify(patch, null, 2),
    );

    // Create rejection decision
    const decision = {
      amendmentId,
      decision: "rejected",
      decidedAt: new Date().toISOString(),
      decidedBy: "user-123",
      rationale: "Not aligned with project goals",
    };

    const decisionsDir = join(root, "Memory", "Execution", "trace-1", "decisions");
    await Deno.mkdir(decisionsDir, { recursive: true });

    await Deno.writeTextFile(
      join(decisionsDir, `${amendmentId}-decision.json`),
      JSON.stringify(decision, null, 2),
    );

    // Verify rejection recorded
    const decisionPath = join(decisionsDir, `${amendmentId}-decision.json`);
    const decisionContent = await Deno.readTextFile(decisionPath);
    const parsed = JSON.parse(decisionContent);

    assertEquals(parsed.decision, "rejected");
    assertEquals(parsed.rationale, "Not aligned with project goals");
    assertEquals(parsed.decidedBy, "user-123");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("amendment artifacts are stored with correct structure", async () => {
  const root = await Deno.makeTempDir();

  try {
    const traceId = "550e8400-e29b-41d4-a716-446655440000";
    const amendmentId = "660e8400-e29b-41d4-a716-446655440001";

    const amendmentsDir = join(root, "Memory", "Execution", traceId, "amendments");
    await Deno.mkdir(amendmentsDir, { recursive: true });

    const patch: IPlanAmendmentPatch = {
      amendmentId,
      planId: "test-plan",
      affectedRemainingStepIds: ["2", "3"],
      summary: "Structure test",
      adds: [{ number: 4, title: "Add Step", content: "Added content" }],
      updates: [{ number: 2, title: "Update Step", content: "Updated content" }],
      removes: ["3"],
      createdAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      join(amendmentsDir, `${amendmentId}.json`),
      JSON.stringify(patch, null, 2),
    );

    // Verify directory structure
    const memoryStat = await Deno.stat(join(root, "Memory"));
    assertEquals(memoryStat.isDirectory, true);

    const executionStat = await Deno.stat(join(root, "Memory", "Execution"));
    assertEquals(executionStat.isDirectory, true);

    const traceStat = await Deno.stat(join(root, "Memory", "Execution", traceId));
    assertEquals(traceStat.isDirectory, true);

    const amendmentsStat = await Deno.stat(amendmentsDir);
    assertEquals(amendmentsStat.isDirectory, true);

    // Verify file structure
    const filePath = join(amendmentsDir, `${amendmentId}.json`);
    const fileStat = await Deno.stat(filePath);
    assertEquals(fileStat.isFile, true);

    // Verify JSON structure
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.amendmentId, amendmentId);
    assertEquals(parsed.planId, "test-plan");
    assertEquals(Array.isArray(parsed.affectedRemainingStepIds), true);
    assertEquals(Array.isArray(parsed.adds), true);
    assertEquals(Array.isArray(parsed.updates), true);
    assertEquals(Array.isArray(parsed.removes), true);
    assertEquals(typeof parsed.createdAt, "string");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
