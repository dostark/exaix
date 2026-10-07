/**
 * @module SkillFolderSchemaTest
 * @path packages/schemas/tests/skill_folder_test.ts
 * @description Phase 206 Step 1 — verifies the strict folder schemas. Frontmatter
 *   accepts spec fields and rejects unknown keys. The sidecar rejects identity fields.
 *   The authoring schemas reject managed identity, path, source and status fields.
 *   The runtime view carries no removed counter, UUID or version field.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @exaix/schemas]
 * @related-files [packages/schemas/src/skill_folder.ts, packages/schemas/src/runtime_skill.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  SkillAuthoringSchema,
  SkillAuthoringUpdateSchema,
  SkillFrontmatterSchema,
  SkillSidecarSchema,
} from "@exaix/schemas/skill_folder.ts";
import { RuntimeSkillSchema } from "@exaix/schemas/runtime_skill.ts";
import { SkillStatus } from "@exaix/core";

const VALID_FRONTMATTER = {
  name: "code-review",
  description: "Comprehensive checklist for thorough code reviews",
};

Deno.test("[skill_folder] frontmatter accepts spec fields", () => {
  const parsed = SkillFrontmatterSchema.parse({
    ...VALID_FRONTMATTER,
    license: "MIT",
    compatibility: "works with any agent",
    metadata: { owner: "team" },
    "allowed-tools": ["read"],
  });
  assertEquals(parsed.name, "code-review");
  assertEquals(parsed.metadata?.owner, "team");
});

Deno.test("[skill_folder] frontmatter rejects unknown keys and bad names", () => {
  assertThrows(() => SkillFrontmatterSchema.parse({ ...VALID_FRONTMATTER, compatible_with: { agents: ["*"] } }));
  assertThrows(() => SkillFrontmatterSchema.parse({ name: "Code Review", description: "x" }));
  assertThrows(() => SkillFrontmatterSchema.parse({ name: "code-review" }));
});

Deno.test("[skill_folder] sidecar accepts procedure fields and applies_to", () => {
  const parsed = SkillSidecarSchema.parse({
    title: "Code Review Checklist",
    status: SkillStatus.ACTIVE,
    triggers: { keywords: ["review"] },
    applies_to: { agents: ["senior-coder"] },
    related_skills: ["security-first"],
  });
  assertEquals(parsed.applies_to?.agents, ["senior-coder"]);
});

Deno.test("[skill_folder] sidecar rejects identity and spec-only keys", () => {
  assertThrows(() => SkillSidecarSchema.parse({ name: "code-review" }));
  assertThrows(() => SkillSidecarSchema.parse({ compatible_with: { agents: ["*"] } }));
});

const VALID_AUTHORING = {
  name: "code-review",
  description: "Comprehensive checklist for thorough code reviews",
  instructions: "# Code Review\n\nReview systematically.",
};

Deno.test("[skill_folder] authoring create accepts authorable fields", () => {
  const parsed = SkillAuthoringSchema.parse({ ...VALID_AUTHORING, critical: true, tools: ["git_commit"] });
  assertEquals(parsed.critical, true);
});

Deno.test("[skill_folder] authoring create rejects injected managed fields", () => {
  for (const injected of ["id", "status", "usage_count", "path", "revision_id", "source", "scope"]) {
    assertThrows(() => SkillAuthoringSchema.parse({ ...VALID_AUTHORING, [injected]: "x" }));
  }
});

Deno.test("[skill_folder] authoring update rejects name and accepts partial input", () => {
  assertThrows(() => SkillAuthoringUpdateSchema.parse({ name: "renamed" }));
  const parsed = SkillAuthoringUpdateSchema.parse({ critical: true });
  assertEquals(parsed.critical, true);
});

Deno.test("[skill_folder] runtime view carries no removed counter, UUID or version field", () => {
  const keys = Object.keys(RuntimeSkillSchema.shape);
  for (const removed of ["usage_count", "created_at", "version", "effectiveness_score", "source_id"]) {
    assert(!keys.includes(removed), `runtime view must not expose ${removed}`);
  }
  for (const required of ["title", "references", "root_kind", "content_sha256", "skill_id"]) {
    assert(keys.includes(required), `runtime view must expose ${required}`);
  }
});

Deno.test("[skill_folder] sidecar accepts dogfood related_skills and quality criteria and rejects a non-slug related skill", () => {
  const parsed = SkillSidecarSchema.parse({
    applies_to: { agents: ["general"] },
    related_skills: ["test-development", "exaix-development"],
    quality_criteria: [{ name: "tdd_compliance", description: "Tests first", weight: 40 }],
  });
  assertEquals(parsed.related_skills, ["test-development", "exaix-development"]);
  assertThrows(() => SkillSidecarSchema.parse({ related_skills: ["Not A Slug"] }));
});
