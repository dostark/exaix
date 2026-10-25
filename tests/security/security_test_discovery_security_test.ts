/**
 * @module SecurityTestDiscoverySecurityTest
 * @path tests/security/security_test_discovery_security_test.ts
 * @related-files []
 * @architectural-layer Tests
 * @description Security regression for audit item R10. The `test:security` task must select every
 *   `*_security_test.ts` file in the root, package, app, Team and Enterprise trees.
 *   A security test that the task glob misses never runs in the security gate.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, globToRegExp, relative } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SECURITY_TEST_SUFFIX = "_security_test.ts";
const SECURITY_TASK = "test:security";
const EDITION_ROOTS: readonly string[] = ["tests", "packages", "apps", "exaix-team", "exaix-enterprise"];
const SKIPPED_DIRS: readonly RegExp[] = [/(^|\/)node_modules(\/|$)/, /(^|\/)\.git(\/|$)/, /(^|\/)\.sandbox(\/|$)/];
const QUOTED_GLOB_PATTERN = /"([^"]+)"/g;

/** The quoted globs of the `test:security` task in deno.json. */
async function readSecurityTaskGlobs(): Promise<string[]> {
  const denoJson = JSON.parse(await Deno.readTextFile(`${REPO_ROOT}deno.json`)) as { tasks: Record<string, string> };
  const task = denoJson.tasks[SECURITY_TASK];
  assert(task, `deno.json must define the ${SECURITY_TASK} task`);
  return [...task.matchAll(QUOTED_GLOB_PATTERN)].map((match) => match[1]);
}

Deno.test("[security] test:security covers every edition root", async () => {
  const roots = (await readSecurityTaskGlobs()).map((glob) => glob.split("/")[0]).sort();
  assertEquals(roots, [...EDITION_ROOTS].sort());
});

Deno.test("[security] test:security selects every *_security_test.ts file in the repository", async () => {
  const matchers = (await readSecurityTaskGlobs()).map((glob) => globToRegExp(glob, { globstar: true }));
  const discovered: string[] = [];
  for await (const entry of walk(REPO_ROOT, { includeDirs: false, skip: [...SKIPPED_DIRS] })) {
    if (!entry.name.endsWith(SECURITY_TEST_SUFFIX)) continue;
    discovered.push(relative(REPO_ROOT, entry.path));
  }

  assert(discovered.length > 0, "the walk must find the security test files");
  const missed = discovered.filter((path) => !matchers.some((matcher) => matcher.test(path)));
  assertEquals(missed, [], `test:security misses these security tests: ${missed.join(", ")}`);
  const editions = new Set(discovered.map((path) => path.split("/")[0]));
  console.info(`security test discovery: ${discovered.length} files across ${[...editions].sort().join(", ")}`);
});
