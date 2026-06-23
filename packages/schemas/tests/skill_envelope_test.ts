/**
 * @module SkillEnvelopeTest
 * @path packages/schemas/tests/skill_envelope_test.ts
 * @description Phase 125 Step 1 — verifies SkillEnvelopeSchema parses valid
 *   SKILL.md frontmatter + exaix blocks, accepts string-typed scope (GAP-9),
 *   and produces output compatible with SkillSchema composition.
 * @architectural-layer Unit
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/skill_envelope.ts, packages/schemas/src/memory_bank.ts]
 */

import { assertEquals } from "@std/assert";
import { SkillEnvelopeSchema } from "@exaix/schemas/skill_envelope.ts";
import { SkillQualityCriterionSchema, SkillSchema, SkillTriggersSchema } from "@exaix/schemas/memory_bank.ts";

Deno.test("[skill_envelope] parses valid SKILL.md frontmatter + exaix block", () => {
  const input = {
    name: "Fix Bugs",
    description: "Skill for systematic bug fixing",
    version: "1.0.0",
    scope: "dev",
    agent: "senior-coder",
    tools: ["git", "test"],
    skill_id: "fix-bugs",
    triggers: {
      keywords: ["bug", "fix"],
      task_types: ["bugfix"],
      file_patterns: ["**/*.ts"],
      tags: ["testing"],
    },
    constraints: ["Always write tests first"],
    output_requirements: ["Must include test file"],
    quality_criteria: [
      { name: "test_coverage", description: "Tests cover the fix", weight: 80 },
    ],
  };

  const result = SkillEnvelopeSchema.safeParse(input);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.name, "Fix Bugs");
    assertEquals(result.data.skill_id, "fix-bugs");
    assertEquals(result.data.scope, "dev");
    assertEquals(result.data.agent, "senior-coder");
    assertEquals(result.data.tools?.length, 2);
    assertEquals(result.data.triggers?.keywords?.length, 2);
    assertEquals(result.data.quality_criteria?.length, 1);
  }
});

Deno.test("[skill_envelope] exaix block triggers and quality_criteria match runtime shape", () => {
  const envelopeResult = SkillEnvelopeSchema.safeParse({
    name: "test",
    skill_id: "test-skill",
    triggers: { keywords: ["test"] },
    quality_criteria: [{ name: "quality", weight: 50 }],
  });

  assertEquals(envelopeResult.success, true);
  if (!envelopeResult.success) return;

  const { triggers, quality_criteria } = envelopeResult.data;

  const triggersSafe = SkillTriggersSchema.safeParse(triggers);
  assertEquals(triggersSafe.success, true, "envelope triggers must satisfy SkillTriggersSchema");

  if (quality_criteria) {
    for (const qc of quality_criteria) {
      const qcSafe = SkillQualityCriterionSchema.safeParse(qc);
      assertEquals(qcSafe.success, true, "each quality_criterion must satisfy SkillQualityCriterionSchema");
    }
  }
});

Deno.test("[skill_envelope] scope accepts any string, defaults to global", () => {
  {
    const result = SkillEnvelopeSchema.safeParse({
      name: "test",
      skill_id: "test-skill",
      scope: "dev",
    });
    assertEquals(result.success, true);
    if (result.success) assertEquals(result.data.scope, "dev");
  }

  {
    const result = SkillEnvelopeSchema.safeParse({
      name: "test",
      skill_id: "test-skill",
      scope: "",
    });
    assertEquals(result.success, true);
    if (result.success) assertEquals(result.data.scope, "");
  }

  {
    const result = SkillEnvelopeSchema.safeParse({
      name: "test",
      skill_id: "test-skill",
    });
    assertEquals(result.success, true);
    if (result.success) assertEquals(result.data.scope, "global");
  }

  {
    const result = SkillEnvelopeSchema.safeParse({
      name: "test",
      skill_id: "test-skill",
      scope: 42,
    });
    assertEquals(result.success, false, "scope must be a string, not number");
  }
});

Deno.test("[skill_envelope] envelope + body + managed fields satisfies full SkillSchema", () => {
  const envelope = {
    name: "Test Skill",
    description: "A test skill description",
    version: "1.0.0",
    scope: "global",
    agent: "senior-coder",
    tools: ["deno"],
    skill_id: "test-skill",
    triggers: { keywords: ["test"] },
    constraints: ["Must be tested"],
    output_requirements: ["Must pass CI"],
    quality_criteria: [{ name: "ci_pass", weight: 100 }],
  };

  const result = SkillEnvelopeSchema.safeParse(envelope);
  assertEquals(result.success, true);
  if (!result.success) return;

  const { success: triggersMatch } = SkillTriggersSchema.safeParse(result.data.triggers);
  assertEquals(triggersMatch, true);

  const composedSkill = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: "core" as const,
    scope: result.data.scope,
    status: "active" as const,
    skill_id: result.data.skill_id,
    name: result.data.name,
    version: result.data.version,
    description: result.data.description ?? "",
    triggers: result.data.triggers ?? {},
    instructions: "This is the body of the skill with at least ten characters.",
    constraints: result.data.constraints,
    output_requirements: result.data.output_requirements,
    quality_criteria: result.data.quality_criteria,
    compatible_with: {
      agents: [result.data.agent ?? "*"],
    },
    usage_count: 0,
  };

  const skillResult = SkillSchema.safeParse(composedSkill);
  assertEquals(skillResult.success, true, "composed envelope + body + managed fields must satisfy SkillSchema");
  if (skillResult.success) {
    assertEquals(skillResult.data.skill_id, "test-skill");
    assertEquals(skillResult.data.name, "Test Skill");
    assertEquals(skillResult.data.scope, "global");
  }
});

Deno.test("[skill_envelope] rejects missing name", () => {
  const result = SkillEnvelopeSchema.safeParse({
    skill_id: "test",
  });
  assertEquals(result.success, false);
});

Deno.test("[skill_envelope] rejects missing skill_id", () => {
  const result = SkillEnvelopeSchema.safeParse({
    name: "test",
  });
  assertEquals(result.success, false);
});

Deno.test("[skill_envelope] rejects invalid version format", () => {
  const result = SkillEnvelopeSchema.safeParse({
    name: "test",
    skill_id: "test",
    version: "bad-version",
  });
  assertEquals(result.success, false);
});

Deno.test("[skill_envelope] rejects non-array triggers.keywords", () => {
  const result = SkillEnvelopeSchema.safeParse({
    name: "test",
    skill_id: "test",
    triggers: { keywords: "not-an-array" },
  });
  assertEquals(result.success, false);
});

Deno.test("[skill_envelope] optional fields all default correctly", () => {
  const result = SkillEnvelopeSchema.safeParse({
    name: "minimal",
    skill_id: "minimal-skill",
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.scope, "global");
    assertEquals(result.data.version, undefined);
    assertEquals(result.data.triggers, undefined);
    assertEquals(result.data.constraints, undefined);
    assertEquals(result.data.quality_criteria, undefined);
    assertEquals(result.data.tools, undefined);
    assertEquals(result.data.agent, undefined);
  }
});
