/**
 * @module SkillPinsTest
 * @path packages/core/tests/skills/skill_pins_test.ts
 * @description Verifies pin construction, ordering and `resolvePinned`. A pin replays the
 *   snapshot of its revision even after a live edit. Swapped names, wrong digests, unknown
 *   revisions, foreign portals, duplicates and corrupt rows all fail closed with
 *   `skill_unavailable` and never fall through to live files.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_pins.ts, packages/core/src/skills/skills.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind, SkillStatus } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import {
  buildSkillPin,
  createSkillOperationContext,
  type ISkillPin,
  orderSkillPins,
  SkillsService,
  SkillUnavailableError,
} from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";

const ACTIVE = { status: SkillStatus.ACTIVE };

async function fixture() {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skill-pins-" });
  const memoryDir = join(base, "Memory");
  const blueprintDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(blueprintDir, { name: "shared-skill", instructions: "Body A." });
  await writeSkillFolder(join(memoryDir, "Skills", "project", "Alpha"), {
    name: "alpha-skill",
    instructions: "Alpha A.",
    sidecar: ACTIVE,
  });
  const service = new SkillsService(
    { memoryDir, blueprintSkillsDir: blueprintDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  const ctx = createSkillOperationContext({ agentRole: "test", portal: "Alpha", traceId: "trace-pins" });
  return {
    service,
    ctx,
    blueprintDir,
    db: env.db,
    async pinFor(name: string, overrides: Partial<ISkillPin> = {}): Promise<ISkillPin> {
      const skill = await service.getSkill(name, ctx);
      await service.ensureRevisions([skill!.id], ctx);
      return {
        ...buildSkillPin(
          {
            skillId: skill!.skill_id,
            revisionId: skill!.id,
            contentSha256: skill!.content_sha256,
            rootKind: skill!.root_kind,
            sourcePath: skill!.path,
            source: SkillMatchSource.MATCHED,
            confidence: 0.7,
            matchedTriggers: { task_types: ["code_review"] },
            critical: false,
          },
          {
            portal: skill!.root_kind === SkillRootKind.PROJECT ? ctx.portal : null,
            renderMode: SkillRenderOutcome.FULL,
            contentIncluded: true,
          },
        ),
        ...overrides,
      };
    },
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("[pins] buildSkillPin records provenance and orderSkillPins sorts by confidence then name", async () => {
  const fx = await fixture();
  try {
    const shared = await fx.pinFor("shared-skill");
    const alpha = await fx.pinFor("alpha-skill", { confidence: 0.7 });
    assertEquals(shared.portal, null);
    assertEquals(alpha.portal, "Alpha");
    assertEquals(shared.matched_task_types, ["code_review"]);
    assertEquals(shared.required, false);
    const high = { ...shared, name: "zeta-skill", confidence: 0.9 };
    assertEquals(orderSkillPins([shared, high, alpha]).map((pin) => pin.name), [
      "zeta-skill",
      "alpha-skill",
      "shared-skill",
    ]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] a pin is required only when the request named the skill", async () => {
  const fx = await fixture();
  try {
    const skill = await fx.service.getSkill("shared-skill", fx.ctx);
    const pin = buildSkillPin(
      {
        skillId: "shared-skill",
        revisionId: skill!.id,
        contentSha256: skill!.content_sha256,
        rootKind: skill!.root_kind,
        sourcePath: skill!.path,
        source: SkillMatchSource.PINNED,
        confidence: 1,
        matchedTriggers: {},
        critical: false,
      },
      { portal: null, renderMode: SkillRenderOutcome.FULL, contentIncluded: false },
    );
    assertEquals([pin.required, pin.content_included], [true, false]);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] resolvePinned replays the pinned snapshot after a live edit, in pin order", async () => {
  const fx = await fixture();
  try {
    const shared = await fx.pinFor("shared-skill");
    const alpha = await fx.pinFor("alpha-skill");
    await writeSkillFolder(fx.blueprintDir, { name: "shared-skill", instructions: "Body B." });
    const resolved = await fx.service.resolvePinned([alpha, shared], fx.ctx);
    assertEquals(resolved.map((entry) => entry.pin.name), ["alpha-skill", "shared-skill"]);
    assertEquals(resolved[1].loaded.skill.instructions, "Body A.");
    assertEquals(resolved[1].loaded.revisionId, shared.revision_id);
    assertEquals((await fx.service.getSkill("shared-skill", fx.ctx))?.instructions, "Body B.");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] a pin whose content was excluded still resolves for metadata", async () => {
  const fx = await fixture();
  try {
    const pin = await fx.pinFor("shared-skill", { content_included: false });
    const resolved = await fx.service.resolvePinned([pin], fx.ctx);
    assertEquals(resolved[0].pin.content_included, false);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] an empty vector resolves to nothing", async () => {
  const fx = await fixture();
  try {
    assertEquals(await fx.service.resolvePinned([], fx.ctx), []);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins][security] swapped name, digest, unknown revision and foreign portal fail closed", async () => {
  const fx = await fixture();
  try {
    const shared = await fx.pinFor("shared-skill");
    const alpha = await fx.pinFor("alpha-skill");
    const other = createSkillOperationContext({ agentRole: "test", portal: "Beta" });
    const cases: Array<[string, ISkillPin[], typeof fx.ctx]> = [
      ["swapped name", [{ ...shared, name: "alpha-skill" }], fx.ctx],
      ["wrong digest", [{ ...shared, content_sha256: "b".repeat(64) }], fx.ctx],
      ["unknown revision", [{ ...shared, revision_id: crypto.randomUUID() }], fx.ctx],
      ["foreign portal", [alpha], other],
      ["project pin without portal", [{ ...alpha, portal: null }], fx.ctx],
      ["duplicate names", [shared, shared], fx.ctx],
      ["malformed pin", [{ ...shared, confidence: 7 }], fx.ctx],
    ];
    for (const [label, pins, ctx] of cases) {
      const error = await assertRejects(() => fx.service.resolvePinned(pins, ctx), SkillUnavailableError, "", label);
      assertEquals(error.code, "skill_unavailable", label);
    }
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins][security] a corrupt stored snapshot fails closed instead of using live files", async () => {
  const fx = await fixture();
  try {
    const shared = await fx.pinFor("shared-skill");
    await fx.db.preparedRun("UPDATE skill_revisions SET skill_md = ? WHERE revision_id = ?", [
      "tampered",
      shared.revision_id,
    ]);
    await assertRejects(() => fx.service.resolvePinned([shared], fx.ctx), SkillUnavailableError);
  } finally {
    await fx.cleanup();
  }
});
