/**
 * @module CheckEditionBundleTest
 * @path tests/scripts/check_edition_bundle_test.ts
 * @description Tests for the edition build-artifact gate (scripts/check_edition_bundle.ts).
 *   Source-text rules ([edition-leak]) cannot see what `deno compile` actually bundles —
 *   `deno compile`/`deno info` follow dynamic imports too, so a Solo entry's module graph can
 *   still contain Team code even when every static import is clean. This gate inspects the
 *   resolved module graph (deno info --json) and flags modules from a HIGHER edition tier than
 *   the build's own. Tiers: solo (no packages-team/, no exaix-enterprise/) < team (no
 *   exaix-enterprise/) < enterprise (anything).
 * @architectural-layer Test
 * @related-files [scripts/check_edition_bundle.ts]
 */

import { assertEquals } from "@std/assert";
import { EDITION_SOLO, EDITION_TEAM } from "@exaix/core";
import { findHigherTierModulesInGraph } from "../../scripts/check_edition_bundle.ts";

const ROOT = "file:///repo/";

Deno.test("[edition-bundle] a Solo graph with packages-team/ modules is flagged", () => {
  const specifiers = [
    `${ROOT}packages/core/mod.ts`,
    `${ROOT}apps/daemon/main.ts`,
    `${ROOT}packages-team/team-composer/mod.ts`,
    `${ROOT}packages-team/voting/src/x.ts`,
  ];
  const offenders = findHigherTierModulesInGraph(specifiers, EDITION_SOLO);
  assertEquals(offenders.sort(), [
    "packages-team/team-composer/mod.ts",
    "packages-team/voting/src/x.ts",
  ]);
});

Deno.test("[edition-bundle] a Solo graph with only MIT modules is clean", () => {
  const specifiers = [
    `${ROOT}packages/core/mod.ts`,
    `${ROOT}apps/exactl/src/init.ts`,
    `${ROOT}packages/quality-gate/mod.ts`,
  ];
  assertEquals(findHigherTierModulesInGraph(specifiers, EDITION_SOLO), []);
});

Deno.test("[edition-bundle] a Team graph may contain packages-team/ but NOT exaix-enterprise/", () => {
  const specifiers = [
    `${ROOT}packages/core/mod.ts`,
    `${ROOT}packages-team/voting/src/x.ts`,
    `${ROOT}exaix-enterprise/src/y.ts`,
  ];
  // packages-team is allowed for Team; only the enterprise module is an offender.
  assertEquals(findHigherTierModulesInGraph(specifiers, EDITION_TEAM), ["exaix-enterprise/src/y.ts"]);
});

Deno.test("[edition-bundle] non-file specifiers (jsr:, https:, npm:) are ignored", () => {
  const specifiers = [
    "jsr:@std/path@1.0.0",
    "https://deno.land/x/zod/mod.ts",
    "npm:something",
    `${ROOT}packages/core/mod.ts`,
  ];
  assertEquals(findHigherTierModulesInGraph(specifiers, EDITION_SOLO), []);
});
