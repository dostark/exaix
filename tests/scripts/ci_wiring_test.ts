/**
 * @module CiWiringTest
 * @path tests/scripts/ci_wiring_test.ts
 * @description Asserts the unified CI pipeline (scripts/ci.ts) and the generated
 *   pre-commit hook (scripts/setup_hooks.ts) wire the two Phase 125 validity
 *   gates — check:skill-envelopes and check:manifests — so a malformed exaix:
 *   block or a manifest-less plan step fails CI (P125 GAP-14/15).
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/ci.ts, scripts/setup_hooks.ts]
 */

import { assert } from "@std/assert";

const CI_SOURCE = await Deno.readTextFile(new URL("../../scripts/ci.ts", import.meta.url));
const HOOKS_SOURCE = await Deno.readTextFile(new URL("../../scripts/setup_hooks.ts", import.meta.url));

Deno.test("[ci_wiring] scripts/ci.ts check action includes check:skill-envelopes", () => {
  assert(
    CI_SOURCE.includes('"check:skill-envelopes"'),
    "ci.ts must invoke check:skill-envelopes so a malformed exaix block fails CI (GAP-14)",
  );
});

Deno.test("[ci_wiring] scripts/ci.ts check action includes check:manifests", () => {
  assert(
    CI_SOURCE.includes('"check:manifests"'),
    "ci.ts must invoke check:manifests so a manifest-less step fails CI (GAP-14)",
  );
});

Deno.test("[ci_wiring] both gates are wired in both runParallel check arrays", () => {
  // The solo-scoped and edition-scoped check phases must each enforce the gates.
  const skillEnvelopeCount = CI_SOURCE.split('"check:skill-envelopes"').length - 1;
  const manifestsCount = CI_SOURCE.split('"check:manifests"').length - 1;
  assert(
    skillEnvelopeCount >= 2,
    `check:skill-envelopes must appear in both check arrays (found ${skillEnvelopeCount})`,
  );
  assert(
    manifestsCount >= 2,
    `check:manifests must appear in both check arrays (found ${manifestsCount})`,
  );
});

Deno.test("[ci_wiring] pre-commit hook content invokes both gates", () => {
  assert(
    HOOKS_SOURCE.includes("deno task check:skill-envelopes"),
    "pre-commit hook must invoke check:skill-envelopes (GAP-14)",
  );
  assert(
    HOOKS_SOURCE.includes("deno task check:manifests"),
    "pre-commit hook must invoke check:manifests (GAP-14)",
  );
});
