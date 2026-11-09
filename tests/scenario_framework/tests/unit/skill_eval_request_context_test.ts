/**
 * @module SkillEvalRequestContextTest
 * @path tests/scenario_framework/tests/unit/skill_eval_request_context_test.ts
 * @description Checks faithful fixture context and the plan writer output contract.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_eval_request_context.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "@exaix/testing";
import { prepareSkillEvalRequest } from "../../runner/skill_eval_request_context.ts";

Deno.test("skill evaluation request includes the portal record contract without changing the original fixture", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const portal = join(env.tempDir, "p234-s6-c1");
    await Deno.mkdir(portal);
    await Deno.writeTextFile(join(portal, "README.md"), "# Case record\nRequired fixture details.\n");
    const output = await prepareSkillEvalRequest(env.tempDir, "p234-s6-c1");
    const request = await Deno.readTextFile(output);
    assertStringIncludes(request, "skills: [plan]");
    assertStringIncludes(request, "Required fixture details.");
    assertStringIncludes(request, "description");
    assertStringIncludes(request, "JSON code block");
    assertStringIncludes(request, "acceptance_ids (array)");
    assertStringIncludes(request, "AC-empty and AC-filter");
    await assertRejects(() => prepareSkillEvalRequest(env.tempDir, "../escape"), Error, "Invalid case");
    assertEquals(output, join(env.tempDir, "p234-s6-c1-request.md"));
  } finally {
    await env.cleanup();
  }
});

Deno.test("requirements answer preserves its case and cannot write through an escaping symlink", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  const outside = await Deno.makeTempDir();
  try {
    const answer = await prepareSkillEvalRequest(env.tempDir, "p234-s5-c2-answer");
    const text = await Deno.readTextFile(answer);
    assertStringIncludes(text, "completed_at");
    assertStringIncludes(text, "case_id: p234-s5-c2");
    assertStringIncludes(text, "real newline characters");
    assertStringIncludes(text, "RESOLVED or PENDING USER DECISION");
    await Deno.symlink(join(outside, "request.md"), join(env.tempDir, "p234-s5-c1-request.md"));
    await assertRejects(() => prepareSkillEvalRequest(env.tempDir, "p234-s5-c1"), Deno.errors.AlreadyExists);
    assertEquals([...Deno.readDirSync(outside)].length, 0);
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});
