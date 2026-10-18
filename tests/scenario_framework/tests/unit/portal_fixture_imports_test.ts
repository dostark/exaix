/**
 * @module ScenarioFrameworkPortalFixtureImportsTest
 * @path tests/scenario_framework/tests/unit/portal_fixture_imports_test.ts
 * @description Portal fixtures are copied into a sandbox without the repository's import map,
 *   so a bare `@std/...` specifier there fails the scenario's type-check. Every TypeScript file
 *   under `fixtures/portals/` must use explicit `jsr:`/`npm:`/relative specifiers.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/fixtures/portals/todo_app/src/business_logic_test.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const PORTALS_DIR = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "fixtures", "portals");
const BARE_STD_IMPORT = /from\s+["']@std\//;

Deno.test("[portal-fixtures] no portal fixture imports a bare @std/ specifier", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(PORTALS_DIR, { exts: [".ts"], includeDirs: false, followSymlinks: false })) {
    if (entry.isSymlink) continue;
    const text = await Deno.readTextFile(entry.path);
    if (BARE_STD_IMPORT.test(text)) offenders.push(relative(PORTALS_DIR, entry.path));
  }
  assertEquals(offenders, [], "portal fixtures run without the repo import map; use jsr: specifiers");
});
