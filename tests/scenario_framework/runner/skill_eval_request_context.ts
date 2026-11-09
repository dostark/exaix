#!/usr/bin/env -S deno run -A
/**
 * @module SkillEvalRequestContext
 * @path tests/scenario_framework/runner/skill_eval_request_context.ts
 * @description Supplies fixture context and the plan writer's record placement contract.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_eval_request_context_test.ts]
 */
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig, REPO_ROOT } from "@exaix/testing";

/** Creates a request from the unchanged fixture in the scenario-owned workspace. */
export async function prepareSkillEvalRequest(root: string, caseId: string): Promise<string> {
  const match = /^p234-s([56])-c[1-5](?:-answer)?$/.exec(caseId);
  if (!match || (caseId.endsWith("-answer") && caseId !== "p234-s5-c2-answer")) {
    throw new Error("Invalid case identity");
  }
  const resolver = new PathResolver(createMockConfig(root));
  const fixture = join(REPO_ROOT, "tests/scenario_framework/fixtures/requests/skill_eval/phase234", `${caseId}.md`);
  let content = await Deno.readTextFile(fixture);
  if (match[1] === "6") {
    const readme = await resolver.validatePath(join(root, caseId, "README.md"), [root]);
    content += `\n\n## Portal fixture context\n\n${await Deno.readTextFile(readme)}\n`;
  }
  content +=
    "\n\nThe runtime requires an outer executable-plan JSON object. Put the complete requested JSON code block " +
    "inside the plan's description string. The decoded description must contain real newline characters and a valid " +
    "JSON code block, not literal backslash escapes. Use normal JSON string encoding for the outer object. The rendered " +
    "plan must contain the actual record, not a promise to create it later. Keep the outer object unfenced.\n";
  if (match[1] === "5") {
    content += "The record status is RESOLVED or PENDING USER DECISION. Each acceptance item has an id and status; " +
      "when the request gives numeric input/output examples, include numeric input and string expected fields.\n";
  }
  if (match[1] === "6") {
    content +=
      "Record decisions with id, source, choice, acceptance_ids (array), and cost_row. Record each stage with " +
      "id, depends_on (array), api (array), callers (consumer/method objects), tests (array), and rollback " +
      "(object with requires_api and restore_callers arrays). Use an object for terms and an array for created_files.\n";
  }
  if (caseId === "p234-s5-c1") {
    content +=
      "Record each requested numeric example as one acceptance item. Already approved results may be recorded " +
      "as decisions; do not present them as unanswered choices.\n";
  }
  if (caseId === "p234-s6-c1") {
    content += "Use AC-empty and AC-filter as the IDs of the two count examples. A complete first feature stage " +
      "records entrypoint, registered, store, new_services, and new_schemas alongside its callers and tests.\n";
  }
  const output = await resolver.validatePath(join(root, `${caseId}-request.md`), [root]);
  await Deno.writeTextFile(output, content, { createNew: true });
  return output;
}

if (import.meta.main) {
  const [root, caseId] = Deno.args;
  if (!root || !caseId) throw new Error("Provide workspace and case identity");
  console.log(await prepareSkillEvalRequest(root, caseId));
}
