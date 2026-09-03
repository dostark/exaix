/**
 * @module ScenarioVariableSubstitutionTest
 * @path tests/scenario_framework/tests/unit/scenario_variable_substitution_test.ts
 * @description Phase 142 Step 15 — every `$VAR` a scenario references must be one the runner
 *   actually substitutes.
 *
 *   `expandInString` leaves an unknown name untouched by design (a shell-local like
 *   `WORKTREE=$(...)` must survive to the shell), so a variable the runner never defines is
 *   passed through verbatim and fails somewhere downstream wearing the literal `$NAME` — the
 *   `dynamic_execution` pack died on `cp: cannot stat '$FLOW_FIXTURE'`. The scenario schema
 *   declares `flow_fixture` (`scenario_schema.ts:33`) and eight scenarios set it, but nothing
 *   ever read the field: the same parsed-validated-never-acted-on shape as `portals:`.
 *
 *   `$FLOW_TRACE_ID` is the other half — a variable naming a value that does not exist before
 *   the run, which no substitution table could supply. Scenarios needing a trace id read it
 *   from the journal in a shell step, the pattern `scenario_templates.ts:381` already uses.
 *
 *   Guarding the whole tree rather than the two scenarios that exposed it: the failure is a
 *   typo away in any pack, and it surfaces as a confusing runtime error rather than a load error.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { walk } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { SCENARIO_SUBSTITUTED_VARIABLES, stageFlowFixture } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = resolve(import.meta.dirname!, "..", "..");
const REPO_ROOT = resolve(FRAMEWORK_HOME, "..", "..");
const SCENARIOS_DIR = join(FRAMEWORK_HOME, "scenarios");

/** Names the process environment supplies, which the runner merges in ahead of its own table. */
const PASSTHROUGH_ENV_VARIABLES = ["HOME"];

/** Only UPPER_SNAKE names are candidates — a lowercase `$name` (e.g. `$signal` bound by `read -r id signal`, or a TS template literal `${i}`) belongs to embedded scenario code, not the framework. */
const VARIABLE_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)\}|\$([A-Z][A-Z0-9_]*)/g;

/** A node of a parsed YAML document — the shape `parseYaml` actually produces. */
type YamlNode = string | number | boolean | null | undefined | YamlNode[] | { [key: string]: YamlNode };

/** The scenario fields this test reads; everything else is walked generically. */
interface IScenarioDoc {
  id?: string;
  flow_fixture?: string;
  [key: string]: YamlNode;
}

interface IScenarioFile {
  id: string;
  path: string;
  doc: IScenarioDoc;
}

interface IVariableReference {
  scenario: string;
  name: string;
}

/** A name assigned inside the same string (`WORKTREE=$(cat ...) && cd "$WORKTREE"`) is a shell local, and `expandInString` preserving the reference is what makes it work — must not be reported. */
function isShellLocal(name: string, text: string): boolean {
  return new RegExp(`(^|[\\s;&|(])${name}=`).test(text);
}

function collectReferences(scenario: string, text: string, into: IVariableReference[]): void {
  for (const match of text.matchAll(VARIABLE_REFERENCE)) {
    const name = match[1] ?? match[2];
    if (isShellLocal(name, text)) continue;
    into.push({ scenario, name });
  }
}

/** Walks the parsed YAML rather than the raw file so YAML anchors and quoting are already resolved. */
function collectFromNode(scenario: string, node: YamlNode, into: IVariableReference[]): void {
  if (typeof node === "string") {
    collectReferences(scenario, node, into);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectFromNode(scenario, item, into);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectFromNode(scenario, value, into);
  }
}

async function readScenarioFiles(): Promise<IScenarioFile[]> {
  const files: IScenarioFile[] = [];
  for await (const entry of walk(SCENARIOS_DIR, { exts: [".yaml"], includeDirs: false })) {
    const doc = parseYaml(await Deno.readTextFile(entry.path)) as IScenarioDoc;
    const id = doc?.id ?? entry.name;
    files.push({ id, path: entry.path, doc });
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  return files;
}

Deno.test("[scenario-vars] every referenced variable is one the runner substitutes", async () => {
  const known = new Set([...SCENARIO_SUBSTITUTED_VARIABLES, ...PASSTHROUGH_ENV_VARIABLES]);
  const references: IVariableReference[] = [];
  for (const { id, doc } of await readScenarioFiles()) collectFromNode(id, doc, references);

  const unknown = [
    ...new Set(references.filter((ref) => !known.has(ref.name)).map((ref) => `${ref.scenario}: $${ref.name}`)),
  ].sort();

  assertEquals(
    unknown,
    [],
    `expandInString leaves an undefined name verbatim, so each of these reaches the step as the ` +
      `literal text "$NAME":\n${unknown.join("\n")}\n\nSubstituted: ${[...known].sort().join(", ")}`,
  );
});

Deno.test("[scenario-vars] the runner's table is read from the runner, not restated here", () => {
  // Guards the test itself: were the export renamed or emptied, the check above would pass
  // vacuously by declaring every variable unknown — or, if inverted, by knowing none.
  assert(SCENARIO_SUBSTITUTED_VARIABLES.includes("WORKSPACE_ROOT"));
  assert(SCENARIO_SUBSTITUTED_VARIABLES.includes("REQUEST_FIXTURE"));
});

Deno.test("[scenario-vars] every declared flow_fixture resolves to a file that exists", async () => {
  // The field was parsed and validated for as long as it has existed, and read by nothing —
  // so a path that never resolved could not be distinguished from one that did.
  const missing: string[] = [];
  for (const { id, doc } of await readScenarioFiles()) {
    const flowFixture = doc?.flow_fixture;
    if (!flowFixture) continue;
    const absolute = resolve(FRAMEWORK_HOME, flowFixture);
    const found = await Deno.stat(absolute).then(() => true).catch(() => false);
    if (!found) missing.push(`${id} -> ${flowFixture}`);
  }
  assertEquals(missing.sort(), [], `flow_fixture paths naming no file:\n${missing.join("\n")}`);
});

Deno.test("[flow-fixture] a declared flow is staged into the sandbox's flow catalog", async () => {
  // `assertFlowExists` resolves `<root>/Blueprints/Flows/<id>.flow.yaml`, so a flow fixture that
  // stays in the framework tree cannot be requested no matter how the variable expands. Staging
  // it here is the same move as mounting `portals:`.
  const ws = await Deno.makeTempDir({ prefix: "stage-flow-" });
  try {
    const fixture = join(FRAMEWORK_HOME, "fixtures", "flows", "dynamic_execution", "explore.flow.yaml");

    await stageFlowFixture(ws, fixture);

    const staged = join(ws, "Blueprints", "Flows", "explore-codebase.flow.yaml");
    assertEquals(await Deno.stat(staged).then(() => true).catch(() => false), true, `expected ${staged}`);
    assertEquals(await Deno.readTextFile(staged), await Deno.readTextFile(fixture));
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[flow-fixture] staging names the file after the flow's own id, not the fixture file", async () => {
  // `explore.flow.yaml` declares `id: explore-codebase`. Copying under the fixture's filename
  // would put the flow at a path the loader never looks for.
  const ws = await Deno.makeTempDir({ prefix: "stage-flow-id-" });
  try {
    await stageFlowFixture(ws, join(FRAMEWORK_HOME, "fixtures", "flows", "dynamic_execution", "explore.flow.yaml"));
    const wrong = join(ws, "Blueprints", "Flows", "explore.flow.yaml");
    assertEquals(await Deno.stat(wrong).then(() => true).catch(() => false), false, "must not use the fixture name");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[flow-fixture] every identity a fixture flow names exists in the catalog", async () => {
  // Now that fixture flows are staged and actually load, their `identity:` references resolve
  // at runtime — several of them named identities the catalog does not have.
  const catalog = new Set<string>();
  for await (const entry of Deno.readDir(join(REPO_ROOT, "Blueprints", "Agents"))) {
    if (entry.isFile && entry.name.endsWith(".md")) catalog.add(entry.name.replace(/\.md$/, ""));
  }
  assert(catalog.size > 0, "expected identities to be shipped");

  const dangling: string[] = [];
  for await (const entry of walk(join(FRAMEWORK_HOME, "fixtures", "flows"), { exts: [".yaml"], includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    for (const match of text.matchAll(/^\s*identity:\s*"?([\w-]+)"?\s*$/gm)) {
      if (!catalog.has(match[1])) dangling.push(`${entry.path.slice(FRAMEWORK_HOME.length + 1)} -> ${match[1]}`);
    }
  }
  assertEquals(
    [...new Set(dangling)].sort(),
    [],
    `fixture flows naming an identity the catalog does not have:\n${[...new Set(dangling)].sort().join("\n")}\n\n` +
      `Catalog: ${[...catalog].sort().join(", ")}`,
  );
});

Deno.test("[scenario-vars] a scenario declaring flow_fixture gets $FLOW_FIXTURE defined", async () => {
  // The pairing that was missing: eight scenarios set the field and referenced the variable,
  // and the two halves had never been connected.
  const declaring = (await readScenarioFiles()).filter((file) => file.doc?.flow_fixture);
  assert(declaring.length > 0, "expected at least one scenario to declare flow_fixture");
  assert(
    SCENARIO_SUBSTITUTED_VARIABLES.includes("FLOW_FIXTURE"),
    "scenarios declare flow_fixture, so the runner must define $FLOW_FIXTURE",
  );
});

Deno.test("[flow-fixture] a scenario whose request names a flow must declare that flow", async () => {
  // A request fixture carrying `flow: <id>` only works if the flow is in the sandbox catalog,
  // and the runner stages exactly what `flow_fixture` names — a scenario referencing a flow
  // without declaring its fixture passes only if another scenario staged it first.
  const shippedFlows = new Set<string>();
  for await (const entry of Deno.readDir(join(REPO_ROOT, "Blueprints", "Flows"))) {
    if (entry.name.endsWith(".flow.yaml")) shippedFlows.add(entry.name.replace(/\.flow\.yaml$/, ""));
  }

  const undeclared: string[] = [];
  for (const { id, doc } of await readScenarioFiles()) {
    const fixture = doc?.request_fixture;
    if (typeof fixture !== "string") continue;
    const text = await Deno.readTextFile(resolve(FRAMEWORK_HOME, fixture)).catch(() => null);
    const named = text?.match(/^flow:\s*"?([\w-]+)"?\s*$/m)?.[1];
    if (!named) continue;
    // A flow in the shipped catalog is seeded for every scenario; only fixture flows need staging.
    if (shippedFlows.has(named)) continue;
    if (!doc?.flow_fixture) undeclared.push(`${id} -> needs flow "${named}" staged`);
  }

  assertEquals(
    undeclared.sort(),
    [],
    `these depend on another scenario having staged their flow first:\n${undeclared.join("\n")}`,
  );
});

Deno.test("[flow-fixture] the schema does not describe the field as unconsumed", async () => {
  // The schema carried `@deprecated ... not consumed by the scenario runner`, which became
  // false once the field was wired up — a reader trusting the tag would delete a load-bearing
  // declaration. Prose drifts silently; this pins it to the runner's actual behaviour.
  const schema = await Deno.readTextFile(join(FRAMEWORK_HOME, "schema", "scenario_schema.ts"));
  const runner = await Deno.readTextFile(join(FRAMEWORK_HOME, "runner", "synthetic_runner.ts"));

  const runnerStagesIt = runner.includes("stageFlowFixture(");
  assert(runnerStagesIt, "the runner must still stage flow_fixture, or this guard is checking nothing");

  const declaration = schema.slice(0, schema.indexOf("flow_fixture:"));
  const lastComment = declaration.lastIndexOf("/**");
  const docBlock = declaration.slice(lastComment);

  // Matches the JSDoc TAG form (`* @deprecated` at the start of a line), not the word: the block
  // deliberately explains that the tag used to be there, and that prose is the useful part.
  assert(
    !/^\s*\*\s*@deprecated\b/m.test(docBlock),
    "flow_fixture is staged by the runner; a @deprecated tag would tell a reader to remove it",
  );
  assert(
    !/not consumed by the scenario runner/.test(docBlock),
    "the schema claims the runner ignores a field the runner stages",
  );
});
