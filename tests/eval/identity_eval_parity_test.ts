/**
 * @module IdentityEvalParityTest
 * @path tests/eval/identity_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Agents/*.md entry has
 *   at least one eval scenario tagged entity:<identity>, minus an explicit
 *   exclusion list (mock-agent). The catalog is read from `Blueprints/Agents/` rather than
 *   restated, and `README.md` is dropped by the reader as a non-identity file.
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Agents");

// Files in `Blueprints/Agents/` that are not identities. `README.md` used to sit in
// `parity_exclusions.json`, misleadingly reading as a deliberately-uncovered identity (and was
// inert, since the catalog it excluded from never contained it). Non-identity filtering belongs here.
const NON_IDENTITY_FILES = new Set(["README"]);

// The shipped identity catalog, read from disk — previously a hardcoded list of fourteen names,
// so the gate could not see an identity added to the directory. Reading the directory is what
// makes the exclusion list mean anything, since both entries named files the hardcoded list omitted.
function readIdentityCatalog(): string[] {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(IDENTITIES_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const id = entry.name.replace(/\.md$/, "");
    if (NON_IDENTITY_FILES.has(id)) continue;
    names.push(id);
  }
  return names.sort();
}

const identityNames = readIdentityCatalog();

const identityExclusions: string[] = (parityExclusions.identities ?? []).map(
  (e: { id: string }) => e.id,
);

// Two checks that used to sit here were tautologies (one used an empty scenario list, the other
// built the scenario list from the identity names themselves) and duplicated
// `catalog_parity_harness_test.ts`. Removed rather than repaired; the real comparison is below.

Deno.test("identity_eval_parity — the catalog is read from disk, not restated here", async () => {
  // The list was hardcoded, so the gate could not see an identity someone added to the directory —
  // and the two exclusion entries were inert, because neither `mock-agent` nor `README.md` appeared
  // in the hardcoded list they were excluding from.
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(IDENTITIES_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) onDisk.push(entry.name.replace(/\.md$/, ""));
  }

  assertEquals(
    [...identityNames].sort(),
    onDisk.filter((name) => name !== "README").sort(),
    "the catalog under test must be what ships, so a new identity is caught",
  );
});

Deno.test("identity_eval_parity — README.md is filtered by the reader, not excluded by hand", () => {
  // A directory readme is not an identity. Listing it as a parity exclusion made the exclusion
  // list read as though a real identity had been deliberately left uncovered.
  assertEquals(
    identityExclusions.includes("README.md"),
    false,
    "README.md is not an identity; the reader drops it rather than the exclusion list carrying it",
  );
  assertEquals(identityNames.includes("README"), false, "the reader must not surface README as an identity");
});

Deno.test("identity_eval_parity — mock-agent remains a real, reasoned exclusion", () => {
  // The distinction the fix depends on: mock-agent IS an identity file, deliberately uncovered.
  // dogfood-coder + code-reviewer are meta-workflow identities exercised by live scenarios.
  assertEquals(
    [...identityExclusions].sort(),
    ["code-reviewer", "dogfood-coder", "mock-agent"],
  );
});

Deno.test("identity_eval_parity — every shipped identity has a real scenario, or a reasoned exclusion", async () => {
  // The two tests above compare the catalog against a SYNTHETIC scenario list — one empty, one
  // built from the identity names themselves — so both are tautologies. Verified by canary:
  // dropping a new identity file into Blueprints/Agents/ left the suite green.
  const catalog = await loadScenarioCatalog({
    frameworkHome: join(REPO_ROOT, "tests", "scenario_framework"),
  });

  const missing = assertCatalogCovered({
    catalogIds: identityNames,
    scenarioCatalog: catalog.map((scenario) => ({ id: scenario.id, tags: scenario.tags })),
    subsystemTag: "subsystem:identities",
    exclusions: identityExclusions,
  });

  assertEquals(
    missing.sort(),
    [],
    `these identities ship with no scenario tagged entity:<id> and no reasoned exclusion in ` +
      `parity_exclusions.json:\n${missing.join("\n")}`,
  );
});
