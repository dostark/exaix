// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentRunnerOutputContractTest
 * @path packages/execution/tests/agent_runner_output_contract_test.ts
 * @description Verifies that a declared output contract adds its contract skill and that a verdict run carries no plan-schema instruction.
 * @architectural-layer Unit
 * @related-files [packages/execution/src/agent_runner_skills.ts, packages/execution/src/agent_runner_prompts.ts]
 */

import { assertArrayIncludes, assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint } from "@exaix/execution";
import { OutputContract } from "@exaix/core";
import { PlanAdapter } from "@exaix/core/planning";
import type { ICapturedEvent } from "@exaix/testing";
import { createRunner, resolutionEvents } from "./helpers/skill_runner_fixture.ts";

const PLAN_SCHEMA_MARKER = "PLANNING phase";

class CapturingProvider extends MockProvider {
  prompt = "";
  override generate(prompt: string) {
    this.prompt = prompt;
    return super.generate(prompt);
  }
}

async function promptFor(blueprint: IBlueprint): Promise<string> {
  const provider = new CapturingProvider("<thought>ok</thought><content>{}</content>");
  const runner = new AgentRunner(new PlanAdapter(), provider, {});
  await runner.run(blueprint, { userPrompt: "Judge this output.", context: {} }, undefined);
  return provider.prompt;
}

Deno.test("fix(execution): a verdict run carries no plan-schema instruction", async () => {
  const prompt = await promptFor({ systemPrompt: "Judge.", outputContract: OutputContract.VERDICT });
  assertNotMatch(prompt, new RegExp(PLAN_SCHEMA_MARKER));
});

Deno.test("fix(execution): a plan run keeps the plan-schema instruction", async () => {
  const prompt = await promptFor({ systemPrompt: "Plan.", outputContract: OutputContract.PLAN });
  assertStringIncludes(prompt, PLAN_SCHEMA_MARKER);
});

Deno.test("fix(execution): a role without a declared contract keeps the plan-schema instruction", async () => {
  assertStringIncludes(await promptFor({ systemPrompt: "Legacy." }), PLAN_SCHEMA_MARKER);
});

Deno.test("fix(execution): the declared output contract adds its contract skill as a default", async () => {
  const captured: ICapturedEvent[] = [];
  const runner = createRunner(captured);
  const blueprint: IBlueprint = {
    systemPrompt: "QA.",
    defaultSkills: ["tdd-methodology"],
    outputContract: OutputContract.QA,
  };
  await (runner as any).skills.matchAndApplySkills(blueprint, { userPrompt: "task" }, "qa-engineer");
  const payload = resolutionEvents(captured)[0].payload as { default_skill_ids: string[]; skill_ids: string[] };
  assertEquals(payload.default_skill_ids, ["response-contract-qa", "tdd-methodology"]);
  assertArrayIncludes(payload.skill_ids, ["response-contract-qa"]);
});

Deno.test("fix(execution): a request-level output contract overrides the role's contract", async () => {
  const captured: ICapturedEvent[] = [];
  const runner = createRunner(captured);
  const blueprint: IBlueprint = { systemPrompt: "Security.", outputContract: OutputContract.PLAN };
  await (runner as any).skills.matchAndApplySkills(
    blueprint,
    { userPrompt: "task", outputContract: OutputContract.SECURITY },
    "security-expert",
  );
  const payload = resolutionEvents(captured)[0].payload as { default_skill_ids: string[] };
  assertEquals(payload.default_skill_ids, ["response-contract-security-analysis"]);
});
