/**
 * @module SkillEvalPlan
 * @path tests/scenario_framework/tests/helpers/skill_eval_plan.ts
 * @description Writes a request-bound plan for scenario checker tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/requirements_artifact.ts]
 */
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";

/** Writes a product-readable plan containing a case record. */
export async function writeSkillEvalPlan(root: string, requestId: string, record: string): Promise<void> {
  const resolver = new PathResolver(createMockConfig(root));
  await Deno.mkdir(await resolver.resolve("@Workspace/Plans"), { recursive: true });
  const trace = `${requestId.slice(-8)}-0000-4000-8000-000000000000`;
  const content = [
    "---",
    `request_id: ${requestId}`,
    `trace_id: ${trace}`,
    "---",
    "# Plan",
    "```json",
    record,
    "```",
    "## Execution Steps",
    "## Step 1: Check",
    "Do the check.",
  ].join("\n");
  await Deno.writeTextFile(await resolver.resolve(`@Workspace/Plans/${requestId}_plan.md`), content);
}
