/**
 * @module SkillsServiceLearnedTest
 * @path packages/core/tests/skills/skills_service_learned_test.ts
 * @description The reviewed draft lifecycle of learned skills and the historical revision reads.
 *   A folder imported without a sidecar stays a draft, status and managed fields cannot be injected,
 *   approval and its activate alias need the exact reviewed revision, a deprecated skill needs a fresh
 *   review, content updates return to draft, read-only roots refuse mutation, and stored revisions stay
 *   readable after the current folder is deleted without ever granting injection authority.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, packages/core/src/skills/skill_revision_store.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SkillMutationErrorCode, SkillStatus } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import {
  createSkillOperationContext,
  type ISkillOperationContext,
  SkillMutationError,
  SkillsService,
  SkillUnavailableError,
} from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

async function fixture() {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skills-learned-" });
  const memoryDir = join(base, "Memory");
  const blueprintDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(blueprintDir, { name: "shipped", instructions: "Shipped body." });
  const service = new SkillsService(
    { memoryDir, blueprintSkillsDir: blueprintDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await service.initialize();
  const ctx = createSkillOperationContext({ agentRole: "reviewer" });
  return {
    env,
    service,
    ctx,
    learnedDir: join(memoryDir, "Skills", "learned"),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await assertRejects(() => promise, SkillMutationError);
  return error.code;
}

async function drafted(fx: Fixture, name: string) {
  const created = await fx.service.createSkill({ name, description: "d", instructions: "Body one." }, fx.ctx);
  assertEquals(created.status, SkillStatus.DRAFT);
  return created;
}

Deno.test("[learned] a folder imported without a sidecar is a draft that is never matched", async () => {
  const fx = await fixture();
  try {
    await writeSkillFolder(fx.learnedDir, { name: "imported", instructions: "Imported body." });
    const listed = await fx.service.listSkills({ status: SkillStatus.DRAFT }, fx.ctx);
    assertEquals(listed.map((skill) => skill.name), ["imported"]);
    assertEquals(await fx.service.getSkill("imported", fx.ctx), null);
    const { matches } = await fx.service.matchSkills({ requestText: "imported body", keywords: ["imported"] }, fx.ctx);
    assertEquals(matches.some((match) => match.skillId === "imported"), false);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[learned] status and managed fields cannot be injected through create or update", async () => {
  const fx = await fixture();
  try {
    for (const injected of [{ status: SkillStatus.ACTIVE }, { id: "x" }, { source: "core" }, { usage_count: 9 }]) {
      assertEquals(
        await codeOf(
          fx.service.createSkill({ name: "inject", description: "d", instructions: "i", ...injected } as never, fx.ctx),
        ),
        SkillMutationErrorCode.INVALID_INPUT,
      );
    }
    await drafted(fx, "plain");
    assertEquals(
      await codeOf(
        fx.service.updateSkill("plain", { status: SkillStatus.ACTIVE } as never, fx.ctx) as Promise<unknown>,
      ),
      SkillMutationErrorCode.INVALID_INPUT,
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[learned] approve and its activate alias need the exact reviewed revision", async () => {
  const fx = await fixture();
  try {
    const first = await drafted(fx, "reviewed");
    await fx.service.updateSkill("reviewed", { instructions: "Body two." }, fx.ctx);
    assertEquals(
      await codeOf(fx.service.approveSkill("reviewed", first.id, fx.ctx)),
      SkillMutationErrorCode.REVISION_MISMATCH,
      "a draft changed after review cannot be approved by the old revision",
    );
    assertEquals(
      await codeOf(fx.service.activateSkill("reviewed", first.id, fx.ctx)),
      SkillMutationErrorCode.REVISION_MISMATCH,
    );
    const current = (await fx.service.listSkills({ status: SkillStatus.DRAFT }, fx.ctx)).find((skill) =>
      skill.name === "reviewed"
    )!;
    const active = await fx.service.activateSkill("reviewed", current.id, fx.ctx);
    assertEquals(active.status, SkillStatus.ACTIVE);
    assertEquals(
      await codeOf(fx.service.approveSkill("reviewed", active.id, fx.ctx)),
      SkillMutationErrorCode.INVALID_TRANSITION,
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[learned] a deprecated skill needs a fresh review and content updates return an approved skill to draft", async () => {
  const fx = await fixture();
  try {
    const created = await drafted(fx, "cycle");
    const active = await fx.service.approveSkill("cycle", created.id, fx.ctx);
    const deprecated = await fx.service.deprecateSkill("cycle", fx.ctx);
    assertEquals(deprecated.status, SkillStatus.DEPRECATED);
    assertEquals(await fx.service.getSkill("cycle", fx.ctx), null, "a deprecated skill is not active");
    assertEquals(
      await codeOf(fx.service.approveSkill("cycle", active.id, fx.ctx)),
      SkillMutationErrorCode.REVISION_MISMATCH,
      "the old active revision no longer matches",
    );
    const reapproved = await fx.service.approveSkill("cycle", deprecated.id, fx.ctx);
    assertEquals(reapproved.status, SkillStatus.ACTIVE);
    const edited = await fx.service.updateSkill("cycle", { instructions: "Changed." }, fx.ctx);
    assertEquals(edited?.status, SkillStatus.DRAFT);
    assertEquals(await fx.service.getSkill("cycle", fx.ctx), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[learned] a skill in a read-only root cannot be updated, approved or deleted", async () => {
  const fx = await fixture();
  try {
    const shipped = await fx.service.getSkill("shipped", fx.ctx);
    assert(shipped);
    assertEquals(
      await codeOf(fx.service.updateSkill("shipped", { instructions: "x" }, fx.ctx) as Promise<unknown>),
      SkillMutationErrorCode.ROOT_UNAVAILABLE,
    );
    assertEquals(await codeOf(fx.service.deprecateSkill("shipped", fx.ctx)), SkillMutationErrorCode.ROOT_UNAVAILABLE);
    assertEquals(
      await codeOf(fx.service.deleteSkill("shipped", fx.ctx) as Promise<unknown>),
      SkillMutationErrorCode.ROOT_UNAVAILABLE,
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[revisions] stored revisions stay readable after the folder is deleted and never grant injection", async () => {
  const fx = await fixture();
  try {
    const created = await drafted(fx, "history");
    const active = await fx.service.approveSkill("history", created.id, fx.ctx);
    const live = await fx.service.getSkill("history", fx.ctx);
    assertEquals(live?.id, active.id);
    await fx.service.ensureRevisions([active.id], fx.ctx);
    assertEquals(await fx.service.deleteSkill("history", fx.ctx), true);

    const stored = await fx.service.getRevision(active.id, fx.ctx);
    assertEquals(stored?.skillName, "history");
    assert(stored?.snapshot.skill_md.includes("Body one."));
    assertEquals((await fx.service.listRevisions("history", fx.ctx)).map((record) => record.revisionId), [active.id]);
    assertEquals(await fx.service.getSkill("history", fx.ctx), null, "a deleted skill is not injectable");
    assertEquals(await fx.service.getRevision(crypto.randomUUID(), fx.ctx), null);
    assertEquals(await fx.service.getRevision("not-a-uuid", fx.ctx), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[revisions] a corrupt stored revision fails closed instead of returning content", async () => {
  const fx = await fixture();
  try {
    const created = await drafted(fx, "corrupt");
    await fx.service.listSkills(undefined, fx.ctx);
    await fx.service.ensureRevisions([created.id], fx.ctx);
    await fx.env.db.preparedRun("UPDATE skill_revisions SET skill_md = ? WHERE revision_id = ?", [
      "tampered",
      created.id,
    ]);
    await assertRejects(() => fx.service.getRevision(created.id, fx.ctx), SkillUnavailableError);
    await assertRejects(() => fx.service.listRevisions("corrupt", fx.ctx), SkillUnavailableError);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[learned] a read with another portal's context never reaches a project draft", async () => {
  const fx = await fixture();
  try {
    const alpha: ISkillOperationContext = createSkillOperationContext({ agentRole: "reviewer", portal: "Alpha" });
    await fx.service.createSkill({ name: "alpha-draft", description: "d", instructions: "Alpha." }, alpha);
    const beta = createSkillOperationContext({ agentRole: "reviewer", portal: "Beta" });
    assertEquals((await fx.service.listSkills(undefined, beta)).some((skill) => skill.name === "alpha-draft"), false);
    assertEquals((await fx.service.listSkills(undefined, alpha)).some((skill) => skill.name === "alpha-draft"), true);
  } finally {
    await fx.cleanup();
  }
});
