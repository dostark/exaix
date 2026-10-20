/**
 * @module PortMigrationTest
 * @path packages/lint-policy/tests/port_migration_test.ts
 * @description Checks the style-exclude migration helper, the bare-id search, and the guard for ported rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/tests/helpers/port_migration.ts, packages/lint-policy/port_tables.json]
 */

import { assert, assertEquals } from "@std/assert";
import {
  findBareIdReferences,
  findStyleExcludeSites,
  migrateStyleExclude,
  trackedTextFiles,
} from "./helpers/port_migration.ts";
import { loadPortTables } from "./helpers/port_tables.ts";

const CODES = ["REQUIRED_FOR_TEST", "PLUGINS"];
const IMPORT_KEYWORD = "import";
const TABLE_PATH = "packages/lint-policy/port_tables.json";
const PARITY_TEST_SUFFIX = "_parity_test.ts";
const GUARD_PATHS = [
  TABLE_PATH,
  "packages/lint-policy/tests/port_migration_test.ts",
  "packages/lint-policy/tests/port_split_table_test.ts",
  "packages/lint-policy/tests/helpers/port_migration.ts",
  "packages/lint-policy/tests/fixtures/port/",
  "docs/CHANGELOG.md",
  "unslop-ts/",
];

Deno.test("a style-exclude comment of the rule becomes a deno-lint-ignore comment with the same reason", () => {
  const before = [
    "// style-exclude:PLUGINS - loads a plugin at run time",
    `const mod = await ${IMPORT_KEYWORD}(path);`,
  ].join("\n");
  const after = migrateStyleExclude(before, CODES, "exaix/dynamic-import");
  assertEquals(
    after,
    [
      "// deno-lint-ignore exaix/dynamic-import -- loads a plugin at run time",
      `const mod = await ${IMPORT_KEYWORD}(path);`,
    ]
      .join("\n"),
  );
});

Deno.test("a style-exclude comment with a code of another rule stays as it is", () => {
  const text = "// style-exclude:FIXTURE_READABILITY - clearer inline\nconst a = 1;";
  assertEquals(migrateStyleExclude(text, CODES, "exaix/dynamic-import"), text);
});

Deno.test("the style-exclude sites of a rule are listed with their file and line", () => {
  const files = new Map<string, string>([
    ["packages/a/src/x.ts", `const a = 1;\n// style-exclude:PLUGINS - reason here\nawait ${IMPORT_KEYWORD}(p);\n`],
    ["packages/a/src/y.ts", "// style-exclude:OTHER_CODE - another rule\n"],
  ]);
  assertEquals(findStyleExcludeSites(files, CODES), ["packages/a/src/x.ts:2"]);
});

Deno.test("a bare rule id is found, and the plugin id and a longer word are not", () => {
  const files = new Map<string, string>([
    [
      "a.md",
      "See [dynamic-import] and `dynamic-import`.\nUse exaix/dynamic-import instead.\nA dynamic-importer is a word.\n",
    ],
  ]);
  assertEquals(findBareIdReferences(files, "dynamic-import"), ["a.md:1", "a.md:1"]);
});

Deno.test("the tracked text files exclude the historical planning documents", async () => {
  const files = await trackedTextFiles([]);
  assert(files.size > 0);
  for (const path of files.keys()) assert(!path.startsWith("exaix-dev-docs/planning/"), path);
});

Deno.test("a ported rule has no style-exclude site and no bare id left in the tracked files", async () => {
  const tables = await loadPortTables();
  const files = await trackedTextFiles(GUARD_PATHS);
  // A parity test names the script rule ids it compares.
  for (const path of [...files.keys()]) if (path.endsWith(PARITY_TEST_SUFFIX)) files.delete(path);
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../catalog.json", import.meta.url)));
  for (const row of tables.rules.filter((candidate) => candidate.ported)) {
    const codes = Object.keys(catalog.rules[row.id]?.exclusionCodes ?? {});
    assertEquals(findStyleExcludeSites(files, codes), [], `${row.id} still has style-exclude sites`);
    assertEquals(findBareIdReferences(files, row.id), [], `${row.id} is still referenced by its bare id`);
  }
});
