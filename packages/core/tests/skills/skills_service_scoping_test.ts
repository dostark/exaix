/**
 * @module SkillsServiceScopingTest
 * @path packages/core/tests/skills/skills_service_scoping_test.ts
 * @description Phase 206 Step 4 — `forContext` returns a scoped view that binds one operation
 *   context without mutating the singleton service. Two portals never see each other's project
 *   skills, an explicit context beats the bound one, and `ensureRevisions` durably snapshots the
 *   exact content a scoped read returned, failing closed when that content is unknown.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, packages/core/src/skills/skill_context.ts]
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SkillStatus } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { createSkillOperationContext, SkillAuditUnavailableError, SkillsService } from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

const ACTIVE_SIDECAR = { status: SkillStatus.ACTIVE };

interface IFixture {
  service: SkillsService;
  memoryDir: string;
  blueprintDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skills-scoping-" });
  const memoryDir = join(base, "Memory");
  const blueprintDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(blueprintDir, { name: "shared-skill", instructions: "Shared body." });
  for (const portal of ["Alpha", "Beta"]) {
    await writeSkillFolder(join(memoryDir, "Skills", "project", portal), {
      name: `${portal.toLowerCase()}-skill`,
      instructions: `Body for ${portal}.`,
      sidecar: ACTIVE_SIDECAR,
    });
  }
  const service = new SkillsService(
    { memoryDir, blueprintSkillsDir: blueprintDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  return {
    service,
    memoryDir,
    blueprintDir,
    db: env.db,
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("[scoping] a scoped view resolves its own portal's project skills and nothing from another portal", async () => {
  const fx = await fixture();
  try {
    const alpha = fx.service.forContext(createSkillOperationContext({ agentRole: "test", portal: "Alpha" }));
    const beta = fx.service.forContext(createSkillOperationContext({ agentRole: "test", portal: "Beta" }));
    assertEquals((await alpha.getSkill("alpha-skill"))?.project, "Alpha");
    assertEquals(await alpha.getSkill("beta-skill"), null, "no cross-portal leakage");
    assertEquals((await beta.getSkill("beta-skill"))?.project, "Beta");
    assertEquals(await beta.getSkill("alpha-skill"), null);
    assertEquals((await alpha.getSkill("shared-skill"))?.name, "shared-skill");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[scoping] creating a scoped view never mutates the singleton service", async () => {
  const fx = await fixture();
  try {
    fx.service.forContext(createSkillOperationContext({ agentRole: "test", portal: "Alpha" }));
    assertEquals(await fx.service.getSkill("alpha-skill"), null, "the singleton stays global-only");
    const scoped = fx.service.forContext(createSkillOperationContext({ agentRole: "test", portal: "Alpha" }));
    await scoped.getSkill("alpha-skill");
    assertEquals(await fx.service.getSkill("alpha-skill"), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[scoping] an explicit context beats the bound one, and matching honors the bound portal", async () => {
  const fx = await fixture();
  try {
    const alpha = fx.service.forContext(createSkillOperationContext({ agentRole: "test", portal: "Alpha" }));
    const beta = createSkillOperationContext({ agentRole: "test", portal: "Beta" });
    assertEquals((await alpha.getSkill("beta-skill", beta))?.project, "Beta");
    const matches = await alpha.matchSkills({ requestText: "alpha", keywords: ["alpha"], tags: [] });
    assertEquals(matches.matches.every((m) => m.skillId !== "beta-skill"), true);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[scoping] createSkillOperationContext drops an invalid portal and assigns one trace per context", () => {
  const invalid = createSkillOperationContext({ agentRole: "test", portal: "../escape" });
  assertEquals(invalid.portal, null);
  const noPortal = createSkillOperationContext({ agentRole: "test" });
  assertEquals(noPortal.portal, null);
  assertNotEquals(noPortal.traceId, createSkillOperationContext({ agentRole: "test" }).traceId);
  const fixed = createSkillOperationContext({ agentRole: "test", traceId: "trace-1", requestId: "req-1" });
  assertEquals([fixed.traceId, fixed.requestId], ["trace-1", "req-1"]);
});

Deno.test("[revisions] ensureRevisions durably snapshots the exact content a read returned, once per revision", async () => {
  const fx = await fixture();
  try {
    const ctx = createSkillOperationContext({ agentRole: "test", traceId: "trace-rev" });
    const scoped = fx.service.forContext(ctx);
    const skill = await scoped.getSkill("shared-skill");
    await scoped.ensureRevisions([skill!.id]);
    await scoped.ensureRevisions([skill!.id]);
    const rows = await fx.db.preparedAll<{ revision_id: string; skill_md: string }>(
      "SELECT revision_id, skill_md FROM skill_revisions",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].revision_id, skill!.id);
    assertEquals(rows[0].skill_md.includes("Shared body."), true);
    await fx.db.waitForFlush();
    const events = await fx.db.getActivitiesByActionTypeSafe(DomainEventType.SkillsRevisionRecorded);
    assertEquals(events.length, 1);
    assertEquals(events[0].trace_id, "trace-rev");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[revisions] an edit yields a new revision and the earlier snapshot stays", async () => {
  const fx = await fixture();
  try {
    const ctx = createSkillOperationContext({ agentRole: "test" });
    const first = await fx.service.getSkill("shared-skill", ctx);
    await fx.service.ensureRevisions([first!.id], ctx);
    await writeSkillFolder(fx.blueprintDir, { name: "shared-skill", instructions: "Edited body." });
    const second = await fx.service.getSkill("shared-skill", ctx);
    await fx.service.ensureRevisions([second!.id], ctx);
    assertNotEquals(first!.id, second!.id);
    const rows = await fx.db.preparedAll<{ revision_id: string }>("SELECT revision_id FROM skill_revisions");
    assertEquals(rows.map((r) => r.revision_id).sort(), [first!.id, second!.id].sort());
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[revisions] an unknown revision or a failed write fails closed with skill_audit_unavailable", async () => {
  const fx = await fixture();
  try {
    const ctx = createSkillOperationContext({ agentRole: "test" });
    await assertRejects(
      () => fx.service.ensureRevisions(["00000000-0000-5000-8000-000000000000"], ctx),
      SkillAuditUnavailableError,
    );
    const skill = await fx.service.getSkill("shared-skill", ctx);
    await fx.db.preparedRun("DROP TABLE skill_revisions");
    const error = await assertRejects(() => fx.service.ensureRevisions([skill!.id], ctx), SkillAuditUnavailableError);
    assertEquals(error.code, "skill_audit_unavailable");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[scoping][security] a stored project revision is readable only from its own portal while a global one is readable everywhere", async () => {
  const fx = await fixture();
  try {
    const alphaCtx = createSkillOperationContext({ agentRole: "test", portal: "Alpha" });
    const betaCtx = createSkillOperationContext({ agentRole: "test", portal: "Beta" });
    const globalCtx = createSkillOperationContext({ agentRole: "test" });
    const alphaSkill = (await fx.service.getSkill("alpha-skill", alphaCtx))!;
    const shared = (await fx.service.getSkill("shared-skill", alphaCtx))!;
    await fx.service.ensureRevisions([alphaSkill.id, shared.id], alphaCtx);

    assertEquals((await fx.service.getRevision(alphaSkill.id, alphaCtx))?.skillName, "alpha-skill");
    assertEquals(await fx.service.getRevision(alphaSkill.id, betaCtx), null, "another portal sees nothing");
    assertEquals(await fx.service.getRevision(alphaSkill.id, globalCtx), null, "global scope sees nothing");
    assertEquals((await fx.service.listRevisions("alpha-skill", alphaCtx)).length, 1);
    assertEquals(await fx.service.listRevisions("alpha-skill", betaCtx), []);
    assertEquals(await fx.service.listRevisions("alpha-skill", globalCtx), []);

    for (const ctx of [alphaCtx, betaCtx, globalCtx]) {
      assertEquals((await fx.service.getRevision(shared.id, ctx))?.skillName, "shared-skill");
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[scoping][security] identical content recorded in two scopes is visible to both", async () => {
  const fx = await fixture();
  try {
    const alphaCtx = createSkillOperationContext({ agentRole: "test", portal: "Alpha" });
    const betaCtx = createSkillOperationContext({ agentRole: "test", portal: "Beta" });
    await writeSkillFolder(join(fx.memoryDir, "Skills", "project", "Beta"), {
      name: "alpha-skill",
      instructions: "Body for Alpha.",
      sidecar: ACTIVE_SIDECAR,
    });
    const inAlpha = (await fx.service.getSkill("alpha-skill", alphaCtx))!;
    const inBeta = (await fx.service.getSkill("alpha-skill", betaCtx))!;
    assertEquals(inAlpha.id, inBeta.id, "the same content has one revision id");
    await fx.service.ensureRevisions([inAlpha.id], alphaCtx);
    assertEquals(await fx.service.getRevision(inAlpha.id, betaCtx), null, "Beta has not recorded it yet");
    await fx.service.ensureRevisions([inBeta.id], betaCtx);
    assertNotEquals(await fx.service.getRevision(inAlpha.id, betaCtx), null);
    assertNotEquals(await fx.service.getRevision(inAlpha.id, alphaCtx), null);
  } finally {
    await fx.cleanup();
  }
});
