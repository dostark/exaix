/**
 * @module ContentFixtureLoaderTest
 * @path tests/scenario_framework/tests/unit/content_fixture_loader_test.ts
 * @description Covers the `write-file` content fixture loader: a framework-relative path loads,
 *   and an absolute or escaping path is rejected.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/content_fixtures.ts]
 */

import { assert, assertRejects } from "@std/assert";
import { loadContentFixture } from "../../runner/content_fixtures.ts";

Deno.test("[content-fixtures] loads a framework-relative fixture", async () => {
  const text = await loadContentFixture("fixtures/configs/aci-doc-injection-enabled-write-config.toml");
  assert(text.includes("[system]"), "the fixture holds the system section");
  assert(text.includes('root = "$WORKSPACE_ROOT"'), "the fixture keeps the root sentinel");
});

Deno.test("[content-fixtures] rejects an absolute path", async () => {
  await assertRejects(() => loadContentFixture("/etc/passwd"), Error, "framework-relative");
});

Deno.test("[content-fixtures] rejects a path that leaves the framework tree", async () => {
  await assertRejects(() => loadContentFixture("../../../../etc/passwd"), Error, "escapes");
});
