/**
 * @module SkillsServiceMatchTest
 * @path packages/core/tests/skills/skills_service_match_test.ts
 * @description Deterministic keyword fallback for skills without authored triggers and the frozen
 *   confidence arithmetic. Absent triggers synthesize keywords from the name and description, an explicit
 *   empty trigger set disables the fallback, and the match carries the trigger source.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_snapshot.ts, packages/core/src/skills/skills.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MemoryScope, SkillRootKind } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import {
  createSkillOperationContext,
  type ISkillRevisionSnapshot,
  type ISkillsConfig,
  parseSkillSnapshot,
  SkillsService,
} from "@exaix/core/skills";
import { initTestDbService, writeSkillFolder } from "@exaix/testing";
import type { ISkillSidecar } from "@exaix/schemas";

const ROOT_CONTEXT = {
  rootKind: SkillRootKind.BLUEPRINT,
  name: "release-notes",
  path: "release-notes",
  project: null,
  source: "user" as never,
  scope: MemoryScope.GLOBAL,
};

function snapshot(name: string, description: string, exaixYaml: string | null = null): ISkillRevisionSnapshot {
  return {
    skill_md: `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody.\n`,
    exaix_yaml: exaixYaml,
    references: [],
  };
}

async function keywordsOf(name: string, description: string, fallback?: { minWordChars: number; maxKeywords: number }) {
  const skill = await parseSkillSnapshot(
    snapshot(name, description),
    { ...ROOT_CONTEXT, name, path: name },
    fallback,
  );
  return { keywords: skill.triggers.keywords, source: skill.triggers_source };
}

Deno.test("[fallback] name terms come first, then description terms in order without stopwords or short words", async () => {
  const { keywords, source } = await keywordsOf(
    "release-notes",
    "Draft the release notes using the changelog and the commit history, about 2024's v2.",
  );
  assertEquals(keywords, ["release", "notes", "draft", "changelog", "commit", "history", "2024"]);
  assertEquals(source, "description");
});

Deno.test("[fallback] name terms survive the minimum length but description terms need it", async () => {
  const { keywords } = await keywordsOf("qa-tool", "A qa run for web ui");
  assertEquals(keywords, ["qa", "tool"]);
});

Deno.test("[fallback] case, NFKC width forms and repeats collapse to one term", async () => {
  const { keywords } = await keywordsOf("code-review", "ＲＥＶＩＥＷ Review REVIEW code, CODE! Review.");
  assertEquals(keywords, ["code", "review"]);
});

Deno.test("[fallback] non-ASCII words add nothing and punctuation splits words", async () => {
  const { keywords } = await keywordsOf("lint-check", "日本語 コード lint/format_rules; deploy-pipeline");
  assertEquals(keywords, ["lint", "check", "format", "rules", "deploy", "pipeline"]);
});

Deno.test("[fallback] the keyword cap and the minimum word length are operator settings", async () => {
  const description = "alpha bravo charlie delta echo foxtrot golf hotel india";
  const capped = await keywordsOf("tiny", description, { minWordChars: 5, maxKeywords: 3 });
  assertEquals(capped.keywords, ["tiny", "alpha", "bravo"]);
  const defaults = await keywordsOf("tiny", description);
  assertEquals(defaults.keywords, [
    "tiny",
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
    "hotel",
    "india",
  ]);
  const manyWords = Array.from({ length: 40 }, (_, index) => `word${String.fromCharCode(97 + (index % 26))}${index}`);
  assertEquals((await keywordsOf("many", manyWords.join(" "))).keywords?.length, 32);
});

Deno.test("[fallback] a description with no useful words gives an empty keyword list", async () => {
  const { keywords, source } = await keywordsOf("the-and", "the and for with");
  assertEquals(keywords, []);
  assertEquals(source, "description");
});

Deno.test("[fallback] authored and explicitly empty triggers never synthesize", async () => {
  const empty = await parseSkillSnapshot(
    snapshot("empty-skill", "Plenty of useful description words here", "triggers: {}\n"),
    { ...ROOT_CONTEXT, name: "empty-skill", path: "empty-skill" },
  );
  assertEquals(empty.triggers_source, "authored");
  assertEquals(empty.triggers.keywords ?? [], []);
  const authored = await parseSkillSnapshot(
    snapshot("authored-skill", "Plenty of useful description words here", "triggers:\n  keywords: [zebra]\n"),
    { ...ROOT_CONTEXT, name: "authored-skill", path: "authored-skill" },
  );
  assertEquals(authored.triggers.keywords, ["zebra"]);
});

async function fixture(skillsConfig?: Partial<ISkillsConfig>) {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-skills-match-" });
  const blueprintDir = join(base, "Blueprints", "Skills");
  const service = new SkillsService(
    { memoryDir: join(base, "Memory"), blueprintSkillsDir: blueprintDir },
    env.db,
    skillsConfig,
    new EventLogger({ db: env.db }),
  );
  await service.initialize();
  return {
    service,
    blueprintDir,
    ctx: createSkillOperationContext({ agentRole: "reviewer" }),
    seed: (name: string, description: string, sidecar?: ISkillSidecar) =>
      writeSkillFolder(blueprintDir, { name, description, instructions: `${name} body.`, sidecar }),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("[confidence] explicit keywords score 0.5 for one match and 1.0 for two", async () => {
  const fx = await fixture();
  try {
    await fx.seed("pair", "Pair skill", { triggers: { keywords: ["alpha", "beta"] } });
    const one = await fx.service.matchSkills({ keywords: ["alpha"] }, fx.ctx);
    assertAlmostEquals(one.matches.find((m) => m.skillId === "pair")!.confidence, 0.5);
    const two = await fx.service.matchSkills({ keywords: ["alpha", "beta"] }, fx.ctx);
    assertAlmostEquals(two.matches.find((m) => m.skillId === "pair")!.confidence, 1.0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[confidence] request text alone weighs half and explicit plus text matches keep the same scale", async () => {
  const fx = await fixture({ matchThreshold: 0.1 });
  try {
    await fx.seed("pair", "Pair skill", { triggers: { keywords: ["alpha", "beta"] } });
    const textOne = await fx.service.matchSkills({ requestText: "alpha only" }, fx.ctx);
    assertAlmostEquals(textOne.matches.find((m) => m.skillId === "pair")!.confidence, 1 / 6);
    const textTwo = await fx.service.matchSkills({ requestText: "alpha beta" }, fx.ctx);
    assertAlmostEquals(textTwo.matches.find((m) => m.skillId === "pair")!.confidence, 1 / 3);
    const both = await fx.service.matchSkills({ keywords: ["alpha"], requestText: "alpha" }, fx.ctx);
    assertAlmostEquals(both.matches.find((m) => m.skillId === "pair")!.confidence, 0.5);
    const full = await fx.service.matchSkills({ keywords: ["alpha", "beta"], requestText: "alpha beta" }, fx.ctx);
    assertAlmostEquals(full.matches.find((m) => m.skillId === "pair")!.confidence, 1.0);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[threshold] the operator threshold decides whether text-only confidence matches", async () => {
  const strict = await fixture();
  const lax = await fixture({ matchThreshold: 0.1 });
  try {
    for (const fx of [strict, lax]) await fx.seed("pair", "Pair skill", { triggers: { keywords: ["alpha", "beta"] } });
    const request = { requestText: "alpha only" };
    assertEquals(
      (await strict.service.matchSkills(request, strict.ctx)).matches.some((m) => m.skillId === "pair"),
      false,
    );
    assertEquals((await lax.service.matchSkills(request, lax.ctx)).matches.some((m) => m.skillId === "pair"), true);
  } finally {
    await strict.cleanup();
    await lax.cleanup();
  }
});

Deno.test("[fallback] a foreign skill without a sidecar matches on its description with the source named", async () => {
  const fx = await fixture();
  try {
    await fx.seed("changelog-writer", "Compose changelog entries from merged commits");
    const result = await fx.service.matchSkills({ keywords: ["changelog", "commits"] }, fx.ctx);
    const match = result.matches.find((m) => m.skillId === "changelog-writer")!;
    assertAlmostEquals(match.confidence, 1.0);
    assertEquals(match.triggersSource, "description");
    assertEquals(match.matchedTriggers.keywords, ["changelog", "commits"]);
    await fx.seed("explicit-empty", "Compose changelog entries from merged commits", { triggers: {} });
    const none = await fx.service.matchSkills({ keywords: ["changelog", "commits"] }, fx.ctx);
    assertEquals(none.matches.some((m) => m.skillId === "explicit-empty"), false);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[fallback] an authored skill reports its source and a skill with no useful words never matches", async () => {
  const fx = await fixture();
  try {
    await fx.seed("authored", "Authored skill", { triggers: { keywords: ["zebra"] } });
    await fx.seed("the-and", "the and for with");
    const result = await fx.service.matchSkills(
      { keywords: ["zebra", "the", "and"], requestText: "the and for" },
      fx.ctx,
    );
    assertEquals(result.matches.find((m) => m.skillId === "authored")!.triggersSource, "authored");
    assertEquals(result.matches.some((m) => m.skillId === "the-and"), false);
  } finally {
    await fx.cleanup();
  }
});
