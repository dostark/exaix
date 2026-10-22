/**
 * @module PortMigrationTest
 * @path packages/lint-policy/tests/port_migration_test.ts
 * @description Checks the style-exclude migration helper, the bare-id search, and the guard for ported rules.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/tests/helpers/port_migration.ts, packages/lint-policy/tests/fixtures/port/port_tables.json]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  findBareIdReferences,
  findStyleExcludeSites,
  type ITrackedFileSource,
  migrateStyleExclude,
  portReferenceFiles,
  trackedTextFiles,
} from "./helpers/port_migration.ts";
import { loadPortTables } from "./helpers/port_tables.ts";

const CODES = ["REQUIRED_FOR_TEST", "PLUGINS"];
const IMPORT_KEYWORD = "import";
const CATALOG_PATH = "packages/lint-policy/tests/fixtures/catalog_v1.json";

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

Deno.test("a bare rule id in brackets or backticks is found, and the plugin id, a longer word, and prose are not", () => {
  const files = new Map<string, string>([
    [
      "a.md",
      "See [dynamic-import] and `dynamic-import`.\nUse exaix/dynamic-import instead.\nA dynamic-importer is a word.\nThe dynamic-import rule is prose.\n",
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
  const files = await portReferenceFiles();
  const catalog = JSON.parse(await Deno.readTextFile(new URL("./fixtures/catalog_v1.json", import.meta.url)));
  for (const row of tables.rules.filter((candidate) => candidate.ported)) {
    const codes = Object.keys(catalog.rules[row.id]?.exclusionCodes ?? {});
    assertEquals(findStyleExcludeSites(files, codes), [], `${row.id} still has style-exclude sites`);
    // A zone keeps the old rule id as its id, and the catalog is where zones are written.
    const searched = row.outcome === "zone" ? new Map([...files].filter(([path]) => path !== CATALOG_PATH)) : files;
    assertEquals(findBareIdReferences(searched, row.id), [], `${row.id} is still referenced by its bare id`);
  }
});

const GUARD_TEST = new URL("./generic_rules_ported_test.ts", import.meta.url).pathname;
const GUARD_NAME = "active tracked consumers name no bare ported rule id";
const GIT_FAILURE_EXIT = 128;

Deno.test("failed_git_inventory_fails_terminal_guard", async () => {
  const bin = await Deno.makeTempDir({ prefix: "failing_git_" });
  try {
    const fake = join(bin, "git");
    await Deno.writeTextFile(fake, `#!/bin/sh\necho "fatal: not a git repository" >&2\nexit ${GIT_FAILURE_EXIT}\n`);
    await Deno.chmod(fake, 0o755);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["test", "--allow-all", GUARD_TEST, "--filter", GUARD_NAME],
      env: { PATH: `${bin}:${Deno.env.get("PATH") ?? ""}` },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    assertEquals(result.success, false, output);
    assertStringIncludes(output, `git ls-files failed with exit code ${GIT_FAILURE_EXIT}`);
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
});

function fakeSource(
  entries: Readonly<Record<string, string | Error>>,
  nonFiles: readonly string[] = [],
): ITrackedFileSource {
  return {
    list: () => Promise.resolve(Object.keys(entries)),
    read: (path) => {
      const entry = entries[path];
      return entry instanceof Error ? Promise.reject(entry) : Promise.resolve(entry);
    },
    isNonFile: (path) => Promise.resolve(nonFiles.includes(path)),
  };
}

Deno.test("unreadable_included_file_fails_inventory", async () => {
  const unreadable = fakeSource({
    "packages/a/src/x.ts": new Deno.errors.PermissionDenied("no access"),
    "docs/y.md": "text",
  });
  await assertRejects(() => trackedTextFiles([]), Error).catch(() => undefined);
  await assertRejects(() => trackedTextFiles([], unreadable), Error, "packages/a/src/x.ts could not be read");
});

Deno.test("explicit_skips_stay_allowed_in_the_inventory", async () => {
  const source = fakeSource(
    {
      "packages/a/src/x.ts": "export const a = 1;",
      "exaix-dev-docs/planning/old.md": new Error("never read"),
      "tests/fixtures/port/golden.json": new Error("never read"),
      "assets/logo.png": new Error("never read"),
      ".github/prompts": new Error("never read"),
    },
    [".github/prompts"],
  );
  const files = await trackedTextFiles(["tests/fixtures/port/"], source);
  assertEquals([...files.keys()], ["packages/a/src/x.ts"]);
});

Deno.test("an_empty_inventory_fails", async () => {
  await assertRejects(() => trackedTextFiles([], fakeSource({ "assets/logo.png": "" })), Error, "inventory is empty");
});

Deno.test("successful_inventory_is_populated_and_checks_ids", async () => {
  const files = await trackedTextFiles([]);
  assert(files.size > 0);
  assert(files.has("packages/lint-policy/tests/fixtures/catalog_v1.json"));
  const staleId = ["never", "a", "real", "rule", "id"].join("-");
  const seeded = new Map(files).set("seeded/stale.md", `See [${staleId}] for details.\n`);
  assertEquals(findBareIdReferences(seeded, staleId), ["seeded/stale.md:1"]);
});
