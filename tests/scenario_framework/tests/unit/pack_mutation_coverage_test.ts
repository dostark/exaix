/**
 * @module ScenarioFrameworkPackMutationCoverageTest
 * @path tests/scenario_framework/tests/unit/pack_mutation_coverage_test.ts
 * @description Phase 142 Step 7 — every subsystem pack declares a mutation that must turn it red,
 *   and the declaration resolves to a real source location.
 *
 *   A green pack means something only if it is known to go red, and this phase repeatedly found
 *   packs that could not fail for the right reason: the skills pack sat at mean 0.714 with three
 *   "green" scenarios while asserting nothing at all (Step 17), and the fourteen identity smokes
 *   asserted a frontmatter field `PlanWriter` stamps unconditionally, so every one of them would
 *   have passed with the WRONG identity (Step 11).
 *
 *   Checking that the anchors still resolve is the part that keeps this honest over time: a
 *   refactor that moves the code would otherwise silently retire the pack's only evidence of
 *   sensitivity, and the registry would keep asserting a property nobody could reproduce.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/pack_mutations.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { mutationsFor, PACK_MUTATIONS, SUBSYSTEM_TAGS } from "../../runner/pack_mutations.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..", "..", "..");

Deno.test("[mutation-coverage] every subsystem declares at least one mutation", () => {
  const missing = SUBSYSTEM_TAGS.filter((tag) => mutationsFor(tag).length === 0);
  assertEquals(
    missing,
    [],
    `these packs have no recorded way to fail, so a green run proves nothing:\n${missing.join("\n")}`,
  );
});

Deno.test("[mutation-coverage] every mutation names a file that exists", async () => {
  const missing: string[] = [];
  for (const mutation of PACK_MUTATIONS) {
    const found = await Deno.stat(join(REPO_ROOT, mutation.file)).then(() => true).catch(() => false);
    if (!found) missing.push(`${mutation.subsystem} -> ${mutation.file}`);
  }
  assertEquals(missing.sort(), [], `mutation targets that no longer exist:\n${missing.join("\n")}`);
});

Deno.test("[mutation-coverage] every mutation's anchor still resolves in its file", async () => {
  // The check that survives refactoring: an anchor that no longer matches means the mutation
  // cannot be applied, so the pack's sensitivity is unproven whatever the registry claims.
  const dangling: string[] = [];
  for (const mutation of PACK_MUTATIONS) {
    const source = await Deno.readTextFile(join(REPO_ROOT, mutation.file)).catch(() => null);
    if (source === null) continue; // reported by the test above
    if (!source.includes(mutation.find)) {
      dangling.push(`${mutation.subsystem} (${mutation.file}): anchor not found — ${mutation.find.slice(0, 60)}`);
    }
  }
  assertEquals(dangling.sort(), [], `mutation anchors that no longer match:\n${dangling.join("\n")}`);
});

Deno.test("[mutation-coverage] a mutation actually changes the source it targets", async () => {
  // Guards against a no-op entry: `find` and `replace` being equal would let a pack claim coverage
  // while mutating nothing.
  const noops: string[] = [];
  for (const mutation of PACK_MUTATIONS) {
    if (mutation.find === mutation.replace) noops.push(mutation.subsystem);
    const source = await Deno.readTextFile(join(REPO_ROOT, mutation.file)).catch(() => null);
    if (source !== null && source.replace(mutation.find, mutation.replace) === source) {
      noops.push(`${mutation.subsystem} (replacement is a no-op)`);
    }
  }
  assertEquals([...new Set(noops)].sort(), []);
});

Deno.test("[mutation-coverage] every mutation says what it breaks", () => {
  // The registry is read by a human deciding whether the pack's guarantee is worth anything; an
  // entry that does not say what it breaks cannot be judged.
  for (const mutation of PACK_MUTATIONS) {
    assert(mutation.breaks.length > 20, `${mutation.subsystem}: 'breaks' must describe the mechanism`);
  }
});
