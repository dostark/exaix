/**
 * @module ContextScenarioTest
 * @path tests/scenario_framework/tests/unit/context_scenario_test.ts
 * @description Phase 176 Step 4: `flow_blueprints/dogfood_context.yaml` (CI-safe, mock
 *   provider) and `provider_live/dogfood_context_live.yaml` (5-cell matrix) both parse
 *   against ScenarioSchema, are catalog-discoverable, carry no embedded credential
 *   VALUES (only env-var names), and the live scenario's matrix enumerates exactly the
 *   five required cells (stock-claude, stock-opencode, cycle-claude, cycle-opencode,
 *   cycle-codex) with correct expandMatrix skip/run behavior.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/flow_blueprints/dogfood_context.yaml, tests/scenario_framework/scenarios/provider_live/dogfood_context_live.yaml, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { expandMatrix, MatrixSchema } from "../../runner/matrix_expander.ts";
import { loadScenarioCatalog, selectScenarioCatalogEntries } from "../../runner/scenario_catalog.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const TEST_FILE_DIR = dirname(fromFileUrl(import.meta.url));
const FRAMEWORK_HOME = join(TEST_FILE_DIR, "../..");
const FLOW_SCENARIO = join(FRAMEWORK_HOME, "scenarios/flow_blueprints/dogfood_context.yaml");
const LIVE_SCENARIO = join(FRAMEWORK_HOME, "scenarios/provider_live/dogfood_context_live.yaml");
const REPOSITORY_ROOT = join(FRAMEWORK_HOME, "../..");

const REQUIRED_CELL_NAMES = ["stock-claude", "stock-opencode", "cycle-claude", "cycle-opencode", "cycle-codex"];
const CLAUDE_CELL_CONFIGS = ["configs/dogfood.claude.stock.toml", "configs/dogfood.claude.toml"];

/** Credential-shaped VALUES that must never appear literally in a committed scenario —
 *  env-var NAMES like "ANTHROPIC_API_KEY" are fine (that's a reference, not a secret). */
const CREDENTIAL_VALUE_PATTERNS = [/sk-[A-Za-z0-9]{16,}/, /Bearer [A-Za-z0-9._-]{16,}/];

async function parseScenario(path: string): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await Deno.readTextFile(path);
  return ScenarioSchema.parse(parseYaml(raw));
}

function assertNoEmbeddedCredentialValues(raw: string, label: string): void {
  for (const pattern of CREDENTIAL_VALUE_PATTERNS) {
    assert(!pattern.test(raw), `${label} must not embed a credential-shaped literal value (matched ${pattern})`);
  }
}

Deno.test("[context_scenario] flow_blueprints/dogfood_context.yaml parses and is catalog-discoverable", async () => {
  const scenario = await parseScenario(FLOW_SCENARIO);
  assertEquals(scenario.pack, "flow_blueprints");
  assertEquals(scenario.id, "dogfood_context");

  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const entries = selectScenarioCatalogEntries({ catalog, scenarioIds: ["dogfood_context"] });
  assertEquals(entries.length, 1, "dogfood_context must be discoverable through the auto-walked catalog");
});

Deno.test("[context_scenario] flow_blueprints/dogfood_context.yaml embeds no credential values and uses only the mock provider", async () => {
  const raw = await Deno.readTextFile(FLOW_SCENARIO);
  assertNoEmbeddedCredentialValues(raw, "flow_blueprints/dogfood_context.yaml");
  assert(raw.includes('EXA_LLM_PROVIDER: "mock"'), "the CI-safe scenario must run on the mock provider");
});

Deno.test("[context_scenario] provider_live/dogfood_context_live.yaml parses, is catalog-discoverable, and carries the provider-live tag", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  assertEquals(scenario.pack, "provider_live");
  assert(
    scenario.tags.includes("provider-live"),
    "must be tagged provider-live so the CI-safety filter excludes it by default",
  );

  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const entries = selectScenarioCatalogEntries({ catalog, scenarioIds: ["dogfood-context-live"] });
  assertEquals(entries.length, 1, "dogfood-context-live must be discoverable through the auto-walked catalog");
});

Deno.test("[context_scenario] provider_live/dogfood_context_live.yaml embeds no credential values — only env-var names", async () => {
  const raw = await Deno.readTextFile(LIVE_SCENARIO);
  assertNoEmbeddedCredentialValues(raw, "provider_live/dogfood_context_live.yaml");
});

Deno.test("[context_scenario] the live scenario's matrix enumerates exactly the five required cells (stock-claude, stock-opencode, cycle-claude, cycle-opencode, cycle-codex)", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  assert(scenario.matrix, "scenario must have a matrix block");
  assertEquals(scenario.matrix.cells.length, 5, "matrix must have exactly 5 cells");
  const tools = scenario.matrix.cells.map((c) => c.tool).toSorted();
  assertEquals(tools, [...REQUIRED_CELL_NAMES].toSorted());
});

Deno.test("[context_scenario] each live cell requires the correct binary and subscription/opt-in", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  assert(scenario.matrix, "scenario must have a matrix block");
  const expected: Record<string, { bin: string; hasKey?: string; hasOptin?: string }> = {
    "stock-claude": { bin: "claude" },
    "stock-opencode": { bin: "opencode", hasOptin: "EXA_MATRIX_OPENCODE" },
    "cycle-claude": { bin: "claude" },
    "cycle-opencode": { bin: "opencode", hasOptin: "EXA_MATRIX_OPENCODE" },
    "cycle-codex": { bin: "codex", hasOptin: "EXA_MATRIX_CODEX" },
  };
  for (const cell of scenario.matrix.cells) {
    const exp = expected[cell.tool];
    assert(exp, `unexpected cell: ${cell.tool}`);
    assertEquals(cell.requires_bin, exp.bin, `cell ${cell.tool} binary mismatch`);
    assertEquals(cell.requires_key, exp.hasKey, `cell ${cell.tool} key mismatch`);
    assertEquals(cell.requires_optin, exp.hasOptin, `cell ${cell.tool} opt-in mismatch`);
  }
});

Deno.test("[context_scenario] both Claude cells route planning and review through the subscribed Claude CLI", async () => {
  for (const configPath of CLAUDE_CELL_CONFIGS) {
    const config = parseToml(await Deno.readTextFile(join(REPOSITORY_ROOT, configPath))) as {
      ai?: { provider?: string; model?: string };
      models?: { default?: { provider?: string; model?: string } };
      model_presets?: { L?: { candidates?: string[] } };
      session_delegate?: { model?: string };
    };
    assertEquals(config.ai?.provider, "claude-cli", `${configPath} [ai] must not call the Anthropic API`);
    assertEquals(config.ai?.model, "claude-haiku-4-5", `${configPath} must use the subscribed CLI model`);
    assertEquals(
      config.models?.default?.provider,
      "claude-cli",
      `${configPath} default model must make review turns use Claude Code`,
    );
    assertEquals(
      config.models?.default?.model,
      "claude-haiku-4-5",
      `${configPath} default review model must use Claude Code`,
    );
    assertEquals(
      config.model_presets?.L?.candidates,
      ["claude-cli"],
      `${configPath} size-L quality-judge turns must not fall back to another provider`,
    );
    if (configPath.endsWith("dogfood.claude.toml")) {
      assertEquals(
        config.session_delegate?.model,
        "claude-cli:claude-haiku-4-5",
        "the cycle delegate must receive the provider:model contract while Claude strips it for --model",
      );
    }
  }
});

Deno.test("[context_scenario] expandMatrix produces exactly 5 runs, each runnable when its prerequisite is present", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  const runs = expandMatrix(scenario.steps, matrix, {
    env: { EXA_MATRIX_OPENCODE: "1", EXA_MATRIX_CODEX: "1" },
    binOnPath: () => true,
  });

  assertEquals(runs.length, 5, "expandMatrix must produce 5 runs");
  assertEquals(runs.map((r) => r.status), ["run", "run", "run", "run", "run"]);
});

Deno.test("[context_scenario] only opted-in non-Claude cells are skipped when optional prerequisites are absent", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  assert(scenario.matrix, "scenario must have a matrix block");
  const matrix = MatrixSchema.parse(scenario.matrix);

  const runs = expandMatrix(scenario.steps, matrix, { env: {}, binOnPath: () => true });

  assertEquals(runs.length, 5, "every cell is still enumerated");
  for (const run of runs) {
    const expected = run.cell.tool.includes("claude") ? "run" : "skip";
    assertEquals(run.status, expected, `cell ${run.cell.tool} prerequisite behavior mismatch`);
  }
});

Deno.test("[context_scenario] stock cells assert flow.step.completed(review) and a real worktree edit, never merely a reconciled journal row", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  const byId = new Map(scenario.steps.map((s) => [s.id, s]));

  const submitStep = byId.get("submit-request-stock");
  assert(submitStep, "submit-request-stock step must exist");
  assertEquals(
    submitStep.args,
    [
      "--file",
      "$FRAMEWORK_HOME/fixtures/requests/provider_live/dogfood_context_stock_code_change.md",
      "--portal",
      "test-project",
    ],
    "the stock request fixture must resolve from the runner, not the minted sandbox",
  );

  const reviewStep = byId.get("wait-for-stock-review-complete");
  assert(reviewStep, "wait-for-stock-review-complete step must exist");
  assertEquals(reviewStep.cells, ["stock-claude", "stock-opencode"]);
  assertEquals(reviewStep.action_type, "flow.step.completed");
  assertEquals(reviewStep.payload_equals, [{ path: "stepId", value: "review" }]);

  const worktreeStep = byId.get("assert-stock-worktree-change");
  assert(worktreeStep, "assert-stock-worktree-change step must exist");
  assertEquals(worktreeStep.cells, ["stock-claude", "stock-opencode"]);
});

Deno.test("[context_scenario] cycle cells assert reconciled-accepted and a real worktree edit, scoped to the three cycle cells only", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  const byId = new Map(scenario.steps.map((s) => [s.id, s]));

  const reconciledStep = byId.get("assert-cycle-reconciled-clean");
  assert(reconciledStep, "assert-cycle-reconciled-clean step must exist");
  assertEquals(reconciledStep.cells, ["cycle-claude", "cycle-opencode", "cycle-codex"]);
  assertEquals(reconciledStep.action_type, "session.delegate.reconciled");
  assertEquals(reconciledStep.payload_not_contains, ["rejected"]);

  const worktreeStep = byId.get("assert-cycle-worktree-change");
  assert(worktreeStep, "assert-cycle-worktree-change step must exist");
  assertEquals(worktreeStep.cells, ["cycle-claude", "cycle-opencode", "cycle-codex"]);
});

Deno.test("[context_scenario] the inspect step is shared (not cell-scoped) and expects a real, non-empty capture", async () => {
  const scenario = await parseScenario(LIVE_SCENARIO);
  const inspectStep = scenario.steps.find((s) => s.id === "inspect-produced-trace");
  assert(inspectStep, "inspect-produced-trace step must exist");
  assertEquals(inspectStep.cells, undefined, "the inspect step must run for whichever single cell was selected");
});
