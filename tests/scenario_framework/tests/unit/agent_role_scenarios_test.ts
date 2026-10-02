/**
 * @module AgentRoleScenariosTest
 * @path tests/scenario_framework/tests/unit/agent_role_scenarios_test.ts
 * @description Phase 203 Step 8 — each agent role ships one scenario instead of a mock smoke
 *   plus a live validation copy. The merged scenario keeps the smoke id, pack and tags, takes
 *   the union of both files' `mode_support`, and declares two matrix cells. The mock cell runs
 *   the smoke's structural criteria on the pattern mock. The live cell is opt-in and runs the
 *   validation's criteria, including its `llm-judge` criterion through a judge binding.
 *
 *   `code-analyst` is excluded from the merge. Its pair differs in operation (`--plan-only`
 *   against `--analyze`) and in asserted artifact (`*_plan.md` against `*_analysis.json`), so
 *   both scenarios stay. This file records that per-role verdict and proves it.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/judge_bindings.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { fromFileUrl, join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { type IRunBindingsFile, RunBindingsFileSchema } from "@exaix/schemas";
import { expandMatrix, type IMatrixCell } from "../../runner/matrix_expander.ts";
import { isJudgeBearingStep, resolveJudgeBindings } from "../../runner/judge_bindings.ts";
import { CriterionKind, type IScenarioStep } from "../../schema/step_schema.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import type { IScenario } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");
const SCENARIOS_DIR = join(FRAMEWORK_HOME, "scenarios");

/** The opt-in that gates every merged live cell, so CI records a skip. */
const LIVE_CELL_OPT_IN = "EXA_MATRIX_AGENT_ROLE_LIVE";
/** Tool of the mock cell. It keeps the proven pattern-mock matrix shape. */
const MOCK_CELL_TOOL = "exactl";
/** Tool of the live cell. `--cell live` selects it by tool. */
const LIVE_CELL_TOOL = "live";
/** The request fixture every merged pair already shared. */
const MERGED_MODE_SUPPORT = ["auto", "step"];

/** The judge preset each merged role's live cell grades through. */
const MERGED_ROLES: Record<string, string> = {
  "performance-engineer": "GOAL_ALIGNED_REVIEW",
  "product-manager": "CONTENT_QUALITY",
  "qa-engineer": "GOAL_ALIGNED_REVIEW",
  "quality-judge": "GOAL_ALIGNED_REVIEW",
  "security-expert": "SECURITY_REVIEW",
  "senior-coder": "GOAL_ALIGNED_REVIEW",
  "software-architect": "GOAL_ALIGNED_REVIEW",
  "technical-writer": "CONTENT_QUALITY",
  "test-engineer": "GOAL_ALIGNED_REVIEW",
};

/** The one pair whose operation and asserted artifact differ, so it stays split in two. */
const SPLIT_ROLE = "code-analyst";

/**
 * The per-role merge verdict, recorded once here so a later role cannot be merged silently.
 * A merged role keeps both files' criteria in their assigned cells. The split role keeps both
 * scenarios, because one waits on a plan and the other waits on an analysis document.
 */
const MERGE_VERDICTS: Record<string, "merged" | "split"> = {
  ...Object.fromEntries(Object.keys(MERGED_ROLES).map((role) => [role, "merged" as const])),
  [SPLIT_ROLE]: "split",
};

function mergedScenarioPath(role: string): string {
  return join(SCENARIOS_DIR, "agent_role_eval", `${role}-smoke.yaml`);
}

async function readScenario(path: string) {
  return ScenarioSchema.parse(parseYaml(await Deno.readTextFile(path)));
}

/** The `[ai].provider` a cell's config pins, or an empty string when it pins none. */
function configProvider(configRelPath: string): string {
  const raw = Deno.readTextFileSync(join(REPO_ROOT, configRelPath));
  const parsed = parseToml(raw) as { ai?: { provider?: string } };
  return parsed.ai?.provider ?? "";
}

/** The two cells of a merged scenario, keyed by the tool that scopes a step to them. */
function cellsByTool(cells: readonly IMatrixCell[]): { mock: IMatrixCell; live: IMatrixCell } {
  const mock = cells.find((cell) => cell.tool === MOCK_CELL_TOOL);
  const live = cells.find((cell) => cell.tool === LIVE_CELL_TOOL);
  assert(mock, `no '${MOCK_CELL_TOOL}' mock cell`);
  assert(live, `no '${LIVE_CELL_TOOL}' live cell`);
  return { mock, live };
}

/** Every criterion kind a step group owns, in declaration order. */
function criterionKinds(steps: readonly IScenarioStep[]): string[] {
  return steps.flatMap((step) =>
    [...step.input_criteria, ...step.output_criteria].map((criterion) => criterion.kind as string)
  );
}

/** The judge criterion's preset, when the step group owns one. */
function judgePreset(steps: readonly IScenarioStep[]): string | undefined {
  for (const step of steps) {
    for (const criterion of [...step.input_criteria, ...step.output_criteria]) {
      if (criterion.kind === CriterionKind.LLM_JUDGE) return criterion.preset;
    }
  }
  return undefined;
}

/** The scenario layer's bindings, as the runner writes them into the run's first overlay. */
function scenarioRunFile(bindings: IScenario["bindings"], requestPath: string): IRunBindingsFile {
  return RunBindingsFileSchema.parse({
    schema: 1,
    trace_id: crypto.randomUUID(),
    request_path: requestPath,
    request_sha256: "a".repeat(64),
    created_at: new Date().toISOString(),
    overlays: [{
      source_path: "10-scenario.json",
      sha256: "b".repeat(64),
      overlay: { schema: 1, bindings },
    }],
    binds: [],
  });
}

Deno.test("[agent_role_merge] every role with a smoke/validation pair carries a recorded verdict", () => {
  const roles = Object.keys(MERGE_VERDICTS).sort();
  assertEquals(roles, [...Object.keys(MERGED_ROLES), SPLIT_ROLE].sort());
  assertEquals(Object.values(MERGE_VERDICTS).filter((verdict) => verdict === "merged").length, 9);
  assertEquals(MERGE_VERDICTS[SPLIT_ROLE], "split");
});

Deno.test("[agent_role_merge] each merged role keeps the smoke id, pack, tags and the union mode_support", async () => {
  for (const role of Object.keys(MERGED_ROLES)) {
    const scenario = await readScenario(mergedScenarioPath(role));
    assertEquals(scenario.id, `${role}-smoke`, `${role} must keep the smoke id`);
    assertEquals(scenario.pack, "agent_role_eval", `${role} must keep the smoke pack`);
    assertEquals(scenario.tags.includes("provider-live"), false, `${role} must not carry the provider-live tag`);
    for (const tag of ["smoke", "subsystem:agent_roles", `entity:${role}`]) {
      assert(scenario.tags.includes(tag), `${role} must keep the '${tag}' tag`);
    }
    // The union of ["auto"] and ["auto", "step"], so `step` mode still runs the live cell.
    assertEquals(scenario.mode_support, MERGED_MODE_SUPPORT, `${role} mode_support must be the union`);
  }
});

Deno.test("[agent_role_merge] each merged role declares a pattern-mock cell and an opt-in live cell", async () => {
  for (const role of Object.keys(MERGED_ROLES)) {
    const scenario = await readScenario(mergedScenarioPath(role));
    assert(scenario.matrix?.cells, `${role} must still declare matrix cells`);
    assertEquals(scenario.matrix.cells.length, 2, `${role} must declare exactly two cells`);
    const { mock, live } = cellsByTool(scenario.matrix.cells);

    // The mock cell runs on the pattern mock, whose config names its own provider.
    assertEquals(mock.config, "configs/agent-flows-mock-pattern.toml", `${role} mock cell config`);
    assertEquals(mock.provider, "mock", `${role} mock cell provider`);
    assertEquals(configProvider(mock.config), "mock", `${role} mock cell config must pin provider mock`);
    assertEquals(mock.requires_optin, undefined, `${role} mock cell must run in CI`);

    // The live cell is opt-in, so CI records a skip instead of a failure.
    assertEquals(live.requires_optin, LIVE_CELL_OPT_IN, `${role} live cell needs the opt-in`);
    assertEquals(live.config, "configs/anthropic-no-delegate.toml", `${role} live cell config`);
    assert(live.requires_key, `${role} live cell must gate on its provider key`);
    assertEquals(configProvider(live.config), "anthropic", `${role} live cell config provider`);
  }
});

Deno.test("[agent_role_merge] the mock cell keeps the smoke criteria and the live cell keeps the validation criteria", async () => {
  for (const [role, preset] of Object.entries(MERGED_ROLES)) {
    const scenario = await readScenario(mergedScenarioPath(role));
    const { mock, live } = cellsByTool(scenario.matrix!.cells!);
    const mockSteps = scenario.steps.filter((step) => step.cells?.includes(mock.tool));
    const liveSteps = scenario.steps.filter((step) => step.cells?.includes(live.tool));

    const mockKinds = criterionKinds(mockSteps);
    for (const kind of ["frontmatter-field-equals", "frontmatter-field-exists", "text-matches"]) {
      assert(mockKinds.includes(kind), `${role} mock cell must keep the '${kind}' criterion`);
    }
    assertEquals(judgePreset(mockSteps), undefined, `${role} mock cell must not run a judge`);

    const liveKinds = criterionKinds(liveSteps);
    for (const kind of ["json-path-exists", "llm-judge"]) {
      assert(liveKinds.includes(kind), `${role} live cell must keep the '${kind}' criterion`);
    }
    assertEquals(judgePreset(liveSteps), preset, `${role} live cell judge preset`);

    // Both cells still submit the same request fixture the pair already shared. The live cell
    // keeps the portal the validation mounted. The mock cell never needed one.
    const mockSubmit = mockSteps.find((step) => step.command === "request");
    const liveSubmit = liveSteps.find((step) => step.command === "request");
    assert(mockSubmit?.args?.includes("--agent-role") && mockSubmit.args.includes(role), `${role} mock request`);
    assert(liveSubmit?.args?.includes("--portal") && liveSubmit.args.includes("portal-exaix"), `${role} live portal`);
  }
});

Deno.test("[agent_role_merge] no provider_live validation file survives for a merged role", async () => {
  for (const role of Object.keys(MERGED_ROLES)) {
    const validationPath = join(SCENARIOS_DIR, "provider_live", `${role}-validation.yaml`);
    const exists = await Deno.stat(validationPath).then(() => true).catch(() => false);
    assertEquals(exists, false, `${role} must not keep a separate validation scenario`);
  }
  // The split role keeps both files, and the live-only validations without a mock twin stay.
  for (
    const kept of ["code-analyst-validation.yaml", "api-documenter-validation.yaml", "code-reviewer-validation.yaml"]
  ) {
    const exists = await Deno.stat(join(SCENARIOS_DIR, "provider_live", kept)).then(() => true).catch(() => false);
    assertEquals(exists, true, `${kept} must stay`);
  }
  const splitSmoke = await Deno.stat(join(SCENARIOS_DIR, "agent_role_eval", `${SPLIT_ROLE}-smoke.yaml`))
    .then(() => true).catch(() => false);
  assertEquals(splitSmoke, true, `${SPLIT_ROLE} keeps its smoke scenario`);
});

Deno.test("[agent_role_merge] code-analyst preserves both operations and both asserted artifacts", async () => {
  const smoke = await readScenario(join(SCENARIOS_DIR, "agent_role_eval", `${SPLIT_ROLE}-smoke.yaml`));
  const validation = await readScenario(join(SCENARIOS_DIR, "provider_live", `${SPLIT_ROLE}-validation.yaml`));

  const submitSmoke = smoke.steps.find((step) => step.command === "request");
  assert(submitSmoke?.args?.includes("--plan-only"), "the smoke must still request a plan");
  const waitSmoke = smoke.steps.find((step) => step.type === "wait-for-file");
  assert(waitSmoke?.args?.some((arg) => arg.endsWith("_plan.md")), "the smoke must still wait for a plan");

  const submitValidation = validation.steps.find((step) => step.command === "request");
  assert(submitValidation?.args?.includes("--analyze"), "the validation must still request an analysis");
  const waitValidation = validation.steps.find((step) => step.type === "wait-for-file");
  assert(
    waitValidation?.args?.some((arg) => arg.endsWith("_analysis.json")),
    "the validation must still wait for an analysis",
  );
  const kinds = criterionKinds(validation.steps);
  assert(kinds.includes("json-path-exists"), "the validation keeps its json-path criteria");
  assert(kinds.includes("llm-judge"), "the validation keeps its judge criterion");
});

Deno.test("[agent_role_merge] the judge is skipped in the mock cell and bound in the live cell", async () => {
  const role = "senior-coder";
  const scenario = await readScenario(mergedScenarioPath(role));
  const cells = scenario.matrix!.cells!;
  const { mock, live } = cellsByTool(cells);
  const env = { EXA_MATRIX_AGENT_ROLE_LIVE: "1", ANTHROPIC_API_KEY: "k" };
  const groups = expandMatrix(scenario.steps, { cells: [...cells] }, {
    env,
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
  });

  const mockRun = groups.find((group) => group.cell.tool === mock.tool)!;
  const liveRun = groups.find((group) => group.cell.tool === live.tool)!;
  assertEquals(mockRun.status, "run");
  assertEquals(liveRun.status, "run");

  // The cell's step scope drops the judge from the mock run, so the mock cell never grades.
  assertEquals(mockRun.steps.some(isJudgeBearingStep), false, "the mock cell must skip the judge");
  const judgeSteps = liveRun.steps.filter(isJudgeBearingStep);
  assertEquals(judgeSteps.map((step) => step.id), ["validate-plan-content"]);

  // The live cell's judge resolves through the scenario's `judge` binding.
  const config = new ConfigService(join(REPO_ROOT, live.config)).get();
  const plan = await resolveJudgeBindings({
    scenarioId: scenario.id,
    steps: liveRun.steps,
    config,
    runFile: scenarioRunFile(scenario.bindings ?? {}, join(FRAMEWORK_HOME, scenario.request_fixture!)),
    env,
  });

  assertEquals(plan.issues, [], "the judge binding must resolve without an issue");
  assertEquals(plan.bindings.get("validate-plan-content")?.binding.service, "claude-cli");
  assertEquals(plan.bindings.get("validate-plan-content")?.binding.model, "anthropic/claude-sonnet-5");

  // An operator runs the live tier alone with `--cell live`, which matches the live cell's tool.
  const selected = expandMatrix(scenario.steps, { cells: [...cells] }, {
    env,
    binOnPath: () => true,
    configBaseDir: REPO_ROOT,
    selectedCell: LIVE_CELL_TOOL,
  });
  assertEquals(
    selected.filter((group) => group.status === "run").map((group) => group.cell.tool),
    [LIVE_CELL_TOOL],
  );
});
