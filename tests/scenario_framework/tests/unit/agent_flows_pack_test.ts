/**
 * @module ScenarioFrameworkAgentFlowsPackTest
 * @path tests/scenario_framework/tests/unit/agent_flows_pack_test.ts
 * @description RED-first tests for Step 7. Verifies scenario pack
 * discovery, CI-safe filtering, and schema-valid metadata for the initial
 * Agent Flows scenario set before the pack catalog and scenario assets exist.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/scenarios/agent_flows]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import type { IScenario } from "../../schema/scenario_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";
import {
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

  assertEquals(
    ciSafeScenarios.map((scenario: IScenario) => scenario.id).sort(),
    [
      "flowrunner-execution",
      "memory-aware-analysis",
      "plan-amendment-lifecycle",
      "portal-knowledge-snapshot",
      "request-analysis-smoke",
    ],
  );
});

Deno.test("[ScenarioFrameworkAgentFlowsPack] scenario metadata for the Agent Flows pack satisfies schema and criteria requirements", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const agentFlowScenarios = catalog.filter((scenario: IScenario) => scenario.pack === "agent_flows");

  assertEquals(
    agentFlowScenarios.map((scenario: IScenario) => scenario.id).sort(),
    [
      "acceptance-criteria-propagation",
      "context-budget-react-overflow",
      "flowrunner-execution",
      "memory-aware-analysis",
      "plan-amendment-lifecycle",
      "portal-knowledge-snapshot",
      "quality-gate-clarification",
      "request-analysis-smoke",
      "step-durability-resume",
    ],
  );

  for (const scenario of agentFlowScenarios) {
    assertStringIncludes(scenario.request_fixture, "fixtures/requests/agent_flows/");
    assertEquals(scenario.steps.length > 0, true);
    assertEquals(
      scenario.steps.every((step: IScenarioStep) =>
        ["wait-for-file", "shell"].includes(step.type) ||
        ((step.input_criteria?.length ?? 0) + (step.output_criteria?.length ?? 0) > 0)
      ),
      true,
    );
  }
});
