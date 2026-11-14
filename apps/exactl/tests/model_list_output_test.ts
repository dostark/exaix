/**
 * @module ModelListOutputTest
 * @path apps/exactl/tests/model_list_output_test.ts
 * @description Runs model list with -o json and checks the typed row of each entry: author, service, route, price, source, verified date and stale flag.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/commands/model_commands.ts, apps/exactl/src/command_builders/model_command.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const ROW_KEYS = [
  "author",
  "input_per_mtok",
  "model",
  "output_per_mtok",
  "price_source",
  "route",
  "service",
  "source_url",
  "stale",
  "verified_at",
];
const STATIC_SOURCE = "static";

interface IListedModel {
  readonly [key: string]: string | number | boolean | null;
}

Deno.test("model list -o json carries author, service, route, price, source, verified_at and stale per entry", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "list", "-o", "json"]]);
  assertEquals(run.code, 0, run.stderr);
  const rows: IListedModel[] = JSON.parse(run.stdout);
  assert(rows.length > 0);
  for (const row of rows) assertEquals(Object.keys(row).sort(), ROW_KEYS);
  const priced = rows.filter((row) => row.price_source === STATIC_SOURCE);
  assert(priced.length > 0, "no entry carries a static overlay price");
  for (const row of priced) {
    assertEquals(typeof row.input_per_mtok, "number");
    assertEquals(typeof row.verified_at, "string");
    assertEquals(typeof row.stale, "boolean");
  }
});
