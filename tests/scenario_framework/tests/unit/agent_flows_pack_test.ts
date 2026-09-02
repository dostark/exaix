/**
 * @module ScenarioFrameworkAgentFlowsPackTest
 * @path tests/scenario_framework/tests/unit/agent_flows_pack_test.ts
 * @description RED-first tests for Step 7. Verifies scenario pack
 * discovery, CI-safe filtering, and schema-valid metadata for the initial
 * Agent Flows scenario set before the pack catalog and scenario assets exist.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/scenarios/agent_flows]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import type { IScenario } from "../../schema/scenario_schema.ts";
import { type IScenarioStep, ScenarioExecutionMode } from "../../schema/step_schema.ts";
import {
  CI_EXCLUDED_TAGS,
  listCiSafeScenarios,
  loadScenarioCatalog,
  selectScenarioCatalogEntries,
} from "../../runner/scenario_catalog.ts";

const TEST_FILE_DIR = dirname(fromFileUrl(import.meta.url));
const FRAMEWORK_HOME = join(TEST_FILE_DIR, "../..");

Deno.test("[ScenarioFrameworkAgentFlowsPack] scenario selection logic resolves the Agent Flows pack by id, path, and tag", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });

  const byId = selectScenarioCatalogEntries({
    catalog,
    scenarioIds: ["request-analysis-smoke"],
  });
  const byPath = selectScenarioCatalogEntries({
    catalog,
    scenarioPaths: ["scenarios/agent_flows/quality-gate-clarification.yaml"],
  });
  const byTag = selectScenarioCatalogEntries({
    catalog,
    tags: ["criteria"],
  });

  assertEquals(byId.map((scenario: IScenario) => scenario.id), ["request-analysis-smoke"]);
  assertEquals(byPath.map((scenario: IScenario) => scenario.id), ["quality-gate-clarification"]);
  assertEquals(byTag.map((scenario: IScenario) => scenario.id).sort(), [
    "acceptance-criteria-propagation",
    "framework-matching-validation",
  ]);
});

Deno.test("[ScenarioFrameworkAgentFlowsPack] CI-safe scenario list excludes scenarios marked manual-only or provider-live-only", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const ciSafeScenarios = listCiSafeScenarios(catalog, {
    packs: ["agent_flows"],
  });

  // Asserts the PROPERTY rather than a frozen list: retagging a scenario provider-live is a
  // legitimate change this test should not contest. What must hold is that the CI-safe view
  // carries no scenario a mock-tier run cannot pass, and is not empty.
  const ciSafeIds = ciSafeScenarios.map((scenario: IScenario) => scenario.id).sort();
  assert(ciSafeIds.length > 0, "the agent_flows pack must contribute something to CI");

  const excluded = ciSafeScenarios.filter((scenario: IScenario) =>
    scenario.tags.some((tag) => (CI_EXCLUDED_TAGS as readonly string[]).includes(tag))
  );
  assertEquals(excluded.map((scenario: IScenario) => scenario.id), [], "no CI-excluded tag may appear");

  const nonAuto = ciSafeScenarios.filter((scenario: IScenario) =>
    !scenario.mode_support.includes(ScenarioExecutionMode.AUTO)
  );
  assertEquals(nonAuto.map((scenario: IScenario) => scenario.id), [], "every CI-safe scenario must run unattended");
});

Deno.test("[ScenarioFrameworkAgentFlowsPack] scenario metadata for the Agent Flows pack satisfies schema and criteria requirements", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const agentFlowScenarios = catalog.filter((scenario: IScenario) => scenario.pack === "agent_flows");

  assertEquals(
    agentFlowScenarios.map((scenario: IScenario) => scenario.id).sort(),
    [
      "acceptance-criteria-propagation",
      "aci-doc-injection-disabled",
      "aci-doc-injection-enabled",
      "context-budget-react-overflow",
      "edition-smoke",
      "flow-strategy-cli-delegate",
      "flow-strategy-react",
      "flow-strategy-routing",
      "flowrunner-execution",
      "guardrail-block-violation",
      "memory-aware-analysis",
      "memory-full-loop",
      "model-registry-team-cutover",
      "plan-amendment-lifecycle",
      "portal-knowledge-snapshot",
      "quality-gate-clarification",
      "request-analysis-smoke",
      "scratchpad-extraction",
      "session-delegate-code-changes",
      "session-delegate-plan-review",
      "session-delegate-refinement",
      "session-delegate-review",
      "step-durability-resume",
      "voting-majority-consensus",
    ],
  );

  for (const scenario of agentFlowScenarios) {
    assertStringIncludes(scenario.request_fixture, "fixtures/requests/agent_flows/");
    assertEquals(scenario.steps.length > 0, true);
    assertEquals(
      scenario.steps.every((step: IScenarioStep) =>
        [
          "wait-for-file",
          "shell",
          "exactl",
          "journal-assert",
          "file-contains",
          "write-file",
          "remove-files",
          "patch-blueprint",
          "prepare-evidence",
          "judge",
          "test-run",
        ].includes(step.type) ||
        ((step.input_criteria?.length ?? 0) + (step.output_criteria?.length ?? 0) > 0)
      ),
      true,
    );
  }
});

Deno.test("[ScenarioFrameworkAgentFlowsPack] forced-ReAct scenario keeps OpenCode and adds opt-in trace-scoped Codex evidence", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const scenario = catalog.find((candidate: IScenario) => candidate.id === "flow-strategy-react");
  assert(scenario, "flow-strategy-react scenario must exist");

  assertEquals(scenario.matrix?.cells[0], {
    tool: "opencode",
    provider: "opencode-cli",
    config: "configs/opencode-no-delegate.toml",
    requires_bin: "opencode",
  });
  assertEquals(scenario.matrix?.cells[1], {
    tool: "codex",
    provider: "codex-cli",
    config: "configs/codex-cli-react.toml",
    requires_bin: "codex",
    requires_optin: "EXA_MATRIX_CODEX",
  });

  const strategyEvidence = scenario.steps.find((step: IScenarioStep) => step.id === "assert-strategy-in-journal");
  assertEquals(strategyEvidence?.trace_scoped, true);
  assertEquals(strategyEvidence?.payload_equals, [
    { path: "stepId", value: "react-step" },
    { path: "strategy", value: "react" },
  ]);

  const codexEvidence = scenario.steps.find((step: IScenarioStep) => step.id === "assert-codex-generation");
  assertEquals(codexEvidence?.cells, ["codex"]);
  assertEquals(codexEvidence?.trace_scoped, true);
  assertEquals(codexEvidence?.payload_equals, [
    { path: "provider", value: "codex" },
    { path: "model", value: "gpt-5.6-terra" },
  ]);
  assertEquals(codexEvidence?.expect_sum, { path: "prompt_tokens", gt: 0 });
});
