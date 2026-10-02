/**
 * @module ScenarioFrameworkMatrixExpanderTest
 * @path tests/scenario_framework/tests/unit/matrix_expander_test.ts
 * @description Phase 127 Step 2 — RED-first tests for the additive scenario `matrix:`
 *   block and its expander. A matrix scenario expands into one cell-run per cell, each
 *   overlaying EXA_CONFIG_PATH (the cell's preset — the provider selector, GAP-2) +
 *   EXA_SESSION_DELEGATE_TOOL + EXA_SESSION_DELEGATE_ENABLED onto the start-daemon step,
 *   and NEVER EXA_SESSION_DELEGATE_PROVIDER (the env var does not exist). Cells missing
 *   their binary / key / opt-in are recorded skipped (not failed). A scenario without a
 *   matrix block is unaffected (backward-compat). The GAP-7 wiring (EXA_CONFIG_PATH is the
 *   daemon's real config source) is asserted by source-grepping apps/daemon/main.ts; the
 *   full live config-swap is proven in Step 5's provider-live cutover.
 *   Phase 203 Step 2 adds the `from_catalog` preset selector, removes `axes`, and allows a
 *   per-cell `bindings`/`catalog` layer.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import { walk } from "@std/fs";
import {
  expandMatrix,
  type IMatrixBlock,
  type IMatrixCell,
  MATRIX_START_DAEMON_STEP_ID,
  MatrixSchema,
  overlayRequestBindings,
  stepsOnlySkippedCellsOwn,
} from "../../runner/matrix_expander.ts";
import { loadCellCatalog, resolveCatalogCells } from "../../runner/cell_catalog.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { buildRunBindingsFile, planScenarioBindings } from "../../runner/binding_layers.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { ConfigService } from "@exaix/core/config";
import { loadBindingLayers, resolveBinding } from "@exaix/ai";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

function startDaemonStep(): IScenarioStep {
  return {
    id: MATRIX_START_DAEMON_STEP_ID,
    type: ScenarioStepType.EXACTL,
    command: "daemon",
    args: ["start"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

function otherStep(): IScenarioStep {
  return {
    id: "submit-request",
    type: ScenarioStepType.EXACTL,
    command: "request",
    args: ["--file", "x"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

const FOUR_CELL_MATRIX: IMatrixBlock = {
  cells: [
    {
      tool: "opencode",
      provider: "direct",
      config: "configs/dogfood.toml",
      requires_bin: "opencode",
      requires_optin: "EXA_MATRIX_OPENCODE",
    },
    {
      tool: "opencode",
      provider: "openrouter",
      config: "configs/dogfood.openrouter.toml",
      requires_bin: "opencode",
      requires_optin: "EXA_MATRIX_OPENCODE",
      requires_key: "OPENROUTER_API_KEY",
    },
    {
      tool: "claude-code",
      provider: "direct",
      config: "configs/dogfood.claude.toml",
      requires_bin: "claude",
      requires_key: "ANTHROPIC_API_KEY",
    },
    {
      tool: "claude-code",
      provider: "openrouter",
      config: "configs/dogfood.claude.openrouter.toml",
      requires_bin: "claude",
      requires_key: "OPENROUTER_API_KEY",
    },
  ],
};

Deno.test("[scenario_matrix] MatrixSchema accepts the four-cell block", () => {
  const parsed = MatrixSchema.parse(FOUR_CELL_MATRIX);
  assertEquals(parsed.cells?.length, 4);
});

const DEFAULT_MATRIX_ENV = {
  OPENROUTER_API_KEY: "k",
  ANTHROPIC_API_KEY: "k",
  EXA_MATRIX_OPENCODE: "1",
};

Deno.test("[scenario_matrix] a scenario with a matrix block expands into one run per cell", () => {
  const steps = [startDaemonStep(), otherStep()];
  // All binaries present, all keys/optins present → every cell runs.
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
  });
  assertEquals(runs.length, 4);
  for (const run of runs) assertEquals(run.status, "run");
});

Deno.test("[scenario_matrix] a runnable cell overlays EXA_CONFIG_PATH (its preset) + EXA_SESSION_DELEGATE_TOOL + ENABLED onto start-daemon; no EXA_SESSION_DELEGATE_PROVIDER", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
  });

  const claudeOpenrouter = runs.find(
    (r) => r.cell.tool === "claude-code" && r.cell.provider === "openrouter",
  );
  assert(claudeOpenrouter, "claude-code/openrouter cell must be present");

  const daemon = claudeOpenrouter.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  assert(daemon, "start-daemon step must survive expansion");
  const env = daemon.env ?? {};
  assertEquals(env.EXA_CONFIG_PATH, "configs/dogfood.claude.openrouter.toml");
  assertEquals(env.EXA_SESSION_DELEGATE_TOOL, "claude-code");
  assertEquals(env.EXA_SESSION_DELEGATE_ENABLED, "true");
  assertEquals(
    env.EXA_SESSION_DELEGATE_PROVIDER,
    undefined,
    "EXA_SESSION_DELEGATE_PROVIDER must NOT be set — provider comes from the config preset (GAP-2)",
  );
});

Deno.test("[scenario_matrix] when configBaseDir is given, EXA_CONFIG_PATH is the cell preset resolved to an absolute path (daemon CWD is the workspace, not the repo)", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
  });

  const claudeDirect = runs.find(
    (r) => r.cell.tool === "claude-code" && r.cell.provider === "direct",
  );
  assert(claudeDirect, "claude-code/direct cell must be present");
  const daemon = claudeDirect.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  assert(daemon, "start-daemon step must survive expansion");
  const env = daemon.env ?? {};
  assertEquals(env.EXA_CONFIG_PATH, join(REPO_ROOT, "configs/dogfood.claude.toml"));
});

Deno.test("[scenario_matrix] a runnable cell whose steps lack a start-daemon step throws (no silent no-op overlay)", () => {
  // A matrix scenario MUST carry a start-daemon step — that is the only step the per-cell
  // env overlay targets. Without it the cell would boot with no delegate config and produce
  // a false green; expansion must fail loudly on this authoring error instead.
  const stepsWithoutDaemon = [otherStep()];
  assertThrows(
    () =>
      expandMatrix(stepsWithoutDaemon, FOUR_CELL_MATRIX, {
        env: DEFAULT_MATRIX_ENV,
        binOnPath: () => true,
      }),
    Error,
    MATRIX_START_DAEMON_STEP_ID,
  );
});

Deno.test("[scenario_matrix] a SKIPPED cell does not require a start-daemon step (skip short-circuits before overlay)", () => {
  // Skip resolution happens before the overlay, so a matrix whose cells all skip must not
  // throw even without a start-daemon step — nothing is overlaid.
  const stepsWithoutDaemon = [otherStep()];
  const runs = expandMatrix(stepsWithoutDaemon, FOUR_CELL_MATRIX, {
    env: {}, // no keys, no opt-in → every cell skips
    binOnPath: () => false, // no binaries → every cell skips
  });
  assertEquals(runs.length, 4);
  for (const run of runs) assertEquals(run.status, "skip");
});

Deno.test("[scenario_matrix] the overlay does not mutate non-daemon steps", () => {
  const steps = [startDaemonStep(), otherStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
  });
  const submit = runs[0].steps.find((s) => s.id === "submit-request");
  assert(submit, "non-daemon step must survive");
  assertEquals(submit.env, undefined, "non-daemon steps must not gain matrix env");
});

Deno.test("[scenario_matrix] a cell whose requires_bin is absent is recorded skipped, not failed", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: (bin) => bin === "claude", // opencode absent
  });
  const opencodeCells = runs.filter((r) => r.cell.tool === "opencode");
  for (const r of opencodeCells) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes("opencode"), `skip reason should name the missing binary; got ${r.skipReason}`);
  }
});

Deno.test("[scenario_matrix] a cell whose requires_key is unset is recorded skipped, not failed", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { EXA_MATRIX_OPENCODE: "1" }, // no keys
    binOnPath: () => true,
  });
  const keyed = runs.filter((r) => r.cell.requires_key);
  for (const r of keyed) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes(r.cell.requires_key ?? ""), `skip reason should name the missing key`);
  }
});

Deno.test("[scenario_matrix] selectedCell filters the matrix down to the one cell whose tool matches, skipping the rest", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
    selectedCell: "claude-code",
  });
  const runnable = runs.filter((r) => r.status === "run");
  assertEquals(runnable.length, 2, "both claude-code cells (direct + openrouter) remain runnable");
  for (const r of runnable) assertEquals(r.cell.tool, "claude-code");

  const skipped = runs.filter((r) => r.status === "skip");
  assertEquals(skipped.length, 2);
  for (const r of skipped) {
    assertEquals(r.cell.tool, "opencode");
    assert(
      r.skipReason?.includes("claude-code"),
      `skip reason should name the selected cell that excluded this one; got ${r.skipReason}`,
    );
  }
});

Deno.test("[scenario_matrix] selectedCell naming a tool absent from the matrix skips every cell", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
    selectedCell: "codex",
  });
  assertEquals(runs.length, 4);
  for (const r of runs) assertEquals(r.status, "skip");
});

const EXACTL_MULTI_PROVIDER_MATRIX: IMatrixBlock = {
  cells: [
    {
      tool: "exactl",
      provider: "anthropic",
      config: "configs/anthropic-no-delegate.toml",
      requires_bin: "true",
      requires_key: "ANTHROPIC_API_KEY",
    },
    {
      tool: "exactl",
      provider: "openai",
      config: "configs/openai-no-delegate.toml",
      requires_bin: "true",
      requires_key: "OPENAI_API_KEY",
    },
    {
      tool: "exactl",
      provider: "google",
      config: "configs/google-no-delegate.toml",
      requires_bin: "true",
      requires_key: "GOOGLE_API_KEY",
    },
  ],
};

Deno.test(
  "[scenario_matrix] selectedCell also matches by provider when multiple cells share the same tool (--cell openai selects only the openai exactl cell)",
  () => {
    const steps = [startDaemonStep()];
    const runs = expandMatrix(steps, EXACTL_MULTI_PROVIDER_MATRIX, {
      env: { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GOOGLE_API_KEY: "k" },
      binOnPath: () => true,
      selectedCell: "openai",
    });
    const runnable = runs.filter((r) => r.status === "run");
    assertEquals(
      runnable.length,
      1,
      "only the openai cell should be selected, not anthropic/google, despite all three sharing tool=exactl",
    );
    assertEquals(runnable[0].cell.provider, "openai");

    const skipped = runs.filter((r) => r.status === "skip");
    assertEquals(skipped.length, 2);
    for (const r of skipped) {
      assert(
        r.cell.provider === "anthropic" || r.cell.provider === "google",
        `unexpected skipped cell provider ${r.cell.provider}`,
      );
    }
  },
);

Deno.test(
  "[scenario_matrix] a step with cells: [...] runs only for cells whose tool is in the list",
  () => {
    const scopedStep: IScenarioStep = {
      ...otherStep(),
      id: "patch-blueprint-capability",
      cells: ["claude-code"],
    };
    const steps = [scopedStep, startDaemonStep()];
    const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
      env: DEFAULT_MATRIX_ENV,
      binOnPath: () => true,
    });

    for (const r of runs) {
      const hasScopedStep = r.steps.some((s) => s.id === "patch-blueprint-capability");
      if (r.cell.tool === "claude-code") {
        assert(hasScopedStep, "claude-code cells must keep the scoped step");
      } else {
        assert(!hasScopedStep, `${r.cell.tool}/${r.cell.provider} must drop the scoped step, not run it`);
      }
      // start-daemon must survive regardless — scoping one step must never remove another.
      assert(r.steps.some((s) => s.id === MATRIX_START_DAEMON_STEP_ID));
    }
  },
);

Deno.test(
  "[scenario_matrix] assert-no-dynamic-tool-calls with cells: [claude-code, opencode] drops the step for direct-API exactl cells",
  () => {
    const scopedStep: IScenarioStep = {
      ...otherStep(),
      id: "assert-no-dynamic-tool-calls",
      cells: ["claude-code", "opencode"],
    };
    const steps = [scopedStep, startDaemonStep()];

    const runsFour = expandMatrix(steps, FOUR_CELL_MATRIX, {
      env: DEFAULT_MATRIX_ENV,
      binOnPath: () => true,
    });
    for (const r of runsFour) {
      const hasScopedStep = r.steps.some((s) => s.id === "assert-no-dynamic-tool-calls");
      assert(hasScopedStep, `${r.cell.tool}/${r.cell.provider} (CLI delegate) must keep assert-no-dynamic-tool-calls`);
    }

    const runsExactl = expandMatrix(steps, EXACTL_MULTI_PROVIDER_MATRIX, {
      env: { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GOOGLE_API_KEY: "k" },
      binOnPath: () => true,
    });
    for (const r of runsExactl) {
      const hasScopedStep = r.steps.some((s) => s.id === "assert-no-dynamic-tool-calls");
      assert(
        !hasScopedStep,
        `${r.cell.tool}/${r.cell.provider} (direct-API exactl cell) must drop assert-no-dynamic-tool-calls`,
      );
    }
  },
);

Deno.test("[scenario_matrix] a step with no cells field runs for every cell, unchanged (backward-compat)", () => {
  const steps = [otherStep(), startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
  });
  for (const r of runs) {
    assertEquals(r.steps.length, 2, `${r.cell.tool}/${r.cell.provider} must keep every unscoped step`);
  }
});

Deno.test("[scenario_matrix] no selectedCell (default) runs every prerequisite-satisfied cell, unaffected (backward-compat)", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: DEFAULT_MATRIX_ENV,
    binOnPath: () => true,
  });
  for (const r of runs) assertEquals(r.status, "run");
});

Deno.test("[scenario_matrix] an opencode cell whose requires_optin is unset is recorded skipped", () => {
  const steps = [startDaemonStep()];
  const runs = expandMatrix(steps, FOUR_CELL_MATRIX, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, // no EXA_MATRIX_OPENCODE
    binOnPath: () => true,
  });
  const opencodeCells = runs.filter((r) => r.cell.tool === "opencode");
  for (const r of opencodeCells) {
    assertEquals(r.status, "skip");
    assert(r.skipReason?.includes("EXA_MATRIX_OPENCODE"), `skip reason should name the missing opt-in`);
  }
});

Deno.test("[scenario_matrix] a scenario WITHOUT a matrix block parses unchanged (backward-compat)", async () => {
  // The matrix field is .optional() and .strict()-compatible; a scenario that omits it must
  // still parse. Load an existing non-matrix provider_live scenario and confirm matrix is absent.
  const raw = await Deno.readTextFile(
    join(
      REPO_ROOT,
      "tests/scenario_framework/scenarios/provider_live/session_delegate_plan_review_live.yaml",
    ),
  );
  const parsed = ScenarioSchema.parse(parseYaml(raw));
  assertEquals(parsed.matrix, undefined, "a matrix-less scenario must parse with matrix undefined");
});

Deno.test("[scenario_matrix] GAP-7: EXA_CONFIG_PATH is the daemon's real config source (apps/daemon/main.ts reads it)", async () => {
  // The full live config-swap is proven separately with a real daemon end-to-end cutover.
  // Here we assert the wiring path exists: the expander overlays EXA_CONFIG_PATH, and the
  // daemon's bootstrap reads exactly that env var to choose the config it loads.
  const mainSrc = await Deno.readTextFile(join(REPO_ROOT, "apps", "daemon", "main.ts"));
  assert(
    mainSrc.includes('Deno.env.get("EXA_CONFIG_PATH")'),
    "apps/daemon/main.ts must read EXA_CONFIG_PATH so the matrix overlay swaps the loaded config",
  );
});

Deno.test("[bindings] overlayRequestBindings gives every exactl request step its --overlay args in layer order", async () => {
  const root = await Deno.makeTempDir({ prefix: "matrix-overlay-bindings-" });
  try {
    const scenario = ScenarioSchema.parse({
      schema_version: SCHEMA_VERSION,
      id: "binding-args-smoke",
      title: "Binding args smoke",
      pack: "agent_flows",
      tags: ["smoke"],
      request_fixture: "fixtures/requests/agent_flows/openai_compatible_native.md",
      mode_support: ["auto"],
      portals: [],
      bindings: { "flow:research/step:compose": { service: "alpha" } },
      steps: [
        { id: "start-daemon", type: "exactl", command: "daemon start" },
        {
          id: "first-request",
          type: "exactl",
          command: "request",
          args: ["--file", "$REQUEST_FIXTURE"],
          bindings: { "flow:research/step:compose": { model: "alpha/one" } },
        },
        { id: "second-request", type: "exactl", command: "request", args: ["--file", "$REQUEST_FIXTURE"] },
      ],
    });
    const plan = await planScenarioBindings({
      scenario,
      operatorOverlays: [],
      operatorBinds: ["flow:research/step:compose=service=beta"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    const steps = overlayRequestBindings(scenario.steps, plan);

    // A daemon step is never an `exactl request` step, so it gets no overlay argument.
    const daemon = steps.find((s) => s.id === "start-daemon")!;
    assertEquals(daemon.args, undefined);

    const first = steps.find((s) => s.id === "first-request")!;
    const second = steps.find((s) => s.id === "second-request")!;
    const overlayArgs = (step: IScenarioStep): string[] => {
      const args = step.args ?? [];
      return args.flatMap((arg, index) => (arg === "--overlay" ? [args[index + 1]!] : []));
    };
    const firstName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

    // Ascending layer order: scenario, this step's own overlay, then the operator bind file.
    assertEquals(
      overlayArgs(first).map(firstName),
      ["10-scenario.json", "25-step-first-request.json", "40-operator-bind.json"],
    );
    // The step overlay reaches only the step that declares it. The operator file reaches both.
    assertEquals(
      overlayArgs(second).map(firstName),
      ["10-scenario.json", "40-operator-bind.json"],
    );
    // The original args survive, and every overlay path is absolute and outside the sandbox.
    assertEquals(first.args?.slice(0, 2), ["--file", "$REQUEST_FIXTURE"]);
    for (const path of overlayArgs(first)) {
      assert(path.startsWith(root), `overlay ${path} must live under the run output dir`);
      assert(!path.includes("/sandbox/"), `overlay ${path} must not live inside the sandbox`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");
const CELL_CATALOG_PATH = join(REPO_ROOT, "configs", "eval-cells.toml");
const FIX_BUG_NULL_GUARD_PATH = join(FRAMEWORK_HOME, "scenarios", "swe_tasks", "fix-bug-null-guard.yaml");

Deno.test("[matrix] cells and from_catalog are mutually exclusive, and axes is rejected", () => {
  const oneCell = [{
    tool: "exactl",
    provider: "anthropic",
    config: "configs/anthropic-no-delegate.toml",
    requires_bin: "true",
  }];

  assertEquals(MatrixSchema.safeParse({ cells: oneCell }).success, true);
  assertEquals(MatrixSchema.safeParse({ from_catalog: ["exactl-native"] }).success, true);

  // A matrix must name its cells exactly once, so declaring both forms is an authoring error.
  assertEquals(
    MatrixSchema.safeParse({ cells: oneCell, from_catalog: ["exactl-native"] }).success,
    false,
    "cells and from_catalog together must be rejected",
  );
  assertEquals(MatrixSchema.safeParse({}).success, false, "a matrix must name cells somehow");
  assertEquals(MatrixSchema.safeParse({ cells: [] }).success, false, "an empty cells list must be rejected");
  assertEquals(
    MatrixSchema.safeParse({ from_catalog: [] }).success,
    false,
    "an empty from_catalog list must be rejected",
  );
  assertEquals(
    MatrixSchema.safeParse({ cells: oneCell, axes: { tool: ["exactl"] } }).success,
    false,
    "axes is no longer a matrix field",
  );
});

Deno.test("[matrix] a cell may carry its own bindings and catalog for the cell layer", () => {
  const parsed = MatrixSchema.parse({
    cells: [{
      tool: "exactl",
      provider: "anthropic",
      config: "configs/anthropic-no-delegate.toml",
      requires_bin: "true",
      bindings: { default: { model: "anthropic/claude-sonnet-5" } },
      catalog: {
        services: {
          fixture: {
            adapter: "openai-chat",
            transport: "local",
            interface: "api",
            serves: { "*": "{name}" },
          },
        },
      },
    }],
  });

  assertEquals(parsed.cells?.[0]?.bindings?.default?.model, "anthropic/claude-sonnet-5");
  assertEquals(parsed.cells?.[0]?.catalog?.services?.fixture?.adapter, "openai-chat");
});

Deno.test("[matrix] every shipped scenario parses, and no scenario, fixture or README declares axes", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  assert(catalog.length >= 200, `the scenario corpus must still load, saw ${catalog.length} entries`);

  const offenders: string[] = [];
  for await (
    const entry of walk(FRAMEWORK_HOME, { exts: [".yaml"], includeDirs: false })
  ) {
    const raw = await Deno.readTextFile(entry.path);
    if (/^\s*axes:/m.test(raw)) offenders.push(entry.path);
  }
  assertEquals(offenders, [], "no scenario or fixture file may declare axes");

  const readme = await Deno.readTextFile(join(FRAMEWORK_HOME, "README.md"));
  assertEquals(/^\s*axes:/m.test(readme), false, "the README must not document a matrix.axes field");
});

/** The six cells fix-bug-null-guard declared by hand before the catalog migration. */
const PRIOR_HAND_LISTED_CELLS: IMatrixCell[] = [
  {
    tool: "claude-code",
    provider: "$CELL_PROVIDER",
    config: "configs/claude-cli-delegate-all.toml",
    requires_bin: "claude",
  },
  { tool: "codex", provider: "$CELL_PROVIDER", config: "configs/codex-cli-react.toml", requires_bin: "codex" },
  {
    tool: "opencode",
    provider: "$CELL_PROVIDER",
    config: "configs/opencode-cli-delegate-all.toml",
    requires_bin: "opencode",
  },
  {
    tool: "exactl",
    provider: "anthropic",
    config: "configs/anthropic-no-delegate.toml",
    requires_bin: "true",
    requires_key: "ANTHROPIC_API_KEY",
  },
  {
    tool: "exactl",
    provider: "openai",
    config: "configs/openai-no-delegate.toml",
    requires_bin: "true",
    requires_key: "OPENAI_API_KEY",
  },
  {
    tool: "exactl",
    provider: "google",
    config: "configs/google-no-delegate.toml",
    requires_bin: "true",
    requires_key: "GOOGLE_API_KEY",
  },
];

/** The provider label the daemon reports for a preset's config: its own `[ai].provider`. */
function configProvider(configRelPath: string): string {
  const raw = Deno.readTextFileSync(join(REPO_ROOT, configRelPath));
  const parsed = parseToml(raw) as { ai?: { provider?: string } };
  return parsed.ai?.provider ?? "";
}

Deno.test(
  "[regression] fix-bug-null-guard's from_catalog form selects the same six cell ids as its prior hand-listed form",
  async () => {
    const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(FIX_BUG_NULL_GUARD_PATH)));
    const matrix = scenario.matrix;
    assert(matrix, "fix-bug-null-guard must declare a matrix");
    assertEquals(matrix.cells, undefined, "the migrated scenario must select cells through from_catalog");
    assertEquals(matrix.from_catalog, [
      "claude-code",
      "codex",
      "opencode",
      "exactl-native",
      "exactl-openai",
      "exactl-google",
    ]);

    const catalog = await loadCellCatalog(CELL_CATALOG_PATH);
    const resolved = resolveCatalogCells(catalog, matrix.from_catalog!);

    // The history cell id is `${tool}-${config provider}`. The regression is equal ids,
    // not equal `provider:` text.
    const idOf = (cell: IMatrixCell) => `${cell.tool}-${configProvider(cell.config)}`;
    assertEquals(resolved.map(idOf), PRIOR_HAND_LISTED_CELLS.map(idOf));
    assertEquals(resolved.map(idOf), [
      "claude-code-claude-cli",
      "codex-codex-cli",
      "opencode-opencode-cli",
      "exactl-anthropic",
      "exactl-openai",
      "exactl-google",
    ]);

    // The declared predicates and configs survive the migration unchanged.
    assertEquals(resolved.map((cell) => cell.config), PRIOR_HAND_LISTED_CELLS.map((cell) => cell.config));
    assertEquals(
      resolved.map((cell) => cell.requires_bin),
      PRIOR_HAND_LISTED_CELLS.map((cell) => cell.requires_bin),
    );
    assertEquals(
      resolved.map((cell) => cell.requires_key),
      PRIOR_HAND_LISTED_CELLS.map((cell) => cell.requires_key),
    );
  },
);

Deno.test("[matrix] the resolved catalog cells expand into runnable groups with the same predicates", async () => {
  const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(FIX_BUG_NULL_GUARD_PATH)));
  const catalog = await loadCellCatalog(CELL_CATALOG_PATH);
  const resolved: IMatrixBlock = { cells: resolveCatalogCells(catalog, scenario.matrix!.from_catalog!) };

  // Three API cells gate on a key. Three CLI cells gate on a binary. With every binary
  // present, only the API cells are skipped.
  const withoutKeys = expandMatrix(scenario.steps, resolved, { env: {}, binOnPath: () => true });
  assertEquals(withoutKeys.length, 6);
  assertEquals(
    withoutKeys.filter((run) => run.status === "skip").map((run) => run.cell.provider),
    ["anthropic", "openai", "google"],
  );

  // With every binary and key present all six resolved cells run.
  const withKeys = expandMatrix(scenario.steps, resolved, {
    env: { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GOOGLE_API_KEY: "k" },
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
  });
  assertEquals(withKeys.filter((run) => run.status === "run").length, 6);

  // --cell narrows the matrix to one API cell, which keeps the tool its preset declares.
  const selected = expandMatrix(scenario.steps, resolved, {
    env: { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GOOGLE_API_KEY: "k" },
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
    selectedCell: "anthropic",
  });
  const runnable = selected.filter((run) => run.status === "run");
  assertEquals(runnable.map((run) => run.cell.tool), ["exactl"]);
  assertEquals(runnable.map((run) => run.cell.provider), ["anthropic"]);

  // The runnable cell overlays its own config and tool onto the single start-daemon step.
  const daemon = runnable[0]!.steps.find((step) => step.id === MATRIX_START_DAEMON_STEP_ID);
  assertEquals(daemon?.env?.EXA_CONFIG_PATH, join(REPO_ROOT, runnable[0]!.cell.config));
  assertEquals(daemon?.env?.EXA_SESSION_DELEGATE_TOOL, "exactl");
});

/** A step the live cell alone selects, so a mock-cell run never reaches it. */
function liveOnlyStep(): IScenarioStep {
  return {
    id: "validate-live-plan",
    type: ScenarioStepType.JSON_ASSERT,
    cells: ["live"],
    file_pattern: "**/*_plan.md",
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

Deno.test("[step8] a step only a skipped cell owns stays out of the suite-score penalty", () => {
  // A two-cell matrix whose live cell is opt-in: the mock cell runs and the live cell is skipped.
  // The live cell's own step never had a chance to run here.
  // Scoring it 0 would report a mock-cell failure that never happened.
  // Shared and mock-scoped steps must stay scored.
  const steps = [startDaemonStep(), otherStep(), liveOnlyStep()];
  const matrix: IMatrixBlock = {
    cells: [
      {
        tool: "exactl",
        provider: "mock",
        config: "configs/agent-flows-mock-pattern.toml",
        requires_bin: "true",
      },
      {
        tool: "live",
        provider: "live",
        config: "configs/anthropic-no-delegate.toml",
        requires_bin: "true",
        requires_optin: "EXA_MATRIX_AGENT_ROLE_LIVE",
      },
    ],
  };
  const groups = expandMatrix(steps, matrix, { env: {}, binOnPath: () => true });
  assertEquals(groups.map((group) => group.status), ["run", "skip"]);

  const excluded = stepsOnlySkippedCellsOwn(groups, steps);
  assertEquals([...excluded], ["validate-live-plan"]);
  assertEquals(excluded.has(MATRIX_START_DAEMON_STEP_ID), false, "a shared step must stay scored");
  assertEquals(excluded.has("submit-request"), false, "the runnable cell's own step must stay scored");
});

/** One Step 8 migration: the scenario, the presets it now names, and the cells it hand-listed. */
interface IMigratedScenario {
  id: string;
  path: string;
  presets: string[];
  priorCells: PriorCellRow[];
}

/** A hand-listed cell as Step 8 found it: tool, provider, config, binary, key, opt-in. */
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

/** The seven named scenarios Step 8 migrates, with the exact cells each one declared by hand. */
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
    ],
    priorCells: [
      ["claude-code", "claude-cli", "configs/planning-live.claude.toml", "claude"],
      ["codex", "codex-cli", "configs/planning-live.codex.toml", "codex", undefined, "EXA_MATRIX_CODEX"],
      ["opencode", "opencode-cli", "configs/planning-live.opencode.toml", "opencode", undefined, "EXA_MATRIX_OPENCODE"],
      ["exactl", "anthropic", "configs/planning-live.anthropic.toml", "true", "ANTHROPIC_API_KEY"],
      ["exactl", "openai", "configs/planning-live.openai.toml", "true", "OPENAI_API_KEY"],
      ["exactl", "google", "configs/planning-live.google.toml", "true", "GOOGLE_API_KEY"],
      ["exactl", "openrouter", "configs/planning-live.openrouter.toml", "true", "OPENROUTER_API_KEY"],
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
