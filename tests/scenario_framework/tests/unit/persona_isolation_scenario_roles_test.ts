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

const FRAMEWORK_ROOT = join(dirname(fromFileUrl(import.meta.url)), "../..");
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
  for (const scenarioId of Object.keys(EXPECTED_ROLE_BY_SCENARIO)) {
    const filename = scenarioId.slice("swe-".length) + ".yaml";
    const source = await Deno.readTextFile(join(FRAMEWORK_ROOT, "scenarios", "swe_tasks", filename));
    const scenario = parseYaml(source) as {
      matrix: { cells: Array<{ tool: string }> };
      steps: Array<{ add_capabilities?: string[]; cells?: string[] }>;
    };
    const tools = scenario.matrix.cells.map((cell) => cell.tool);
    assert(tools.includes("claude-code"), `${scenarioId}: missing Claude CLI cell`);
    assert(tools.includes("codex"), `${scenarioId}: missing Codex CLI cell`);
    for (const step of scenario.steps.filter((candidate) => candidate.add_capabilities?.includes("cli_delegate"))) {
      if (step.cells) assert(step.cells.includes("codex"), `${scenarioId}: Codex excluded from CLI capability patch`);
    }
  }
});

Deno.test("[PersonaIsolationRoles] capability-patched CLI cells enable their execution strategy", async () => {
  for (const scenarioId of Object.keys(EXPECTED_ROLE_BY_SCENARIO)) {
    const source = await Deno.readTextFile(
      join(FRAMEWORK_ROOT, "scenarios", "swe_tasks", scenarioId.slice(4) + ".yaml"),
    );
    const scenario = parseYaml(source) as {
      matrix: { cells: Array<{ tool: string; config: string }> };
      steps: Array<{ add_capabilities?: string[]; cells?: string[] }>;
    };
    for (const cell of scenario.matrix.cells.filter((cell) => ["codex", "claude-code"].includes(cell.tool))) {
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
