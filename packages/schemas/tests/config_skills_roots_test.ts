/**
 * @module ConfigSkillsRootsTest
 * @path packages/schemas/tests/config_skills_roots_test.ts
 * @description Verifies the ConfigSchema `skills` table: an omitted table and a partial table fill
 *   every default, ordered `roots` entries keep their order and an empty list stays empty, all
 *   resource caps parse with their bounds, and malformed root entries are rejected.
 * @architectural-layer Schemas
 * @dependencies [@std/assert, @exaix/schemas, @exaix/core]
 * @related-files [packages/schemas/src/config.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals, assertFalse } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import {
  DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS,
  DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS,
  DEFAULT_SKILL_MAIN_MAX_BYTES,
  DEFAULT_SKILL_REFERENCE_MAX_CHARS,
  ExaPathDefaults,
  SkillRootKind,
} from "@exaix/core";

function base(skills?: object) {
  return { system: { root: "/tmp" }, paths: { ...ExaPathDefaults }, ...(skills ? { skills } : {}) };
}

Deno.test("[skills config] an omitted table fills every cap and leaves roots unset", () => {
  const skills = ConfigSchema.parse(base()).skills;
  assertEquals(skills.roots, undefined);
  assertEquals(skills.main_max_bytes, DEFAULT_SKILL_MAIN_MAX_BYTES);
  assertEquals(skills.sidecar_max_bytes, 65_536);
  assertEquals(skills.reference_max_bytes, 65_536);
  assertEquals(skills.reference_max_chars, DEFAULT_SKILL_REFERENCE_MAX_CHARS);
  assertEquals(skills.reference_max_count, 16);
  assertEquals(skills.reference_total_max_bytes, 262_144);
  assertEquals(skills.snapshot_max_bytes, 524_288);
  assertEquals(skills.fallback_min_word_chars, DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS);
  assertEquals(skills.fallback_max_keywords, DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS);
});

Deno.test("[skills config] a partial table keeps the other defaults", () => {
  const skills = ConfigSchema.parse(base({ max_per_request: 3, main_max_bytes: 2048 })).skills;
  assertEquals(skills.max_per_request, 3);
  assertEquals(skills.main_max_bytes, 2048);
  assertEquals(skills.sidecar_max_bytes, 65_536);
  assertEquals(skills.match_threshold, 0.3);
});

Deno.test("[skills config] ordered roots keep their order and an empty list stays empty", () => {
  const roots = [
    { kind: SkillRootKind.DOGFOOD, path: "/opt/work/.copilot/skills" },
    { kind: SkillRootKind.PROJECT, path: "Memory/Skills/project" },
    { kind: SkillRootKind.LEARNED, path: "Memory/Skills/learned" },
    { kind: SkillRootKind.BLUEPRINT, path: "Blueprints/Skills" },
  ];
  assertEquals(ConfigSchema.parse(base({ roots })).skills.roots, roots);
  assertEquals(ConfigSchema.parse(base({ roots: [] })).skills.roots, []);
});

Deno.test("[skills config] malformed roots and out-of-range caps are rejected", () => {
  const bad = [
    { roots: [{ kind: "elsewhere", path: "x" }] },
    { roots: [{ kind: SkillRootKind.LEARNED }] },
    { roots: [{ kind: SkillRootKind.LEARNED, path: "" }] },
    { roots: [{ kind: SkillRootKind.EVAL_OVERLAY, path: "x" }] },
    { roots: [{ kind: SkillRootKind.LEARNED, path: "x", extra: true }] },
    { roots: "Blueprints/Skills" },
    { main_max_bytes: 10 },
    { reference_max_count: -1 },
    { fallback_max_keywords: 0 },
  ];
  for (const skills of bad) assertFalse(ConfigSchema.safeParse(base(skills)).success, JSON.stringify(skills));
});
