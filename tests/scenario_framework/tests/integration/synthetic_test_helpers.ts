/**
 * @module SyntheticScenarioTestHelpers
 * @path tests/scenario_framework/tests/integration/synthetic_test_helpers.ts
 * @description Shared temp-environment and scenario fixture helpers for synthetic scenario integration tests.
 */

import { dirname, join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";

export interface ISyntheticTestEnv {
  frameworkHome: string;
  workspaceRoot: string;
  outputDir: string;
}

export interface ISyntheticScenarioStepDefinition {
  id: string;
  type: string;
  command: string;
  args: string[];
  checkpoint?: string;
  outputCriteriaLines: string[];
}

export interface IWriteSyntheticScenarioOptions {
  frameworkHome: string;
  scenarioId: string;
  tags: string[];
  steps: ISyntheticScenarioStepDefinition[];
  schemaVersion: string;
  requestFixturePath?: string;
  /** Scenario-level scoring mode. Emitted as `scoring: "gated"`. */
  scoring?: "gated";
  /** A single matrix cell: emits a `matrix:` block with one cell so the run records a `cell_id` (+ `harness: bare` / `ablate:` markers). */
  matrixCell?: {
    tool: string;
    provider: string;
    config: string;
    requiresBin: string;
    harness?: "bare";
    ablate?: string;
  };
  /** Catalog preset names: emits a `matrix.from_catalog` block instead of inline cells. */
  fromCatalog?: string[];
}

/** One journal activity row, as the binding evidence readers need it. */
export interface IRunActivityRow {
  action_type: string;
  trace_id: string;
  payload: string;
}

const DEFAULT_REQUEST_FIXTURE_PATH = "fixtures/requests/shared/synthetic_request.md";

export async function withSyntheticTestEnv(
  fn: (env: ISyntheticTestEnv) => Promise<void>,
): Promise<void> {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-workspace-" });
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-output-" });

  try {
    await fn({ frameworkHome, workspaceRoot, outputDir });
  } finally {
    await cleanupTempPaths([frameworkHome, workspaceRoot, outputDir]);
  }
}

export async function writeSyntheticScenario(
  options: IWriteSyntheticScenarioOptions,
): Promise<string> {
  const requestFixturePath = options.requestFixturePath ?? DEFAULT_REQUEST_FIXTURE_PATH;
  const scenarioPath = `scenarios/synthetic/${options.scenarioId}.yaml`;

  await Deno.mkdir(join(options.frameworkHome, dirname(requestFixturePath)), {
    recursive: true,
  });
  await Deno.mkdir(join(options.frameworkHome, "scenarios/synthetic"), { recursive: true });
  await Deno.writeTextFile(
    join(options.frameworkHome, requestFixturePath),
    "# Synthetic request\n\nRun the local synthetic scenario.\n",
  );
  await Deno.writeTextFile(
    join(options.frameworkHome, scenarioPath),
    [
      `schema_version: "${options.schemaVersion}"`,
      `id: "${options.scenarioId}"`,
      `title: "${options.scenarioId}"`,
      'pack: "synthetic"',
      `tags: [${options.tags.map((tag) => `"${tag}"`).join(", ")}]`,
      `request_fixture: "${requestFixturePath}"`,
      'mode_support: ["auto", "manual-checkpoint"]',
      "portals: []",
      ...(options.scoring ? [`scoring: "${options.scoring}"`] : []),
      ...(options.matrixCell
        ? [
          "matrix:",
          "  cells:",
          `    - tool: "${options.matrixCell.tool}"`,
          `      provider: "${options.matrixCell.provider}"`,
          `      config: "${options.matrixCell.config}"`,
          `      requires_bin: "${options.matrixCell.requiresBin}"`,
          ...(options.matrixCell.harness ? [`      harness: "${options.matrixCell.harness}"`] : []),
          ...(options.matrixCell.ablate ? [`      ablate: "${options.matrixCell.ablate}"`] : []),
        ]
        : []),
      ...(options.fromCatalog
        ? [
          "matrix:",
          `  from_catalog: [${options.fromCatalog.map((name) => `"${name}"`).join(", ")}]`,
        ]
        : []),
      "steps:",
      ...options.steps.flatMap((step) => [
        `  - id: "${step.id}"`,
        `    type: "${step.type}"`,
        `    command: "${escapeYaml(step.command)}"`,
        `    args: [${step.args.map((arg) => `"${escapeYaml(arg)}"`).join(", ")}]`,
        ...(step.checkpoint ? [`    checkpoint: "${step.checkpoint}"`] : []),
        "    input_criteria: []",
        "    output_criteria:",
        ...step.outputCriteriaLines,
      ]),
      "",
    ].join("\n"),
  );

  return scenarioPath;
}

export function escapeYaml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function cleanupTempPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    await Deno.remove(path, { recursive: true }).catch(() => {});
  }
}

/** Every activity row of one sandbox, oldest first. */
export async function readRunActivity(workspaceRoot: string): Promise<IRunActivityRow[]> {
  const db = new DatabaseService(new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll());
  try {
    return await db.preparedAll<IRunActivityRow>(
      "SELECT action_type, trace_id, payload FROM activity ORDER BY rowid ASC",
      [],
    );
  } finally {
    await db.close();
  }
}

/** Per trace, the service each flow step resolved to, from the daemon's binding.resolved events. */
export async function resolvedServiceByTrace(
  workspaceRoot: string,
): Promise<Map<string, Map<string, string>>> {
  const byTrace = new Map<string, Map<string, string>>();
  for (const row of await readRunActivity(workspaceRoot)) {
    if (row.action_type !== "binding.resolved") continue;
    const payload = JSON.parse(row.payload) as { step_id?: string; service?: string };
    if (!payload.step_id || !payload.service) continue;
    const steps = byTrace.get(row.trace_id) ?? new Map<string, string>();
    steps.set(payload.step_id, payload.service);
    byTrace.set(row.trace_id, steps);
  }
  return byTrace;
}

/** Trace ids in the order the daemon first resolved one of their step bindings. */
export async function traceIdsInOrder(workspaceRoot: string): Promise<string[]> {
  const seen: string[] = [];
  for (const row of await readRunActivity(workspaceRoot)) {
    if (row.action_type !== "binding.resolved") continue;
    if (!seen.includes(row.trace_id)) seen.push(row.trace_id);
  }
  return seen;
}
