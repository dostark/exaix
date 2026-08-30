/**
 * @module FlowOutputShapeTest
 * @path tests/blueprints/flow_output_shape_test.ts
 * @description Phase 142 Step 13 — a flow's `output` must aggregate to ONE document, because
 *   `RequestProcessor` hands the aggregated result straight to plan validation.
 *
 *   `aggregateOutput` with `format: json` and several sources returns a map keyed by step id —
 *   `{"code-review": "...", "integration-test": "..."}` — which is not a plan, so validation
 *   fails with a bare `Required` naming no field. `feature-development` shipped that shape and
 *   died there; the fifteen other flows all output from a single terminal step, so the
 *   constraint was real, universally observed, and written down nowhere.
 *
 *   This guards the shape rather than the count of sources for its own sake: a flow may
 *   legitimately fan out, but whatever it hands back has to be one document a plan can be
 *   parsed from.
 * @architectural-layer Test
 * @related-files [packages/flow/src/step_output_formatter.ts, packages/request/src/processor.ts]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { walk } from "@std/fs";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "Blueprints", "Flows");

/** The scenario framework's own flow fixtures are held to the same output-shape contract:
 * `aggregateOutput` reads `output.from` as the step id, so a fixture writing a separate
 * `step: <id>` key aggregates to nothing at runtime. */
const FIXTURE_FLOWS_DIR = join(REPO_ROOT, "tests", "scenario_framework", "fixtures", "flows");

interface IFlowOutput {
  from?: string | string[];
  format?: string;
}

interface IFlowDoc {
  output?: IFlowOutput;
}

interface IFlowRow {
  flow: string;
  path: string;
  output?: IFlowOutput;
}

/** Every `.flow.yaml` under a directory tree, so nested fixture packs are covered too. */
async function readFlowsUnder(root: string): Promise<IFlowRow[]> {
  const rows: IFlowRow[] = [];
  for await (const entry of walk(root, { exts: [".yaml"], includeDirs: false })) {
    if (!entry.name.endsWith(".flow.yaml")) continue;
    const parsed = parseYaml(await Deno.readTextFile(entry.path)) as IFlowDoc;
    rows.push({ flow: entry.name.replace(/\.flow\.yaml$/, ""), path: entry.path, output: parsed.output });
  }
  rows.sort((a, b) => a.flow.localeCompare(b.flow));
  return rows;
}

async function readFlowOutputs(): Promise<IFlowRow[]> {
  return [...await readFlowsUnder(FLOWS_DIR), ...await readFlowsUnder(FIXTURE_FLOWS_DIR)];
}

Deno.test("[flow-output] every flow declares an output block", async () => {
  const missing = (await readFlowOutputs()).filter((row) => !row.output).map((row) => row.flow);
  assertEquals(missing, [], `flows with no output block have nothing to hand back: ${missing.join(", ")}`);
});

Deno.test("[flow-output] no flow aggregates several sources as json", async () => {
  // The specific shape that cannot become a plan: `format: json` over multiple sources builds a
  // map keyed by step id, and plan validation then reports `Required` with no field named.
  const offenders = (await readFlowOutputs())
    .filter((row) => Array.isArray(row.output?.from) && row.output.from.length > 1 && row.output?.format === "json")
    .map((row) => `${row.flow} (${(row.output?.from as string[]).length} sources)`);

  assertEquals(
    offenders,
    [],
    `these aggregate to a step-id map rather than a document plan validation can parse:\n${offenders.join("\n")}`,
  );
});

Deno.test("[flow-output] every named output source is a step the flow declares", async () => {
  // A typo here is silent: the aggregator skips a source it cannot resolve, so the flow
  // produces a shorter document — or nothing — with no error naming the missing step.
  const dangling: string[] = [];
  for (const { flow, path, output } of await readFlowOutputs()) {
    if (!output?.from) continue;
    const text = await Deno.readTextFile(path);
    const stepIds = new Set([...text.matchAll(/^\s{2}- id:\s*"?([\w-]+)"?/gm)].map((m) => m[1]));
    for (const source of Array.isArray(output.from) ? output.from : [output.from]) {
      if (!stepIds.has(source)) dangling.push(`${flow} -> ${source}`);
    }
  }
  assertEquals(dangling.sort(), [], `output sources naming no declared step:\n${dangling.join("\n")}`);
});
