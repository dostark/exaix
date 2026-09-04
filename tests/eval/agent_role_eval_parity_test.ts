/**
 * @module AgentRoleEvalParityTest
 * @path tests/eval/agent_role_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Agents/*.md entry has
 *   at least one eval scenario tagged entity:<agent-role>, minus an explicit
 *   exclusion list (mock-agent). The catalog is read from `Blueprints/Agents/` rather than
 *   restated, and `README.md` is dropped by the reader as a non-agent-role file.
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const AGENTS_DIR = join(REPO_ROOT, "Blueprints", "Agents");

// Files in `Blueprints/Agents/` that are not agent roles. `README.md` used to sit in
// `parity_exclusions.json`, misleadingly reading as a deliberately-uncovered agent role (and was
// inert, since the catalog it excluded from never contained it). Non-agent-role filtering belongs here.
const NON_AGENT_ROLE_FILES = new Set(["README"]);

// The shipped agent role catalog, read from disk — previously a hardcoded list of fourteen names,
// so the gate could not see an agent role added to the directory. Reading the directory is what
// makes the exclusion list mean anything, since both entries named files the hardcoded list omitted.
function readAgentRoleCatalog(): string[] {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(AGENTS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const id = entry.name.replace(/\.md$/, "");
    if (NON_AGENT_ROLE_FILES.has(id)) continue;
    names.push(id);
  }
  return names.sort();
}

const agentRoleNames = readAgentRoleCatalog();

const agentRoleExclusions: string[] = (parityExclusions.agent_roles ?? []).map(
  (e: { id: string }) => e.id,
);

// Two checks that used to sit here were tautologies (one used an empty scenario list, the other
// built the scenario list from the agent role names themselves) and duplicated
// `catalog_parity_harness_test.ts`. Removed rather than repaired; the real comparison is below.

Deno.test("agent_role_eval_parity — the catalog is read from disk, not restated here", async () => {
  // The list was hardcoded, so the gate could not see an agent role someone added to the directory —
  // and the two exclusion entries were inert, because neither `mock-agent` nor `README.md` appeared
  // in the hardcoded list they were excluding from.
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(AGENTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) onDisk.push(entry.name.replace(/\.md$/, ""));
  }

  assertEquals(
    [...agentRoleNames].sort(),
    onDisk.filter((name) => name !== "README").sort(),
    "the catalog under test must be what ships, so a new agent role is caught",
  );
});

Deno.test("agent_role_eval_parity — README.md is filtered by the reader, not excluded by hand", () => {
  // A directory readme is not an agent role. Listing it as a parity exclusion made the exclusion
  // list read as though a real agent role had been deliberately left uncovered.
  assertEquals(
    agentRoleExclusions.includes("README.md"),
    false,
    "README.md is not an agent role; the reader drops it rather than the exclusion list carrying it",
  );
  assertEquals(agentRoleNames.includes("README"), false, "the reader must not surface README as an agent role");
});

Deno.test("agent_role_eval_parity — mock-agent remains a real, reasoned exclusion", () => {
  // The distinction the fix depends on: mock-agent IS an agent role file, deliberately uncovered.
  // dogfood-coder + code-reviewer are meta-workflow agent roles exercised by live scenarios.
  assertEquals(
    [...agentRoleExclusions].sort(),
    ["code-reviewer", "dogfood-coder", "mock-agent"],
  );
});

Deno.test("agent_role_eval_parity — every shipped agent role has a real scenario, or a reasoned exclusion", async () => {
  // The two tests above compare the catalog against a SYNTHETIC scenario list — one empty, one
  // built from the agent role names themselves — so both are tautologies. Verified by canary:
  // dropping a new agent role file into Blueprints/Agents/ left the suite green.
  const catalog = await loadScenarioCatalog({
    frameworkHome: join(REPO_ROOT, "tests", "scenario_framework"),
  });

  const missing = assertCatalogCovered({
    catalogIds: agentRoleNames,
    scenarioCatalog: catalog.map((scenario) => ({ id: scenario.id, tags: scenario.tags })),
    subsystemTag: "subsystem:agent_roles",
    exclusions: agentRoleExclusions,
  });

  assertEquals(
    missing.sort(),
    [],
    `these agent roles ship with no scenario tagged entity:<id> and no reasoned exclusion in ` +
      `parity_exclusions.json:\n${missing.join("\n")}`,
  );
});
