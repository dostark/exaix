/**
 * @module SkillsServiceTest
 * @path packages/core/tests/skills/skills_service_test.ts
 * @description Phase 206 Step 3 — SkillsService over skill folders: reads and matching,
 *   portal-scoped roots, the guarded draft lifecycle (create, update, approve, deprecate,
 *   delete), name-collision and input rejection, and real journal events.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { MemoryScope, SkillMutationErrorCode, SkillStatus } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { type ISkillOperationContext, SkillMutationError, SkillsService } from "@exaix/core/skills";
import type { SkillDefinition, SkillUpdates } from "@exaix/schemas/memory_bank.ts";
import type { IActivityRecord } from "@exaix/core/types";
import { castAny, initTestDbService } from "@exaix/testing";

const CTX: ISkillOperationContext = {
  portal: null,
  traceId: "44444444-4444-4444-8444-444444444444",
  requestId: null,
  flowId: null,
  flowStepId: null,
  agentRole: "reviewer",
  configGeneration: "static",
};

const PORTAL_CTX: ISkillOperationContext = { ...CTX, portal: "Alpha" };

function definition(name: string, overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name,
    title: `Title of ${name}`,
    description: `Description of ${name}`,
    instructions: `# ${name}\n\nFollow the procedure.`,
    triggers: { keywords: ["alpha", "beta"] },
    ...overrides,
  };
}

interface IFixture {
  base: string;
  memoryDir: string;
  blueprintDir: string;
  service: SkillsService;
  events: (type: string) => Promise<IActivityRecord[]>;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skills-service-" });
  const memoryDir = join(base, "Memory");
  const blueprintDir = join(base, "Blueprints", "Skills");
  await Deno.mkdir(join(blueprintDir, "shipped-skill"), { recursive: true });
  await Deno.writeTextFile(
    join(blueprintDir, "shipped-skill", "SKILL.md"),
    "---\nname: shipped-skill\ndescription: A shipped skill\n---\n# Shipped\n\nShipped body.\n",
  );
  await Deno.writeTextFile(
    join(blueprintDir, "shipped-skill", "exaix.yaml"),
    "title: Shipped Skill\ntriggers:\n  keywords: [alpha, beta]\n",
  );
  const service = new SkillsService(
    { memoryDir, blueprintSkillsDir: blueprintDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  return {
    base,
    memoryDir,
    blueprintDir,
    service,
    events: async (type) => {
      await env.db.waitForFlush();
      return await env.db.getActivitiesByActionTypeSafe(type);
    },
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

async function folderBytes(dir: string): Promise<string> {
  const parts: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) parts.push(entry.name, await folderBytes(join(dir, entry.name)));
    else parts.push(entry.name, await Deno.readTextFile(join(dir, entry.name)));
  }
  return parts.join("\u0000");
}

Deno.test("[service] getSkill and listSkills read Blueprint skill folders and write nothing", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const before = await folderBytes(fx.blueprintDir);
    const skill = await fx.service.getSkill("shipped-skill");
    assertEquals(skill?.title, "Shipped Skill");
    assertEquals(skill?.status, SkillStatus.ACTIVE);
    assertEquals(skill?.scope, MemoryScope.GLOBAL);
    assertEquals((await fx.service.listSkills()).map((s) => s.name), ["shipped-skill"]);
    assertEquals(await fx.service.getSkill("absent-skill"), null);
    assertEquals(await folderBytes(fx.blueprintDir), before);
    assertEquals(await Deno.stat(join(fx.memoryDir, "Skills", "index.json")).catch(() => null), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] matchSkills keeps the keyword saturation arithmetic and returns the revision", async () => {
  const fx = await fixture();
  try {
    const one = await fx.service.matchSkills({ keywords: ["alpha"] });
    assertEquals(one.matches.length, 1);
    assertEquals(one.matches[0].skillId, "shipped-skill");
    assertEquals(one.matches[0].revisionId, (await fx.service.getSkill("shipped-skill"))?.id);
    assertEquals(one.matches[0].confidence, 0.5);
    const two = await fx.service.matchSkills({ keywords: ["alpha", "beta"] });
    assertEquals(two.matches[0].confidence, 1);
    assertEquals((await fx.service.matchSkills({ keywords: ["unrelated"] })).matches, []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] createSkill publishes a draft folder that is hidden from matching until approved", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const created = await fx.service.createSkill(definition("fresh-skill"), CTX);
    assertEquals(created.status, SkillStatus.DRAFT);
    assertEquals(created.source, "learned");
    assertEquals(await fx.service.getSkill("fresh-skill"), null);
    assertEquals((await fx.service.listSkills({ status: SkillStatus.DRAFT })).map((s) => s.name), ["fresh-skill"]);
    assertEquals((await fx.service.matchSkills({ keywords: ["alpha", "beta"] })).matches.map((m) => m.skillId), [
      "shipped-skill",
    ]);
    const sidecar = await Deno.readTextFile(join(fx.memoryDir, "Skills", "learned", "fresh-skill", "exaix.yaml"));
    assertEquals(sidecar.includes("status: draft"), true);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] approve requires the reviewed revision, activates it and makes it matchable", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const draft = await fx.service.createSkill(definition("fresh-skill"), CTX);
    const stale = await assertRejects(
      () => fx.service.approveSkill("fresh-skill", "00000000-0000-5000-8000-000000000000", CTX),
      SkillMutationError,
    );
    assertEquals(stale.code, SkillMutationErrorCode.REVISION_MISMATCH);
    const approved = await fx.service.approveSkill("fresh-skill", draft.id, CTX);
    assertEquals(approved.status, SkillStatus.ACTIVE);
    assertEquals(approved.id === draft.id, false, "approval changes the revision");
    assertEquals((await fx.service.getSkill("fresh-skill"))?.id, approved.id);
    const again = await assertRejects(
      () => fx.service.approveSkill("fresh-skill", approved.id, CTX),
      SkillMutationError,
    );
    assertEquals(again.code, SkillMutationErrorCode.INVALID_TRANSITION);
    const events = await fx.events(DomainEventType.SkillsApproved);
    const payload = JSON.parse(events[0].payload);
    assertEquals(payload.reviewed_revision_id, draft.id);
    assertEquals(payload.active_revision_id, approved.id);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] updating an active skill returns it to draft and invalidates the approval", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const draft = await fx.service.createSkill(definition("fresh-skill"), CTX);
    const active = await fx.service.approveSkill("fresh-skill", draft.id, CTX);
    const updated = await fx.service.updateSkill("fresh-skill", { instructions: "# fresh\n\nNew body." }, CTX);
    assertEquals(updated?.status, SkillStatus.DRAFT);
    assertEquals(updated?.instructions, "# fresh\n\nNew body.");
    assertEquals(await fx.service.getSkill("fresh-skill"), null);
    const events = await fx.events(DomainEventType.SkillsUpdated);
    assertEquals(JSON.parse(events[0].payload).previous_revision_id, active.id);
    assertEquals(await fx.service.updateSkill("missing-skill", { description: "x" }, CTX), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] an examples update replaces the examples section instead of leaving a stale one", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    await fx.service.createSkill(definition("fresh-skill", { examples: "first example" }), CTX);
    const updated = await fx.service.updateSkill("fresh-skill", { examples: "second example" }, CTX);
    assertEquals(updated?.examples, "second example");
    assertEquals(updated?.instructions.includes("first example"), false);
    assertEquals((updated?.instructions.match(/## Examples/g) ?? []).length, 1);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] deprecate is idempotent and update keeps a deprecated skill deprecated", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const draft = await fx.service.createSkill(definition("fresh-skill"), CTX);
    await fx.service.approveSkill("fresh-skill", draft.id, CTX);
    const first = await fx.service.deprecateSkill("fresh-skill", CTX);
    const second = await fx.service.deprecateSkill("fresh-skill", CTX);
    assertEquals(first.status, SkillStatus.DEPRECATED);
    assertEquals(second.id, first.id);
    assertEquals((await fx.events(DomainEventType.SkillsDeprecated)).length, 1);
    const updated = await fx.service.updateSkill("fresh-skill", { description: "changed" }, CTX);
    assertEquals(updated?.status, SkillStatus.DEPRECATED);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] deleteSkill removes a writable skill folder and refuses a read-only one", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    await fx.service.createSkill(definition("fresh-skill"), CTX);
    assertEquals(await fx.service.deleteSkill("fresh-skill", CTX), true);
    assertEquals(await Deno.stat(join(fx.memoryDir, "Skills", "learned", "fresh-skill")).catch(() => null), null);
    assertEquals(await fx.service.deleteSkill("fresh-skill", CTX), false);
    const refused = await assertRejects(() => fx.service.deleteSkill("shipped-skill", CTX), SkillMutationError);
    assertEquals(refused.code, SkillMutationErrorCode.ROOT_UNAVAILABLE);
    assertEquals((await fx.service.getSkill("shipped-skill"))?.name, "shipped-skill");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] create refuses an existing name from any root and rejects managed or invalid input", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const conflict = await assertRejects(
      () => fx.service.createSkill(definition("shipped-skill"), CTX),
      SkillMutationError,
    );
    assertEquals(conflict.code, SkillMutationErrorCode.NAME_CONFLICT);
    const injected = castAny<SkillDefinition>({ ...definition("other-skill"), status: "active" });
    const rejected = await assertRejects(() => fx.service.createSkill(injected, CTX), SkillMutationError);
    assertEquals(rejected.code, SkillMutationErrorCode.INVALID_INPUT);
    const badName = await assertRejects(() => fx.service.createSkill(definition("Bad Name"), CTX), SkillMutationError);
    assertEquals(badName.code, SkillMutationErrorCode.INVALID_INPUT);
    const failures = await fx.events(DomainEventType.SkillsMutationFailed);
    assertEquals(failures.length, 3);
    assertEquals(JSON.parse(failures[0].payload).operation, "create");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] update rejects managed and identity fields", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    await fx.service.createSkill(definition("fresh-skill"), CTX);
    for (const injected of [{ status: "active" }, { name: "renamed" }, { id: "x" }, { path: "/etc" }]) {
      const error = await assertRejects(
        () => fx.service.updateSkill("fresh-skill", castAny<SkillUpdates>(injected), CTX),
        SkillMutationError,
      );
      assertEquals(error.code, SkillMutationErrorCode.INVALID_INPUT);
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] derive attaches the learning ids to a draft and journals skill.derived", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const derived = await fx.service.deriveSkillFromLearnings(
      ["learning-1", "learning-2"],
      definition("derived-skill"),
      CTX,
    );
    assertEquals(derived.derived_from, ["learning-1", "learning-2"]);
    assertEquals(derived.status, SkillStatus.DRAFT);
    const events = await fx.events(DomainEventType.SkillsDerived);
    assertEquals(JSON.parse(events[0].payload).learning_ids, ["learning-1", "learning-2"]);
    assertEquals(events[0].trace_id, CTX.traceId);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] project skills are visible only to their portal and never to global-only reads", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const alpha = await fx.service.createSkill(definition("alpha-skill"), PORTAL_CTX);
    assertEquals(alpha.scope, MemoryScope.PROJECT);
    assertEquals(alpha.project, "Alpha");
    await fx.service.approveSkill("alpha-skill", alpha.id, PORTAL_CTX);
    assertEquals((await fx.service.getSkill("alpha-skill", PORTAL_CTX))?.project, "Alpha");
    assertEquals(await fx.service.getSkill("alpha-skill"), null, "global-only read cannot see a project skill");
    assertEquals(await fx.service.getSkill("alpha-skill", { ...CTX, portal: "Beta" }), null);
    assertEquals(
      await Deno.stat(join(fx.memoryDir, "Skills", "project", "Alpha", "alpha-skill")).then(() => true),
      true,
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[security] a portal name that is not a plain name is refused before any filesystem access", async () => {
  const fx = await fixture();
  try {
    for (const portal of ["../escape", "a/b", "", ".hidden"]) {
      const error = await assertRejects(
        () => fx.service.createSkill(definition("fresh-skill"), { ...CTX, portal }),
        SkillMutationError,
      );
      assertEquals(error.code, SkillMutationErrorCode.INVALID_INPUT);
    }
    assertEquals(await Deno.stat(join(fx.memoryDir, "Skills", "project")).catch(() => null), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] the eval overlay root takes precedence over the Blueprint skill for one resolution", async () => {
  const fx = await fixture();
  const overlay = join(fx.base, "overlay");
  await Deno.mkdir(join(overlay, "shipped-skill"), { recursive: true });
  await Deno.writeTextFile(
    join(overlay, "shipped-skill", "SKILL.md"),
    "---\nname: shipped-skill\ndescription: Overlay version\n---\nOverlay body.\n",
  );
  try {
    Deno.env.set("EXA_EVAL_SKILL_OVERLAY_DIR", overlay);
    assertEquals((await fx.service.getSkill("shipped-skill"))?.instructions, "Overlay body.");
  } finally {
    Deno.env.delete("EXA_EVAL_SKILL_OVERLAY_DIR");
    await fx.cleanup();
  }
  assertEquals(true, true);
});

Deno.test("[service] initialize journals readiness and recovers an interrupted publication", async () => {
  const fx = await fixture();
  try {
    const stateDir = join(fx.memoryDir, "Skills", "learned", ".exa-skill-state");
    await Deno.mkdir(join(stateDir, "intents"), { recursive: true });
    await Deno.mkdir(join(stateDir, "staging", "op"), { recursive: true });
    await Deno.writeTextFile(
      join(stateDir, "intents", "op.json"),
      JSON.stringify({
        operation: "create",
        name: "half-skill",
        destination: join(fx.memoryDir, "Skills", "learned", "half-skill"),
        staging: join(stateDir, "staging", "op"),
        backup: null,
        intended_sha256: "0".repeat(64),
      }),
    );
    await fx.service.initialize();
    const events = await fx.events(DomainEventType.SkillsInitialized);
    const payload = JSON.parse(events[0].payload);
    assertEquals(payload.outcome, "ready");
    assertEquals(payload.recovered_operations, 1);
    assertEquals(await Deno.stat(join(stateDir, "staging", "op")).catch(() => null), null);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[service] concurrent creates of one name yield exactly one draft", async () => {
  const fx = await fixture();
  try {
    await fx.service.initialize();
    const results = await Promise.allSettled([
      fx.service.createSkill(definition("race-skill"), CTX),
      fx.service.createSkill(definition("race-skill"), CTX),
      fx.service.createSkill(definition("race-skill"), CTX),
    ]);
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
    assertEquals((await fx.service.listSkills({ status: SkillStatus.DRAFT })).length, 1);
  } finally {
    await fx.cleanup();
  }
});
