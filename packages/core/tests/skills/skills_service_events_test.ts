/**
 * @module SkillsServiceEventsTest
 * @path packages/core/tests/skills/skills_service_events_test.ts
 * @description Journal evidence for the skill root lifecycle events, read back from a real
 *   EventLogger and journal DB. `skills.initialized` records ready and failed outcomes for the writable
 *   roots. `skills.shadowed` records the winner and the masked paths once per changed shadow set and
 *   carries the trace and config generation of the operation that found it.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, packages/core/src/skills/skill_folder_loader.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SkillInitOutcome, SkillStatus } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { createSkillOperationContext, SkillsService } from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

interface IJournalRow {
  trace_id: string | null;
  payload: string;
}

async function fixture() {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skills-events-" });
  return {
    env,
    base,
    logger: new EventLogger({ db: env.db }),
    rows: async (type: string): Promise<IJournalRow[]> => {
      await env.db.waitForFlush();
      return (await env.db.getActivitiesByActionTypeSafe(type)) as IJournalRow[];
    },
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("[journal] initialize journals a ready outcome with the writable root count", async () => {
  const fx = await fixture();
  try {
    const service = new SkillsService({ memoryDir: join(fx.base, "Memory") }, fx.env.db, undefined, fx.logger);
    await service.initialize();
    const rows = await fx.rows(DomainEventType.SkillsInitialized);
    assertEquals(rows.length, 1);
    const payload = JSON.parse(rows[0].payload);
    assertEquals([payload.outcome, payload.writable_roots, payload.recovered_operations], [
      SkillInitOutcome.READY,
      1,
      0,
    ]);
    assertEquals(payload.config_generation, "static");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[journal] initialize journals a failed outcome and rethrows when a writable root cannot be created", async () => {
  const fx = await fixture();
  try {
    const blocker = join(fx.base, "Memory");
    await Deno.writeTextFile(blocker, "a file where the memory directory should be");
    const service = new SkillsService({ memoryDir: blocker }, fx.env.db, undefined, fx.logger);
    await assertRejects(() => service.initialize());
    const rows = await fx.rows(DomainEventType.SkillsInitialized);
    assertEquals(rows.length, 1);
    assertEquals(JSON.parse(rows[0].payload).outcome, SkillInitOutcome.FAILED);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[journal] a shadowed skill journals its winner and masked paths once per changed shadow set", async () => {
  const fx = await fixture();
  try {
    const memoryDir = join(fx.base, "Memory");
    const blueprintDir = join(fx.base, "Blueprints", "Skills");
    await writeSkillFolder(blueprintDir, { name: "twin", instructions: "Blueprint twin." });
    await writeSkillFolder(join(memoryDir, "Skills", "learned"), {
      name: "twin",
      instructions: "Learned twin.",
      sidecar: { status: SkillStatus.ACTIVE },
    });
    const service = new SkillsService({ memoryDir, blueprintSkillsDir: blueprintDir }, fx.env.db, undefined, fx.logger);
    const ctx = createSkillOperationContext({ agentRole: "test", traceId: "trace-shadow" });
    await service.getSkill("twin", ctx);
    await service.getSkill("twin", ctx);
    const rows = await fx.rows(DomainEventType.SkillsShadowed);
    assertEquals(rows.length, 1, "an unchanged shadow set is journaled once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.name, "twin");
    assertEquals(payload.winner_path, "twin");
    assertEquals(payload.shadowed_paths, ["twin"]);
    assertEquals(payload.config_generation, "static");
    assertEquals(rows[0].trace_id, "trace-shadow");
    assert(!JSON.stringify(payload).includes(fx.base), "no host paths in the payload");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[journal] approve, delete and a refused mutation journal their payloads on the operation trace", async () => {
  const fx = await fixture();
  try {
    const service = new SkillsService({ memoryDir: join(fx.base, "Memory") }, fx.env.db, undefined, fx.logger);
    await service.initialize();
    const ctx = createSkillOperationContext({ agentRole: "reviewer", traceId: "trace-lifecycle" });
    const draft = await service.createSkill({ name: "lifecycle", description: "d", instructions: "Body." }, ctx);

    await assertRejects(() => service.approveSkill("lifecycle", crypto.randomUUID(), ctx));
    const active = await service.approveSkill("lifecycle", draft.id, ctx);
    await service.deleteSkill("lifecycle", ctx);

    const approved = await fx.rows(DomainEventType.SkillsApproved);
    assertEquals(approved.length, 1);
    assertEquals(approved[0].trace_id, "trace-lifecycle");
    const approvedPayload = JSON.parse(approved[0].payload);
    assertEquals(approvedPayload.name, "lifecycle");
    assertEquals(approvedPayload.reviewed_revision_id, draft.id);
    assertEquals(approvedPayload.active_revision_id, active.id);
    assertEquals(approvedPayload.actor, "reviewer");

    const deleted = await fx.rows(DomainEventType.SkillsDeleted);
    assertEquals(deleted.length, 1);
    assertEquals(JSON.parse(deleted[0].payload).revision_id, active.id);
    assertEquals(deleted[0].trace_id, "trace-lifecycle");

    const failed = await fx.rows(DomainEventType.SkillsMutationFailed);
    assertEquals(failed.length, 1);
    const failedPayload = JSON.parse(failed[0].payload);
    assertEquals([failedPayload.name, failedPayload.operation, failedPayload.reason], [
      "lifecycle",
      "approve",
      "skill_revision_mismatch",
    ]);
    assertEquals(failed[0].trace_id, "trace-lifecycle");
  } finally {
    await fx.cleanup();
  }
});
