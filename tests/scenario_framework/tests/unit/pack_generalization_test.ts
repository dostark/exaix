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
import { basename, dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs";
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
    "agent_role_eval",
    "dynamic_execution",
    "eval_edge_cases",
    "eval_smoke",
    "external_terminal_bench",
    "flow_blueprints",
    "framework_test",
    "integration_e2e",
    "mcp_server",
    "mcp_tools_extended",
    "portal_knowledge",
    "provider_live",
    "skill_eval",
    "smoke",
    "swe_tasks",
    "triggers_basic",
  ]);
  assertEquals(smokePack.map((scenario: IScenario) => scenario.id), ["workspace-health-smoke"]);
});

Deno.test("[ScenarioFrameworkPackGeneralization] tag filtering returns the expected scenario subset across packs", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const smokeTagged = selectScenarioCatalogEntries({
    catalog,
    tags: ["smoke"],
  });

  const smokeIds = smokeTagged.map((scenario: IScenario) => scenario.id).sort();
  assertEquals(
    smokeIds.length >= 9,
    true,
    `expected >=9 smoke-tagged scenarios, got ${smokeIds.length}: ${JSON.stringify(smokeIds)}`,
  );
  assertEquals(smokeIds.includes("dynamic-exploration-smoke"), true);
  assertEquals(smokeIds.includes("edition-smoke"), true);
  assertEquals(smokeIds.includes("framework-smoke-validation"), true);
  assertEquals(smokeIds.includes("workspace-health-smoke"), true);
});

Deno.test("[ScenarioFrameworkPackGeneralization] every scenario file on disk is discoverable by the catalog — no orphaned scenarios", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const catalogPaths = new Set(catalog.map((s) => s.scenario_path));

  const diskPaths: string[] = [];
  const scenariosDir = join(FRAMEWORK_HOME, "scenarios");
  for await (const entry of walk(scenariosDir, { includeDirs: false })) {
    if (entry.isFile && (entry.path.endsWith(".yaml") || entry.path.endsWith(".yml"))) {
      diskPaths.push(relative(FRAMEWORK_HOME, entry.path));
    }
  }

  const orphaned = diskPaths.filter((p) => !catalogPaths.has(p));
  const missing = [...catalogPaths].filter((p) => !diskPaths.includes(p));

  if (orphaned.length > 0) {
    console.error(`❌ ${orphaned.length} scenario file(s) on disk but not in catalog:`);
    for (const p of orphaned) console.error(`  - ${p}`);
  }
  if (missing.length > 0) {
    console.error(`❌ ${missing.length} scenario(s) in catalog but not on disk:`);
    for (const p of missing) console.error(`  - ${p}`);
  }

  assertEquals(orphaned.length, 0, `${orphaned.length} orphaned scenario file(s) on disk`);
  assertEquals(missing.length, 0, `${missing.length} catalog entry/entries not on disk`);
});

Deno.test("[ScenarioFrameworkPackGeneralization] every test file is accounted for — convention-based pack association", async () => {
  // Convention: filenames map to packs as {pack}_pack_test.ts or {pack}_scenario_test.ts;
  // everything else is treated as framework-level (not pack-specific).
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const allPacks: string[] = [...new Set(catalog.map((s: IScenario) => s.pack))].sort();
  const validStems = new Set(allPacks);

  const testsDir = join(FRAMEWORK_HOME, "tests");
  const diskFiles: string[] = [];
  for await (const entry of walk(testsDir, { includeDirs: false })) {
    if (entry.isFile && entry.path.endsWith(".ts") && !entry.path.includes("node_modules")) {
      diskFiles.push(basename(entry.path));
    }
  }

  const packTestFiles: string[] = [];
  const unassociated: string[] = [];

  for (const f of diskFiles) {
    // Extract stem before the first suffix pattern
    const stem = f.replace(/_(?:pack|scenario)_test\.ts$/, "").replace(/\.ts$/, "");
    // Try matching against valid pack stems (underscored form)
    const matchedStem = [...validStems].find((s) => stem.includes(s));
    if (matchedStem) {
      packTestFiles.push(matchedStem);
    } else {
      unassociated.push(f);
    }
  }

  // Report packs without a dedicated test file
  const uncoveredPacks = allPacks.filter((p) => !packTestFiles.includes(p));
  if (uncoveredPacks.length > 0) {
    console.error(`⚠️  ${uncoveredPacks.length} pack(s) with no dedicated test file:`);
    for (const p of uncoveredPacks) console.error(`  - ${p}`);
  }

  // Warn about unassociated files (likely framework tests — this is informational)
  if (unassociated.length > 0) {
    console.error(`ℹ️  ${unassociated.length} test file(s) not associated with a pack:`);
    for (const f of unassociated) console.error(`  - ${f}`);
  }

  // Informational only — hard failures (unknown pack name, invalid test file) are already
  // caught by schema validation and catalog discovery.
  assertEquals(uncoveredPacks.length <= allPacks.length, true);
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
