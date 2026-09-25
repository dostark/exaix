/**
 * @module SkillFloorEffortTest
 * @path packages/execution/tests/agents/skill_floor_effort_test.ts
 * @description Phase-197 Step 3 integration proof: the real
 *   response-contract-security-analysis skill's `effort: medium` floor is hydrated through
 *   AgentRunner and raises a role whose `effort: auto` would otherwise resolve to `low`
 *   (SIMPLE complexity on the heuristic) up to `medium` at the provider's generate() call.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/schemas/src/memory_bank.ts, scripts/build_skills_index.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentRunner } from "@exaix/execution";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import { SkillsService } from "@exaix/core/skills";
import { TaskComplexity } from "@exaix/core";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";
import { buildSkillsIndex } from "../../../../scripts/build_skills_index.ts";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeCapturingProvider(): { provider: IModelProvider; options: IModelOptions[] } {
  const options: IModelOptions[] = [];
  const provider: IModelProvider = {
    id: "capturing-mock",
    generate(_prompt: string, opts?: IModelOptions): Promise<IGenerateResult> {
      options.push(opts ?? {});
      return Promise.resolve({
        content: WELL_FORMED_RESPONSE,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, options };
}

Deno.test("[AgentRunner] response-contract-security-analysis effort medium floor reaches generate()", async () => {
  const { db, cleanup } = await initTestDbService();
  const root = await Deno.makeTempDir({ prefix: "skill-floor-effort-" });
  const memoryDir = join(root, "Memory");
  const targetSkillsDir = join(memoryDir, "Skills");
  try {
    const realSkillsDir = join(REPO_ROOT, "Blueprints", "Skills");
    const generated = await buildSkillsIndex(realSkillsDir, targetSkillsDir, root);
    if (!generated.success) {
      throw new Error(`buildSkillsIndex failed: ${generated.errors.join("; ")}`);
    }

    const skillsService = new SkillsService({ memoryDir }, db);
    await skillsService.initialize();
    const floor = await skillsService.getSkill("response-contract-security-analysis");
    assertEquals(floor?.effort, "medium", "the compiled skill JSON must carry the floor");

    const { provider, options } = makeCapturingProvider();
    const runner = new AgentRunner(provider, {
      skillsService,
      disableSkills: false,
      disableRetry: true,
    });

    const blueprint: IBlueprint = { systemPrompt: "You are a security expert.", effort: "auto" };
    const request: IParsedRequest = {
      userPrompt: "Assess the security of the login endpoint.",
      context: {},
      skills: ["response-contract-security-analysis"],
      taskComplexity: TaskComplexity.SIMPLE,
      taskComplexitySource: "analysis",
    };

    await runner.run(blueprint, request, undefined);
    assertEquals(options.length, 1);
    assertEquals(options[0].effort, "medium", "the skill floor must raise the low heuristic result");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await cleanup();
  }
});
