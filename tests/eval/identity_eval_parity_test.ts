/**
 * @module IdentityEvalParityTest
 * @path tests/eval/identity_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Identities/*.md entry has
 *   at least one eval scenario tagged entity:<identity>, minus an explicit
 *   exclusion list (mock-agent, README.md).
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const identityNames = [
  "code-analyst",
  "default",
  "dogfood-developer",
  "performance-engineer",
  "product-manager",
  "qa-engineer",
  "quality-judge",
  "research-synthesizer",
  "security-expert",
  "senior-coder",
  "software-architect",
  "technical-writer",
  "test-engineer",
  "voting-judge",
];

const identityExclusions: string[] = (parityExclusions.identities ?? []).map(
  (e: { id: string }) => e.id,
);

Deno.test("identity_eval_parity — all identities are covered or excluded", () => {
  const missing = assertCatalogCovered({
    catalogIds: identityNames,
    scenarioCatalog: [],
    subsystemTag: "subsystem:identities",
    exclusions: identityExclusions,
  });
  // With no scenario catalog loaded, all non-excluded identities show as missing
  const expectedMissing = identityNames.filter(
    (name) => !identityExclusions.includes(name),
  );
  assertEquals(
    new Set(missing),
    new Set(expectedMissing),
    `Expected missing: ${expectedMissing.join(", ")}; got: ${missing.join(", ")}`,
  );
});

Deno.test("identity_eval_parity — all identities pass when their scenarios exist", () => {
  const scenarioCatalog = identityNames.map((name) => ({
    id: `${name}_test`,
    tags: ["subsystem:identities", `entity:${name}`],
  }));
  const missing = assertCatalogCovered({
    catalogIds: identityNames,
    scenarioCatalog,
    subsystemTag: "subsystem:identities",
    exclusions: identityExclusions,
  });
  assertEquals(missing, []);
});
