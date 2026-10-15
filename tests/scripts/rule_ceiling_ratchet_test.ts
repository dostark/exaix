/**
 * @module RuleCeilingRatchetTest
 * @path tests/scripts/rule_ceiling_ratchet_test.ts
 * @description Behaviour of the rule-ceiling ratchet evaluator.
 * @architectural-layer Test
 * @related-files [packages/lint-rules/src/cli/rule_ceiling.ts, packages/lint-rules/tests/check_code_style_catalog_parity_test.ts]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { evaluateCeilings } from "../../packages/lint-rules/src/cli/rule_ceiling.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const RATCHETED_RULES = [
  "exaix/require-safety-comment",
  "exaix/no-runtime-typeof",
  "exaix/no-conditional-empty-object-spread",
];

const KNOWN_RULES = ["exaix/require-safety-comment", "exaix/no-runtime-typeof"];
const KNOWN_PACKAGES = ["packages/flow", "packages/core"];

Deno.test("a count above the ceiling is reported with its delta", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 3 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over.length, 1);
  assertEquals(result.over[0].delta, 2);
  assertEquals(result.under.length, 0);
});

Deno.test("a count below the ceiling must be written back", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 3 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.under.length, 1);
  assertEquals(result.under[0].count, 3);
  assertEquals(result.over.length, 0);
});

Deno.test("a count equal to the ceiling is clean", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    { "exaix/no-runtime-typeof": { "packages/flow": 5 } },
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.over, []);
  assertEquals(result.under, []);
});

Deno.test("an unknown rule id is rejected", () => {
  const result = evaluateCeilings(
    { "exaix/not-a-rule": { "packages/flow": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownRules, ["exaix/not-a-rule"]);
});

Deno.test("an unknown package key is rejected", () => {
  const result = evaluateCeilings(
    { "exaix/no-runtime-typeof": { "packages/ghost": 1 } },
    {},
    KNOWN_RULES,
    KNOWN_PACKAGES,
  );
  assertEquals(result.unknownPackages, ["packages/ghost"]);
});

Deno.test("the committed ceilings file names only known rules and packages", async () => {
  const ceilings = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "scripts/config/rule_ceilings.json")));
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as { workspace?: string[] };
  const packages = (denoJson.workspace ?? [])
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter((entry) => entry.startsWith("packages/") || entry.startsWith("apps/"));
  const result = evaluateCeilings(ceilings, ceilings, RATCHETED_RULES, packages);
  assertEquals(result.unknownRules, []);
  assertEquals(result.unknownPackages, []);
});
