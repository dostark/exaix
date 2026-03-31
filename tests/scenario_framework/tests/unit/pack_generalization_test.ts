/**
 * @module ScenarioFrameworkPackGeneralizationTest
 * @path tests/scenario_framework/tests/unit/pack_generalization_test.ts
 * @description RED-first tests for Step 8. Verifies cross-pack
 * catalog loading, tag filtering across unrelated packs, and starter template
 * generation before general pack authoring support exists.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/templates/scenario_template.yaml]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { IScenario } from "../../schema/scenario_schema.ts";
import { loadScenarioCatalog, selectScenarioCatalogEntries } from "../../runner/scenario_catalog.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { renderScenarioTemplate } from "../../runner/scenario_templates.ts";

const TEST_FILE_DIR = dirname(fromFileUrl(import.meta.url));
const FRAMEWORK_HOME = join(TEST_FILE_DIR, "../..");

Deno.test("[ScenarioFrameworkPackGeneralization] runner can load two unrelated packs without pack-specific code branches", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });

  const allPacks = [...new Set(catalog.map((scenario: IScenario) => scenario.pack))].sort();
  const smokePack = selectScenarioCatalogEntries({
    catalog,
    packs: ["smoke"],
  });

  assertEquals(allPacks, [
    "agent_flows",
    "dynamic_execution",
    "framework_test",
    "integration_e2e",
    "mcp_tools_extended",
    "provider_live",
    "smoke",
  ]);
  assertEquals(smokePack.map((scenario: IScenario) => scenario.id), ["workspace-health-smoke"]);
});

Deno.test("[ScenarioFrameworkPackGeneralization] tag filtering returns the expected scenario subset across packs", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const smokeTagged = selectScenarioCatalogEntries({
    catalog,
    tags: ["smoke"],
  });

  assertEquals(
    smokeTagged.map((scenario: IScenario) => scenario.id).sort(),
    [
      "dynamic-exploration-smoke",
      "framework-smoke-validation",
      "memory-aware-analysis",
      "portal-knowledge-snapshot",
      "request-analysis-smoke",
      "workspace-health-smoke",
    ],
  );
});

Deno.test("[ScenarioFrameworkPackGeneralization] scenario template generation produces a valid starter document for a new pack", () => {
  const renderedTemplate = renderScenarioTemplate({
    id: "placeholder-pack-scenario",
    title: "Placeholder pack scenario",
    pack: "placeholder_pack",
    tags: ["placeholder", "smoke"],
    requestFixture: "fixtures/requests/shared/placeholder_request.md",
  });

  const parsedTemplate = ScenarioSchema.parse(parseYaml(renderedTemplate));

  assertEquals(parsedTemplate.id, "placeholder-pack-scenario");
  assertEquals(parsedTemplate.pack, "placeholder_pack");
  assertEquals(parsedTemplate.tags, ["placeholder", "smoke"]);
});
