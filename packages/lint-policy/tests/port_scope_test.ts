/**
 * @module PortScopeTest
 * @path packages/lint-policy/tests/port_scope_test.ts
 * @description Checks that the port scope table matches the roots and the rule lists of the lint task.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/port_tables.json, packages/lint-policy/tests/helpers/port_tables.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { loadPortTables, PORT_OUTCOME } from "./helpers/port_tables.ts";

const SELECTION_VARIABLE = "EXAIX_LINT_RULES";
const PLUGIN_NAME = "exaix";
const COMMENT_RULE = "long-comment";
const NON_TYPESCRIPT_SURFACES = ["yaml", "yml", "toml", "jsonc"];

interface ILintTaskShape {
  readonly pluginRoots: readonly string[];
  readonly scriptsRunRules: readonly string[];
}

/** Splits the `lint` task into the roots of its full run and the rule list of its `scripts/` run. */
async function readLintTask(): Promise<ILintTaskShape> {
  const config = JSON.parse(await Deno.readTextFile(new URL("../../../deno.json", import.meta.url)));
  const [fullRun, scriptsRun] = String(config.tasks.lint).split("&&").map((part: string) => part.trim());
  const roots = fullRun.split(/\s+/).filter((token) => token.endsWith("/") && !token.startsWith("-"));
  const selection = scriptsRun.match(new RegExp(`${SELECTION_VARIABLE}=(\\S+)`))?.[1] ?? "";
  return { pluginRoots: roots, scriptsRunRules: selection.split(",").filter((rule) => rule.length > 0) };
}

Deno.test("the scope table lists the roots that the lint task covers", async () => {
  const tables = await loadPortTables();
  const task = await readLintTask();
  assertEquals([...tables.scope.pluginRoots].sort(), [...task.pluginRoots].sort());
});

Deno.test("the scripts run selects only plugin rules that exist or that the table has ported", async () => {
  const tables = await loadPortTables();
  const task = await readLintTask();
  const ported = tables.rules
    .filter((row) => row.ported)
    .flatMap((row) => row.parts.map((part) => `${PLUGIN_NAME}/${part.key}`));
  const allowed = new Set([...tables.scope.scriptsRunRules, ...ported]);
  for (const rule of task.scriptsRunRules) {
    assert(allowed.has(rule), `${rule} is selected but not declared in the scope table`);
  }
});

Deno.test("a ported rule with the decision extend-scripts-run is selected in the scripts run", async () => {
  const tables = await loadPortTables();
  const task = await readLintTask();
  for (
    const row of tables.rules.filter((candidate) =>
      candidate.ported && candidate.scope.decision === "extend-scripts-run"
    )
  ) {
    for (const part of row.parts.filter((candidate) => candidate.pack !== "exaix")) {
      assert(task.scriptsRunRules.includes(`${PLUGIN_NAME}/${part.key}`), `${row.id} is not selected for scripts/`);
    }
  }
});

Deno.test("the comment rules record the non-TypeScript surfaces that leave their scope", async () => {
  const tables = await loadPortTables();
  const row = tables.rules.find((candidate) => candidate.id === COMMENT_RULE);
  assert(row !== undefined);
  for (const surface of NON_TYPESCRIPT_SURFACES) {
    assert(row.scope.dropped.includes(surface), `long-comment does not record ${surface}`);
  }
});

Deno.test("every generic, split, and zone row declares what the script side walked", async () => {
  const tables = await loadPortTables();
  const covered = new Set<string>([PORT_OUTCOME.generic, PORT_OUTCOME.deno, PORT_OUTCOME.split, PORT_OUTCOME.zone]);
  for (const row of tables.rules.filter((candidate) => covered.has(candidate.outcome))) {
    assert(row.scope.script.length > 0, `${row.id} has no script-side scope`);
  }
});
