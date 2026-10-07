/**
 * @module AgentRunnerSkillPinsTest
 * @path packages/execution/tests/agent_runner_skill_pins_test.ts
 * @description Verifies the durable pin vector `AgentRunner.run` returns. It lists every selected
 *   skill in confidence order with provenance and task types, keeps budget-excluded skills as
 *   metadata with `content_included` false, makes every pinned snapshot durable before
 *   returning, and returns an empty vector when nothing was selected.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/skills/skill_pins.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { AgentRunner, type IAgentRunnerConfig, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { SkillsService } from "@exaix/core/skills";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService, makeGenerateResult, writeSkillFolder } from "@exaix/testing";

const PINNED = "pinned-skill";
const CONTRACT = "contract-skill";

class OkProvider implements IModelProvider {
  readonly id = "ok-pins";
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    return Promise.resolve(makeGenerateResult("<thought>ok</thought><content>done</content>"));
  }
}

async function fixture() {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-runner-pins-" });
  const skillsDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(skillsDir, { name: PINNED, instructions: "Pinned body." });
  await writeSkillFolder(skillsDir, { name: CONTRACT, instructions: "Contract body.", sidecar: { critical: true } });
  const skills = new SkillsService(
    { memoryDir: join(base, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skills.initialize();
  return {
    skills,
    db: env.db,
    revisions: () => env.db.preparedAll<{ revision_id: string }>("SELECT revision_id FROM skill_revisions"),
    usage: () => env.db.preparedAll<{ skill_name: string }>("SELECT skill_name FROM skill_usage"),
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

const BLUEPRINT: IBlueprint = { systemPrompt: "You are a test agent.", agentRole: "tester" };

function request(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return { userPrompt: "Do the thing.", context: {}, skills: [PINNED], traceId: "trace-pins", ...overrides };
}

function runnerFor(skills: SkillsService, extra: Partial<IAgentRunnerConfig> = {}): AgentRunner {
  return new AgentRunner(new OkProvider(), {
    skillsService: skills,
    disableSkills: false,
    disableRetry: true,
    ...extra,
  });
}

Deno.test("[pins] the result carries one pin per selected skill with provenance and a durable snapshot", async () => {
  const fx = await fixture();
  try {
    const result = await runnerFor(fx.skills).run(
      { ...BLUEPRINT, defaultSkills: [CONTRACT] },
      request(),
      undefined,
    );
    const pins = result.resolvedSkills ?? [];
    assertEquals(pins.map((pin) => pin.name), [PINNED, CONTRACT]);
    assertEquals(pins[0].match_source, "pinned");
    assertEquals(pins[0].required, true);
    assertEquals(pins[1].match_source, "default");
    assertEquals(pins[1].required, false);
    assertEquals(pins.every((pin) => pin.content_included && pin.portal === null), true);
    assertEquals(pins[1].render_mode, "critical");
    const stored = (await fx.revisions()).map((row) => row.revision_id).sort();
    assertEquals(stored, pins.map((pin) => pin.revision_id).sort());
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] a skill the budget dropped stays a pin with content_included false and a durable snapshot", async () => {
  const fx = await fixture();
  try {
    const dropOrdinary = {
      prepare: ({ segments }: { segments: Array<{ content: string }> }) =>
        Promise.resolve({ segments: segments.filter((s) => !s.content.includes("APPLICABLE SKILLS")) }),
    };
    const result = await runnerFor(fx.skills, { contextBudgetManager: dropOrdinary as never }).run(
      BLUEPRINT,
      request({ skills: [PINNED, CONTRACT] }),
      undefined,
    );
    const byName = new Map((result.resolvedSkills ?? []).map((pin) => [pin.name, pin]));
    assertEquals(byName.get(PINNED)?.content_included, false);
    assertEquals(byName.get(CONTRACT)?.content_included, true);
    assertEquals((await fx.usage()).map((row) => row.skill_name), [CONTRACT]);
    assertEquals((await fx.revisions()).length, 2);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[pins] no selected skill yields an empty vector and no skills service yields none", async () => {
  const fx = await fixture();
  try {
    const empty = await runnerFor(fx.skills).run(BLUEPRINT, request({ skills: [] }), undefined);
    assertEquals(empty.resolvedSkills, []);
    const disabled = await runnerFor(fx.skills, { disableSkills: true }).run(BLUEPRINT, request(), undefined);
    assertEquals(disabled.resolvedSkills, undefined);
  } finally {
    await fx.cleanup();
  }
});
