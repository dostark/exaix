/**
 * @module GoPortDocsTest
 * @path tests/scripts/go_port_docs_test.ts
 * @description Validates that the strategy, registry, evidence index, plan and Go README record the D24 outcome.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/go_port/d24_decision.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

import { goCheckout } from "../../scripts/go_port/checkout.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOCS = join(REPO_ROOT, "exaix-dev-docs");
const checkout = await goCheckout(REPO_ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");
const GO_ROOT = checkout ?? join(REPO_ROOT, "exaix-go");

async function read(...parts: readonly string[]): Promise<string> {
  return await Deno.readTextFile(join(parts[0], ...parts.slice(1)));
}

Deno.test("go-port-prereq-docs: the strategy records the W0a evidence and D24 revise", async () => {
  const strategy = await read(DOCS, "dev", "Exaix_Go_Port_Strategy.md");
  assertStringIncludes(strategy, "**W0a result (2026-11-19).**");
  assertStringIncludes(strategy, "D24 returns **revise**");
  assertStringIncludes(strategy, "**D26**");
  assertStringIncludes(strategy, "committed regardless of the D24 measurement");
  assertStringIncludes(strategy, "exaix-dev-docs/evidence/go-port/");
});

Deno.test("go-port-prereq-docs: the registry drops the closed Phase 245 and Phase 214 rows", async () => {
  const registry = await read(DOCS, "planning", "PHASE_REGISTRY.md");
  assertEquals(/^\| \d+\s+\| 245\s+\|/m.test(registry), false);
  assertEquals(/^\| 214\s+\|/m.test(registry), false);
  assertStringIncludes(registry, "D26");
  assertStringIncludes(registry, "Phase 214 closed on 2026-11-20");
});

Deno.test("go-port-prereq-docs: the evidence index names each recorded file", async () => {
  const index = await read(DOCS, "evidence", "go-port", "README.md");
  const entries = await Array.fromAsync(Deno.readDir(join(DOCS, "evidence", "go-port")));
  for (const entry of entries) {
    if (entry.isFile && entry.name !== "README.md") assertStringIncludes(index, entry.name);
  }
  assertStringIncludes(index, "D24 outcome is **`revise`**");
  assertStringIncludes(index, "D26");
});

Deno.test("go-port-prereq-docs: D26 unblocks Phase 214 in the readiness evidence", async () => {
  const readiness = JSON.parse(
    await read(DOCS, "evidence", "go-port", "phase214_ready.json"),
  ) as { ready: boolean; d26: string; errors: string[] };
  assertEquals(readiness.ready, true);
  assertEquals(readiness.d26, "committed");
  assertEquals(readiness.errors, []);
});

Deno.test("go-port-docs-plan: the plan keeps its steps and records the post-gap review", async () => {
  const plan = await read(DOCS, "completed", "phase-245-go-port-prerequisites.md");
  const manifests = plan.match(/^# step-manifest$/gm) ?? [];
  assert(manifests.length >= 10, "plan lost its step manifests");
  assertStringIncludes(plan, "## Post-Gap Analysis");
  assertStringIncludes(plan, "## Gap Remediation Plan");
});

Deno.test("go-port-retired: spent one-shot harness files are gone and evidence remains", async () => {
  const retired = [
    "scripts/go_port/benchmark.ts",
    "scripts/go_port/check_prereqs.ts",
    "scripts/go_port/phase214_ready.ts",
    "tests/scripts/go_port_benchmark_test.ts",
    "tests/scripts/go_port_check_prereqs_test.ts",
  ];
  for (const path of retired) {
    const exists = await Deno.stat(join(REPO_ROOT, path)).then(() => true).catch(() => false);
    assertEquals(exists, false, `${path} should be retired`);
  }
  for (const name of ["benchmarks.json", "prerequisites.json", "phase214_ready.json"]) {
    const text = await read(DOCS, "evidence", "go-port", name);
    assert(text.length > 0, `${name} evidence should remain`);
  }
});

Deno.test("go-port-docs-go-readme: the Go README records the current onboarding", {
  ignore: checkout === undefined,
}, async () => {
  const readme = await read(GO_ROOT, "README.md");
  assertStringIncludes(readme, "Go 1.27.4");
  assertStringIncludes(readme, "Phase 246 added the Stage 0 foundation");
  assertStringIncludes(readme, "make check");
  assertStringIncludes(readme, "AGENTS.md");
});

Deno.test("go-port-docs-contracts: the plan names the implemented evidence contracts", async () => {
  const plan = await read(DOCS, "completed", "phase-245-go-port-prerequisites.md");
  for (const name of ["ICostComparison", "ID24Decision", "time_log", "spend_usd", "extrapolated_hours"]) {
    assertStringIncludes(plan, name);
  }
  assertStringIncludes(plan, "validated by hand-written validators");
});
