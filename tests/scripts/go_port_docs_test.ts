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

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOCS = join(REPO_ROOT, "exaix-dev-docs");
const GO_ROOT = join(REPO_ROOT, "..", "exaix-go");

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

Deno.test("go-port-prereq-docs: the registry drops the Phase 245 row and blocks Phase 214", async () => {
  const registry = await read(DOCS, "planning", "PHASE_REGISTRY.md");
  assertEquals(/^\| \d+\s+\| 245\s+\|/m.test(registry), false);
  assertStringIncludes(registry, "| 214   | GP-01  | D26");
  assertStringIncludes(registry, "D26");
  assertStringIncludes(registry, "**Current selection:** Phase 214");
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
  const plan = await read(DOCS, "planning", "phase-245-go-port-prerequisites.md");
  const manifests = plan.match(/^# step-manifest$/gm) ?? [];
  assert(manifests.length >= 10, "plan lost its step manifests");
  assertStringIncludes(plan, "## Post-Gap Analysis");
  assertStringIncludes(plan, "## Gap Remediation Plan");
});

Deno.test("go-port-docs-go-readme: the Go README records the toolchain and the decision", async () => {
  const readme = await read(GO_ROOT, "README.md");
  assertStringIncludes(readme, "Go 1.27.4");
  assertStringIncludes(readme, "D24 returned **revise**");
  assertStringIncludes(readme, "tools/exaport");
});
