/**
 * @module SkillPinnedExecutionSecurityTest
 * @path tests/integration/skill_pinned_execution_e2e_security_test.ts
 * @description Security tests for pinned-skill execution: a swapped pin or a missing
 *   snapshot runs nothing and writes no usage.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_composer.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import type { JSONObject, JSONValue } from "@exaix/core/types";
import { SkillUnavailableError } from "@exaix/core/skills";
import {
  capturingProvider,
  executorFor,
  OTHER,
  planWithPinnedSkill,
} from "./helpers/skill_pinned_execution_helpers.ts";

Deno.test("[security] a swapped pin or a missing snapshot runs nothing and writes no usage", async () => {
  const fx = await planWithPinnedSkill();
  try {
    const original = (fx.frontmatter.resolved_skills as JSONObject[])[0];
    const executionTrace = crypto.randomUUID();
    const prompts: string[] = [];
    const attempt = (pins: JSONValue) =>
      executorFor(fx, capturingProvider(prompts)).execute(`${fx.env.tempDir}/plan.md`, {
        trace_id: executionTrace,
        request_id: "req-swap",
        agent_role: "default",
        frontmatter: { ...fx.frontmatter, resolved_skills: pins } as never,
        steps: [{ number: 1, title: "Review", content: "Do the task." }],
      });
    await assertRejects(() => attempt([{ ...original, name: OTHER }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ ...original, content_sha256: "e".repeat(64) }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ ...original, revision_id: crypto.randomUUID() }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ name: "broken" }]), SkillUnavailableError);
    assertEquals(prompts.length, 0);
    assertEquals((await fx.usage(executionTrace)).length, 0);
  } finally {
    await fx.cleanup();
  }
});
