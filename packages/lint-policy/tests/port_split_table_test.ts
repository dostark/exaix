/**
 * @module PortSplitTableTest
 * @path packages/lint-policy/tests/port_split_table_test.ts
 * @description Checks that the committed port table has one row for every rule id the checkers emit.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/port_tables.json, packages/lint-policy/tests/helpers/port_tables.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { emittedRuleIds, loadPortTables, PORT_ORIGIN, PORT_OUTCOME } from "./helpers/port_tables.ts";

const PLUGIN_RULE_ID = "exaix/exported-interface-naming";
const MAGIC_CHECKER_ROW = "magic-literals";

Deno.test("the table has one row for every rule id the checkers emit", async () => {
  const tables = await loadPortTables();
  const emitted = await emittedRuleIds();
  const scriptRows = tables.rules
    .filter((row) => row.origin === PORT_ORIGIN.catalog || row.origin === PORT_ORIGIN.emitted)
    .map((row) => row.id)
    .sort();
  assertEquals(scriptRows, emitted);
});

Deno.test("a row is marked emitted exactly when the catalog does not list it", async () => {
  const tables = await loadPortTables();
  const catalogIds = await catalogScriptRuleIds();
  for (const row of tables.rules) {
    if (row.origin === PORT_ORIGIN.catalog) assert(catalogIds.has(row.id), `${row.id} is not a catalog script rule`);
    if (row.origin === PORT_ORIGIN.emitted) assert(!catalogIds.has(row.id), `${row.id} is in the catalog`);
  }
});

Deno.test("the table also covers the plugin rule and the magic-literal checker", async () => {
  const tables = await loadPortTables();
  const ids = tables.rules.map((row) => row.id);
  assert(ids.includes(PLUGIN_RULE_ID));
  assert(ids.includes(MAGIC_CHECKER_ROW));
});

Deno.test("each row has a unique id and its parts match its outcome", async () => {
  const tables = await loadPortTables();
  assertEquals(new Set(tables.rules.map((row) => row.id)).size, tables.rules.length);
  for (const row of tables.rules) {
    assert(row.parts.length > 0, `${row.id} names no part`);
    const hasExaixPart = row.parts.some((part) => part.pack === "exaix");
    const hasGenericPart = row.parts.some((part) => part.pack !== "exaix");
    if (row.outcome === PORT_OUTCOME.exaix) {
      assert(hasExaixPart && !hasGenericPart, `${row.id}: exaix rows have only an Exaix part`);
    }
    if (row.outcome === PORT_OUTCOME.generic) assert(hasGenericPart, `${row.id}: generic rows name a generic part`);
    if (row.outcome === PORT_OUTCOME.split) assert(row.parts.length >= 2, `${row.id}: split rows name two parts`);
  }
});

Deno.test("a zone row names its Step 8 form and a non-zone row does not", async () => {
  const tables = await loadPortTables();
  for (const row of tables.rules) {
    if (row.outcome === PORT_OUTCOME.zone) assert(row.zoneForm !== undefined, `${row.id} has no zone form`);
    else assertEquals(row.zoneForm, undefined, `${row.id} is not a zone rule`);
  }
});

Deno.test("a rule that needs composition names the Exaix part that composes it", async () => {
  const tables = await loadPortTables();
  for (const row of tables.rules.filter((candidate) => candidate.mechanism === "compose")) {
    assert(row.parts.some((part) => part.pack === "exaix"), `${row.id} composes but names no Exaix part`);
  }
});

Deno.test("every generic, split, and zone row records its counterparts in other linters and its scope decision", async () => {
  const tables = await loadPortTables();
  const needsRecord = new Set<string>([PORT_OUTCOME.generic, PORT_OUTCOME.deno, PORT_OUTCOME.split, PORT_OUTCOME.zone]);
  for (const row of tables.rules.filter((candidate) => needsRecord.has(candidate.outcome))) {
    assert(Array.isArray(row.counterparts), `${row.id} has no counterparts entry`);
    assert(row.scope.decision !== "not-applicable", `${row.id} has no scope decision`);
  }
});

/** The ids of the catalog entries whose engine is `script`. */
async function catalogScriptRuleIds(): Promise<Set<string>> {
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../catalog.json", import.meta.url)));
  const ids = new Set<string>();
  for (const [id, entry] of Object.entries<{ engine: string }>(catalog.rules)) {
    if (entry.engine === "script") ids.add(id);
  }
  return ids;
}
