/**
 * @module SkillUsageFlowE2eTest
 * @path tests/integration/skill_usage_flow_e2e_test.ts
 * @description Phase 206 Step 5 — a real FlowRunner drives two steps through the production
 *   AgentComposerAdapter and AgentRunner with a real SkillsService. Every step's model call writes
 *   one usage row that carries the flow id and its own step id on the shared flow trace.
 * @architectural-layer Integration
 * @dependencies [@exaix/flow, @exaix/execution, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/execution/src/agent_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner } from "@exaix/flow";
import type { IFlowEventLogger } from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowOutputFormat, FlowStepExecutionMode } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService, makeGenerateResult, writeSkillFolder } from "@exaix/testing";

const SKILL = "flow-usage-skill";
const FLOW_ID = "usage-flow";
const WELL_FORMED = "<thought>ok</thought><content>done</content>";

class SilentFlowLogger implements IFlowEventLogger {
  log(): void {}
}

interface IUsageRow {
  call_id: string;
  skill_name: string;
  trace_id: string;
  flow_id: string | null;
  flow_step_id: string | null;
  agent_role: string;
}

Deno.test("[skill usage] each flow step's model call records a row with the flow id and its own step id", async () => {
  const env = await initTestDbService();
  const root = await Deno.makeTempDir({ prefix: "skill-usage-flow-" });
  try {
    const skillsDir = join(root, "Blueprints", "Skills");
    await writeSkillFolder(skillsDir, { name: SKILL, instructions: "Flow skill body." });
    await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "Blueprints", "Agents", "flow-agent.md"),
      `---\nagent_role: flow-agent\nmodel: mock:test\ndefault_skills: ["${SKILL}"]\n---\nYou are a flow agent.\n`,
    );
    const skills = new SkillsService(
      { memoryDir: join(root, "Memory"), blueprintSkillsDir: skillsDir },
      env.db,
      undefined,
      new EventLogger({ db: env.db }),
    );
    await skills.initialize();
    const provider: IModelProvider = {
      id: "flow-usage-mock",
      generate: () => Promise.resolve(makeGenerateResult(WELL_FORMED)),
    };
    const agentRunner = new AgentRunner(provider, { skillsService: skills, disableSkills: false, disableRetry: true });
    const runner = new FlowRunner({
      agentExecutor: new AgentComposerAdapter(agentRunner, join(root, "Blueprints", "Agents")),
      eventLogger: new SilentFlowLogger(),
    });

    const step = (id: string, dependsOn: string[]) => ({
      id,
      name: id,
      agent_role: "flow-agent",
      execution_mode: FlowStepExecutionMode.DECLARED,
      dependsOn,
      input: { source: "request", transform: "passthrough" },
    });
    const flow: IFlow = {
      id: FLOW_ID,
      name: "Usage Flow",
      description: "Two steps",
      version: "1.0",
      output: { from: "step-b" as never, format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
      steps: [step("step-a", []), step("step-b", ["step-a"])] as object as IFlowStep[],
    };
    const traceId = crypto.randomUUID();
    await runner.execute(flow, { userPrompt: "Do the thing", traceId, requestId: crypto.randomUUID() });

    const rows = await env.db.preparedAll<IUsageRow>(
      "SELECT call_id, skill_name, trace_id, flow_id, flow_step_id, agent_role FROM skill_usage ORDER BY id",
    );
    assertEquals(rows.map((r) => r.flow_step_id), ["step-a", "step-b"]);
    assertEquals(rows.map((r) => [r.flow_id, r.trace_id === traceId]), [[FLOW_ID, true], [FLOW_ID, true]]);
    assertEquals(rows.every((r) => r.skill_name === SKILL && r.agent_role === "flow-agent"), true);
    assertEquals(new Set(rows.map((r) => r.call_id)).size, 2);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await env.cleanup();
  }
});
