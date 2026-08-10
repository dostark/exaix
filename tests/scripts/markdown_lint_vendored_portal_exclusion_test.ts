/**
 * @module MarkdownLintVendoredPortalExclusionTest
 * @path tests/scripts/markdown_lint_vendored_portal_exclusion_test.ts
 * @description Regression test (Phase 144 Step 5): a `.md`-suffixed file under
 * `fixtures/portals/**` is vendored, arbitrary externally-sourced task-environment content
 * (e.g. a Terminal-Bench task's own working-dir resource file), never Exaix-authored
 * documentation prose. `markdown_lint.ts` must never lint (or `--fix`, which would mutate
 * bytes) such a file — doing so would corrupt vendored fixtures the reference.patch/oracle
 * controls were computed against. A `.md` file OUTSIDE a `fixtures/portals/` path is
 * unaffected (e.g. the vendored `TASK.md`/request-fixture prose still lints normally).
 * @related-files [scripts/markdown_lint.ts]
 */

import { assertEquals } from "@std/assert";
import { collectMarkdownFiles } from "../../scripts/markdown_lint.ts";

Deno.test("[MarkdownLintVendoredPortalExclusion] a .md file under fixtures/portals/ is excluded from collection", async () => {
  const files = await collectMarkdownFiles([
    "tests/scenario_framework/fixtures/portals/external/terminal_bench/fix-git/resources/patch_files/about.md",
  ]);
  assertEquals(files, [], "vendored portal content must never be collected for linting");
});

Deno.test("[MarkdownLintVendoredPortalExclusion] a .md file under fixtures/external/ (not portals/) still collects normally", async () => {
  const files = await collectMarkdownFiles([
    "tests/scenario_framework/fixtures/external/terminal_bench/aimo-airline-departures/TASK.md",
  ]);
  assertEquals(files.length, 1, "non-portal vendored task prose must still be linted");
});
