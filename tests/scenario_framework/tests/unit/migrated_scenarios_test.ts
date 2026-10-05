/**
 * @module MigratedScenariosTest
 * @path tests/scenario_framework/tests/unit/migrated_scenarios_test.ts
 * @description Phase 203 Step 8 migrates seven named scenarios to `matrix.from_catalog`. This
 *   file proves each migration keeps the cell ids, configs and prerequisite predicates that
 *   scenario hand-listed, and that every shipped provider realm stays selectable from a
 *   migrated scenario by preset name or by a single `--bind`.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/cell_catalog.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import type { IMatrixCell } from "../../runner/matrix_expander.ts";
import { loadCellCatalog, resolveCatalogCells } from "../../runner/cell_catalog.ts";
import { buildRunBindingsFile, planScenarioBindings } from "../../runner/binding_layers.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { ConfigService } from "@exaix/core/config";
import { loadBindingLayers, resolveBinding } from "@exaix/ai";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");
const CELL_CATALOG_PATH = join(REPO_ROOT, "configs", "eval-cells.toml");

/** The `[ai].provider` a cell's config pins, or an empty string when it pins none. */
function configProvider(configRelPath: string): string {
  const raw = Deno.readTextFileSync(join(REPO_ROOT, configRelPath));
  const parsed = parseToml(raw) as { ai?: { provider?: string } };
  return parsed.ai?.provider ?? "";
}

/** One preset migration: the scenario, the presets it now names, and the cells it hand-listed. */
interface IMigratedScenario {
  id: string;
  path: string;
  presets: string[];
  priorCells: PriorCellRow[];
}

/** A hand-listed cell before migration: tool, provider, config, binary, key, opt-in. */
type PriorCellRow = [
  tool: string,
  provider: string,
  config: string,
  requiresBin: string,
  requiresKey?: string,
  requiresOptin?: string,
];

function priorCellFromRow(row: PriorCellRow): IMatrixCell {
  const [tool, provider, config, requires_bin, requires_key, requires_optin] = row;
  return {
    tool,
    provider,
    config,
    requires_bin,
    ...(requires_key !== undefined ? { requires_key } : {}),
    ...(requires_optin !== undefined ? { requires_optin } : {}),
  };
}

const CLAUDE_CELL: PriorCellRow = ["claude-code", "$CELL_PROVIDER", "configs/claude-cli-delegate-all.toml", "claude"];
const CODEX_CELL: PriorCellRow = ["codex", "$CELL_PROVIDER", "configs/codex-cli-react.toml", "codex"];
const OPENCODE_CELL: PriorCellRow = [
  "opencode",
  "$CELL_PROVIDER",
  "configs/opencode-cli-delegate-all.toml",
  "opencode",
];
const ANTHROPIC_CELL: PriorCellRow = [
  "exactl",
  "anthropic",
  "configs/anthropic-no-delegate.toml",
  "true",
  "ANTHROPIC_API_KEY",
];
const OPENAI_CHAT_CELL: PriorCellRow = [
  "exactl",
  "openai-chat",
  "configs/openai-chat.toml",
  "true",
  "OPENAI_API_KEY",
];
/** The claude-code, codex and opencode cells six of the seven scenarios declared by hand. */
const COMMON_CLI_CELLS: PriorCellRow[] = [CLAUDE_CELL, CODEX_CELL, OPENCODE_CELL];

/** The seven migrated scenarios, with the exact cells each one declared by hand. */
const MIGRATED_SCENARIOS: IMigratedScenario[] = [
  {
    id: "swe-write-tests-uncovered",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "write-tests-uncovered.yaml"),
    presets: ["claude-code", "codex", "opencode", "exactl-native", "openai-chat"],
    priorCells: [...COMMON_CLI_CELLS, ANTHROPIC_CELL, OPENAI_CHAT_CELL],
  },
  {
    id: "swe-path-traversal-storage",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "path-traversal-storage.yaml"),
    presets: [
      "claude-code",
      "codex",
      "claude-haiku-4-5",
      "opencode",
      "opencode-north-mini-code",
      "opencode-laguna-free",
      "exactl-native",
    ],
    priorCells: [
      CLAUDE_CELL,
      CODEX_CELL,
      ["claude-haiku-4-5", "$CELL_PROVIDER", "configs/claude-haiku-4-5-delegate-all.toml", "claude"],
      OPENCODE_CELL,
      ["opencode-north-mini-code", "$CELL_PROVIDER", "configs/opencode-north-mini-code-free.toml", "opencode"],
      ["opencode-laguna-free", "$CELL_PROVIDER", "configs/opencode-laguna-free.toml", "opencode"],
      ANTHROPIC_CELL,
    ],
  },
  {
    id: "swe-injection-sanitisation",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "injection-sanitisation.yaml"),
    presets: ["claude-code", "codex", "opencode", "exactl-native"],
    priorCells: [...COMMON_CLI_CELLS, ANTHROPIC_CELL],
  },
  {
    id: "swe-injection-sanitisation-seniorcoder",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "injection-sanitisation-seniorcoder.yaml"),
    presets: ["claude-code", "codex", "opencode", "exactl-native"],
    priorCells: [...COMMON_CLI_CELLS, ANTHROPIC_CELL],
  },
  {
    id: "swe-map-dependencies",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "map-dependencies.yaml"),
    presets: ["claude-code", "codex", "opencode", "exactl-native", "openai-chat"],
    priorCells: [...COMMON_CLI_CELLS, ANTHROPIC_CELL, OPENAI_CHAT_CELL],
  },
  {
    id: "swe-explain-request-flow-codeanalyst",
    path: join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "explain-request-flow-codeanalyst.yaml"),
    presets: ["claude-code", "codex", "opencode", "exactl-native"],
    priorCells: [...COMMON_CLI_CELLS, ANTHROPIC_CELL],
  },
  {
    id: "planning-read-only-tools-live",
    path: join(FRAMEWORK_HOME, "scenarios", "provider_live", "planning-read-only-tools-live.yaml"),
    presets: [
      "planning-live-claude",
      "planning-live-codex",
      "planning-live-opencode",
      "planning-live-anthropic",
      "planning-live-openai",
      "planning-live-google",
      "planning-live-openrouter",
      "planning-live-deepseek",
    ],
    priorCells: [
      ["claude-code", "claude-cli", "configs/planning-live.claude.toml", "claude"],
      ["codex", "codex-cli", "configs/planning-live.codex.toml", "codex", undefined, "EXA_MATRIX_CODEX"],
      ["opencode", "opencode-cli", "configs/planning-live.opencode.toml", "opencode", undefined, "EXA_MATRIX_OPENCODE"],
      ["exactl", "anthropic", "configs/planning-live.anthropic.toml", "true", "ANTHROPIC_API_KEY"],
      ["exactl", "openai", "configs/planning-live.openai.toml", "true", "OPENAI_API_KEY"],
      ["exactl", "google", "configs/planning-live.google.toml", "true", "GOOGLE_API_KEY"],
      ["exactl", "openrouter", "configs/planning-live.openrouter.toml", "true", "OPENROUTER_API_KEY"],
      ["exactl", "openai-chat", "configs/planning-live.deepseek.toml", "true", "DEEPSEEK_API_KEY"],
    ],
  },
];

/** The history cell id of a resolved cell: its tool plus the provider its config pins. */
function cellIdOf(cell: IMatrixCell): string {
  return `${cell.tool}-${configProvider(cell.config)}`;
}

Deno.test(
  "[regression] each Step 8 migration keeps the cell ids, configs and predicates it hand-listed",
  async () => {
    const catalog = await loadCellCatalog(CELL_CATALOG_PATH);
    for (const migrated of MIGRATED_SCENARIOS) {
      const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(migrated.path)));
      const matrix = scenario.matrix;
      assert(matrix, `${migrated.id} must declare a matrix`);
      assertEquals(matrix.cells, undefined, `${migrated.id} must drop its hand-listed cells`);
      assertEquals(matrix.from_catalog, migrated.presets, `${migrated.id} must name these presets`);

      const resolved = resolveCatalogCells(catalog, matrix.from_catalog!);
      const priorCells = migrated.priorCells.map(priorCellFromRow);
      assertEquals(resolved.map(cellIdOf), priorCells.map(cellIdOf), `${migrated.id} cell ids`);
      assertEquals(
        resolved.map((cell) => cell.config),
        priorCells.map((cell) => cell.config),
        `${migrated.id} cell configs`,
      );
      assertEquals(
        resolved.map((cell) => cell.requires_bin),
        priorCells.map((cell) => cell.requires_bin),
        `${migrated.id} requires_bin predicates`,
      );
      assertEquals(
        resolved.map((cell) => cell.requires_key),
        priorCells.map((cell) => cell.requires_key),
        `${migrated.id} requires_key predicates`,
      );
      assertEquals(
        resolved.map((cell) => cell.requires_optin),
        priorCells.map((cell) => cell.requires_optin),
        `${migrated.id} requires_optin predicates`,
      );
    }
  },
);

/** The four realms a migrated scenario reaches by naming a catalog preset. */
const REALM_PRESET_ROUTES: Array<{ realm: string; scenarioId: string; preset: string; service: string }> = [
  { realm: "anthropic", scenarioId: "swe-write-tests-uncovered", preset: "exactl-native", service: "anthropic" },
  { realm: "openai", scenarioId: "swe-write-tests-uncovered", preset: "openai-chat", service: "openai-chat" },
  { realm: "google", scenarioId: "planning-read-only-tools-live", preset: "planning-live-google", service: "google" },
  {
    realm: "openrouter",
    scenarioId: "planning-read-only-tools-live",
    preset: "planning-live-openrouter",
    service: "openrouter",
  },
];

/** The two realms only one `--bind` reaches, because no migrated scenario lists their preset. */
const REALM_BIND_ROUTES: Array<{ realm: string; scenarioId: string; preset: string; service: string }> = [
  { realm: "deepseek", scenarioId: "swe-write-tests-uncovered", preset: "deepseek-chat", service: "deepseek" },
  { realm: "ollama", scenarioId: "swe-write-tests-uncovered", preset: "ollama-chat", service: "ollama-chat" },
];

/** A flow-step ref, the shape an operator binding resolves against. */
const BIND_STEP_REF = {
  flowId: "swe-write-tests-uncovered",
  stepId: "submit-request",
  agentRole: "senior-coder",
  kind: "agent",
  nativeTools: true,
} as const;

const BIND_PROBE = { hasKey: (): boolean => true, hasOptIn: (): boolean => true };

Deno.test("[step8] anthropic, openai, google and openrouter are selectable by preset name", async () => {
  const catalog = await loadCellCatalog(CELL_CATALOG_PATH);
  for (const route of REALM_PRESET_ROUTES) {
    const migrated = MIGRATED_SCENARIOS.find((entry) => entry.id === route.scenarioId);
    assert(migrated, `unknown migrated scenario ${route.scenarioId}`);
    const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(migrated.path)));
    assert(
      scenario.matrix?.from_catalog?.includes(route.preset),
      `${route.scenarioId} must name '${route.preset}' for the ${route.realm} realm`,
    );

    const [cell] = resolveCatalogCells(catalog, [route.preset]);
    // A preset reaches its realm through its own binding, or through the provider its config pins.
    assertEquals(
      cell.bindings?.default?.service ?? configProvider(cell.config),
      route.service,
      `preset '${route.preset}' must reach the ${route.realm} service`,
    );
  }
});

Deno.test("[step8] deepseek and ollama are selectable from a migrated scenario with one --bind", async () => {
  const catalog = await loadCellCatalog(CELL_CATALOG_PATH);
  const dir = await Deno.makeTempDir({ prefix: "step8-bind-routes-" });
  try {
    for (const route of REALM_BIND_ROUTES) {
      const migrated = MIGRATED_SCENARIOS.find((entry) => entry.id === route.scenarioId)!;
      const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(migrated.path)));
      // The preset supplies the model and any catalog entry the realm needs. The operator
      // binding supplies the service, which is what a run-time `--bind` does.
      const [cell] = resolveCatalogCells(catalog, [route.preset]);
      const plan = await planScenarioBindings({
        scenario,
        cell,
        operatorOverlays: [],
        operatorBinds: [`default=service=${route.service}`],
        outputDir: join(dir, route.realm),
        sandboxRoot: join(dir, route.realm, "sandbox"),
      });
      const runFile = await buildRunBindingsFile(plan.overlays, {
        traceId: crypto.randomUUID(),
        requestPath: join(FRAMEWORK_HOME, scenario.request_fixture!),
      });
      const config = new ConfigService(join(REPO_ROOT, cell.config)).get();
      const layers = await loadBindingLayers(config, runFile);

      const outcome = resolveBinding(BIND_STEP_REF, {}, layers, BIND_PROBE);
      assertEquals(outcome.kind, "bound", `${route.realm} must bind from one --bind`);
      if (outcome.kind !== "bound") continue;
      assertEquals(outcome.binding.service, route.service, `${route.realm} bound service`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
