// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentRunnerSkillExamplesRenderTest
 * @path packages/execution/tests/agent_runner_skill_examples_render_test.ts
 * @description Phase 196 Step 7 — proves ISkill.examples is threaded end-to-end through
 *   AgentRunner.hydrateSkills() into the assembled prompt, and that
 *   config.skills.render_mode: "trimmed" actually omits it for an ordinary (non-critical)
 *   skill while leaving a critical skill's examples untouched. Default (render_mode unset)
 *   reproduces full-mode rendering.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/func/prompt_formatter.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner } from "@exaix/execution";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeSkillsService(skill: { id: string; critical: boolean; examples?: string }) {
  return {
    recordSkillUsage: () => Promise.resolve(),
    matchSkills: () =>
      Promise.resolve({
        matches: [{ skillId: skill.id, confidence: 1.0, matchedTriggers: {} }],
        totalAvailable: 1,
      }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (id: string) =>
      Promise.resolve({
        id,
        name: id,
        description: "A test skill.",
        instructions: skill.examples
          ? `Do the thing.\n\n## Examples\n\n${skill.examples}\n\n## Later\n\nKept in order.`
          : "Do the thing.",
        examples: skill.examples,
        triggers: {},
        critical: skill.critical,
      } as any),
    initialize: () => Promise.resolve(),
  };
}

async function captureAssembledPrompt(
  skillsService: ReturnType<typeof makeSkillsService>,
  configOverride?: { skills?: { render_mode?: "full" | "trimmed" } },
): Promise<string> {
  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    skillsService: skillsService as any,
    disableSkills: false,
    context: configOverride ? ({ config: { get: () => configOverride } } as any) : undefined,
  });

  let capturedPrompt = "";
  const origGenerate = runner["modelProvider"].generate.bind(runner["modelProvider"]);
  runner["modelProvider"].generate = (prompt: string) => {
    capturedPrompt = prompt;
    return origGenerate(prompt);
  };

  const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
  const request: IParsedRequest = { userPrompt: "Do the thing.", context: {}, skills: ["ordinary-skill"] };
  await runner.run(blueprint, request, undefined);
  return capturedPrompt;
}

Deno.test("[IAgentRunner] a matched skill's examples reach the assembled prompt by default (full mode)", async () => {
  const svc = makeSkillsService({ id: "ordinary-skill", critical: false, examples: "EXAMPLE_MARKER_TEXT" });
  const prompt = await captureAssembledPrompt(svc);
  assert(prompt.includes("EXAMPLE_MARKER_TEXT"), "examples must be included under default (full) render mode");
});

Deno.test("[IAgentRunner] render_mode: 'trimmed' omits an ordinary skill's examples from the assembled prompt", async () => {
  const svc = makeSkillsService({ id: "ordinary-skill", critical: false, examples: "EXAMPLE_MARKER_TEXT" });
  const prompt = await captureAssembledPrompt(svc, { skills: { render_mode: "trimmed" } });
  assert(!prompt.includes("EXAMPLE_MARKER_TEXT"), "trimmed mode must omit an ordinary skill's examples");
});

Deno.test("[IAgentRunner] render_mode: 'trimmed' still includes a CRITICAL skill's examples", async () => {
  const svc = makeSkillsService({ id: "critical-skill", critical: true, examples: "CRITICAL_EXAMPLE_MARKER" });
  const prompt = await captureAssembledPrompt(svc, { skills: { render_mode: "trimmed" } });
  assert(prompt.includes("CRITICAL_EXAMPLE_MARKER"), "critical skill examples must survive trimmed mode");
});

Deno.test("[IAgentRunner] render_mode: 'full' is byte-identical to the default (unset) rendering", async () => {
  const svcA = makeSkillsService({ id: "ordinary-skill", critical: false, examples: "EXAMPLE_MARKER_TEXT" });
  const promptDefault = await captureAssembledPrompt(svcA);

  const svcB = makeSkillsService({ id: "ordinary-skill", critical: false, examples: "EXAMPLE_MARKER_TEXT" });
  const promptFull = await captureAssembledPrompt(svcB, { skills: { render_mode: "full" } });

  assertEquals(promptDefault, promptFull);
});
