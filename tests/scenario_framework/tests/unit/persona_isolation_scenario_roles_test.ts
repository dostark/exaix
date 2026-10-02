/**
 * @module PersonaIsolationScenarioRolesTest
 * @path tests/scenario_framework/tests/unit/persona_isolation_scenario_roles_test.ts
 * @description Locks the preregistered Phase 161 task-to-agent-role bindings before live spend.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/swe_tasks/map-dependencies.yaml, tests/scenario_framework/scenarios/swe_tasks/injection-sanitisation.yaml, tests/scenario_framework/scenarios/swe_tasks/path-traversal-storage.yaml]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { dirname, fromFileUrl, join } from "@std/path";
import type { IMatrixCell } from "../../runner/matrix_expander.ts";
import { loadCellCatalog, resolveScenarioMatrixCells } from "../../runner/cell_catalog.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const FRAMEWORK_ROOT = join(dirname(fromFileUrl(import.meta.url)), "../..");
const CATALOG_PATH = join(FRAMEWORK_ROOT, "..", "..", "configs", "eval-cells.toml");
const EXPECTED_ROLE_BY_SCENARIO = {
  "swe-write-tests-uncovered": "senior-coder",
  "swe-fix-bug-null-guard": "senior-coder",
  "swe-explain-request-flow-codeanalyst": "code-analyst",
  "swe-map-dependencies": "code-analyst",
  "swe-injection-sanitisation": "security-expert",
  "swe-path-traversal-storage": "security-expert",
} as const;

Deno.test("[PersonaIsolationRoles] preregistered scenarios explicitly request their measured role", async () => {
  for (const [scenarioId, expectedRole] of Object.entries(EXPECTED_ROLE_BY_SCENARIO)) {
    const filename = scenarioId.slice("swe-".length) + ".yaml";
    const source = await Deno.readTextFile(join(FRAMEWORK_ROOT, "scenarios", "swe_tasks", filename));
    const scenario = parseYaml(source) as { steps: Array<{ args?: string[]; blueprint?: string }> };
    const submittedRole = scenario.steps
      .find((step) => step.args?.includes("--agent-role"))
      ?.args?.at(-1);
    assertEquals(submittedRole, expectedRole, scenarioId);
    assertEquals(scenario.steps.find((step) => step.blueprint)?.blueprint, expectedRole, scenarioId);
  }
});

Deno.test("[PersonaIsolationRoles] preregistered scenarios expose Claude CLI and Codex CLI cells", async () => {
  // These scenarios select their cells with `matrix.from_catalog`.
  // A run's real cells therefore come from the eval cell catalog, not the YAML text.
  const catalog = await loadCellCatalog(CATALOG_PATH);
  for (const scenarioId of Object.keys(EXPECTED_ROLE_BY_SCENARIO)) {
    const filename = scenarioId.slice("swe-".length) + ".yaml";
    const source = await Deno.readTextFile(join(FRAMEWORK_ROOT, "scenarios", "swe_tasks", filename));
    const scenario = ScenarioSchema.parse(parseYaml(source));
    assert(scenario.matrix, `${scenarioId}: missing matrix`);
    const tools = resolveScenarioMatrixCells(scenario.matrix, catalog).map((cell) => cell.tool);
    assert(tools.includes("claude-code"), `${scenarioId}: missing Claude CLI cell`);
    assert(tools.includes("codex"), `${scenarioId}: missing Codex CLI cell`);
    for (const step of scenario.steps.filter((candidate) => candidate.add_capabilities?.includes("cli_delegate"))) {
      assert(step.cells && !step.cells.includes("codex"), `${scenarioId}: Codex must use its ReAct provider path`);
    }
  }
});

Deno.test("[PersonaIsolationRoles] capability-patched CLI cells enable their execution strategy", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  for (const scenarioId of Object.keys(EXPECTED_ROLE_BY_SCENARIO)) {
    const source = await Deno.readTextFile(
      join(FRAMEWORK_ROOT, "scenarios", "swe_tasks", scenarioId.slice(4) + ".yaml"),
    );
    const scenario = ScenarioSchema.parse(parseYaml(source));
    assert(scenario.matrix, `${scenarioId}: missing matrix`);
    const cells: IMatrixCell[] = resolveScenarioMatrixCells(scenario.matrix, catalog);
    for (const cell of cells.filter((candidate) => ["codex", "claude-code"].includes(candidate.tool))) {
      if (
        !scenario.steps.some((step) =>
          step.add_capabilities?.includes("cli_delegate") && (!step.cells || step.cells.includes(cell.tool))
        )
      ) continue;
      const config = parseToml(await Deno.readTextFile(join(FRAMEWORK_ROOT, "../..", cell.config))) as {
        cli_delegate?: { enabled?: boolean; tool?: string };
      };
      assertEquals(config.cli_delegate?.enabled, true, `${scenarioId}: ${cell.tool} execution strategy disabled`);
      assertEquals(config.cli_delegate?.tool, cell.tool);
    }
  }
});
