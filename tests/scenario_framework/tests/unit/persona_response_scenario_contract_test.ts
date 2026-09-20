/**
 * @module PersonaResponseScenarioContractTest
 * @path tests/scenario_framework/tests/unit/persona_response_scenario_contract_test.ts
 * @description Pins response evaluation role bindings, capture order, blinding and CLI transports.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/persona_response_eval]
 */
import { assert, assertEquals } from "@std/assert";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { CriterionKind, ScenarioStepType } from "../../schema/step_schema.ts";
import { fromFileUrl, join } from "@std/path";

Deno.test("[PersonaResponse] six live scenarios capture actual role response before blinded judging", async () => {
  const frameworkHome = fromFileUrl(new URL("../../", import.meta.url));
  const scenarios = await loadScenarioCatalog({ frameworkHome, scenariosDirectory: "scenarios/persona_response_eval" });
  assertEquals(scenarios.length, 6);
  const counts = new Map<string, number>();
  for (const scenario of scenarios) {
    assert(scenario.judge_context_files?.length, `${scenario.id} needs explicit judge context files`);
    assert(scenario.judge_context_files.every((file) => file.alias === "@todo-app"));
    const portal = scenario.portals.find((entry) => entry.alias === "todo-app");
    assert(portal);
    const sourceRoot = portal.source_path.replace("$FRAMEWORK_HOME/", "");
    for (const file of scenario.judge_context_files) {
      assert((await Deno.stat(join(frameworkHome, sourceRoot, file.path))).isFile, `${scenario.id}: ${file.path}`);
    }
    const capture = scenario.steps.find((step) => step.type === ScenarioStepType.CAPTURE_ROLE_RESPONSE);
    assert(capture?.response_capture);
    const role = capture.response_capture.agent_role;
    counts.set(role, (counts.get(role) ?? 0) + 1);
    const submit = scenario.steps.find((step) => step.id === "submit-request");
    assertEquals(submit?.args?.at(-1), role);
    assertEquals(scenario.matrix?.cells.map((cell) => cell.tool), ["claude-code", "codex"]);
    const judge = scenario.steps.find((step) => step.id === "judge-response");
    assert(judge);
    assert(scenario.steps.indexOf(capture) < scenario.steps.indexOf(judge));
    const criterion = judge.output_criteria.find((item) => item.kind === CriterionKind.LLM_JUDGE);
    assert(criterion?.kind === CriterionKind.LLM_JUDGE);
    assertEquals(judge.step_pass_threshold, criterion.score_threshold);
    assertEquals(criterion.evidence_path, "Memory/persona-response.txt");
    assert(criterion.rubric?.includes("proposed"));
    if (role !== "senior-coder") {
      assert(criterion.rubric?.includes("Do not require file writes or executed fixes"));
      assert(criterion.rubric?.includes("Missing substantive analysis"));
    }
    assertEquals(scenario.steps.some((step) => step.args?.includes("approve-all")), false);
  }
  assertEquals(Object.fromEntries(counts), { "senior-coder": 2, "code-analyst": 2, "security-expert": 2 });
});
