/**
 * @module Ste100EvidenceTest
 * @path tests/docs/ste100_evidence_test.ts
 * @description Verifies the Phase 195 Step 7 live-reachability evidence: the run manifest
 *   (gitignored local path, per the repo's "stop tracking temporal evidence" convention)
 *   parses to a success outcome with suite score >= 0.9, the execution log contains the
 *   daemon/request lifecycle markers, and the plan doc cites the gitignored evidence path
 *   and the durable committed CLI-objective test.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

const MANIFEST_PATH = "exaix-dev-docs/evidence/phase-195/step7-live-2026-09-24/run-manifest.json";
const LOG_PATH = "exaix-dev-docs/evidence/phase-195/step7-live-2026-09-24/scenario-execution.log";
const PLAN_DOC_PATH = "exaix-dev-docs/planning/phase-195-asd-ste100-agent-prose.md";

Deno.test("Step 7 manifest records a success with suite score >= 0.9", async () => {
  const raw = await Deno.readTextFile(MANIFEST_PATH);
  const manifest = JSON.parse(raw) as { outcome: string; suite_score: number };
  assertEquals(manifest.outcome, "success");
  assertEquals(manifest.suite_score >= 0.9, true, `suite_score must be >= 0.9, got ${manifest.suite_score}`);
});

Deno.test("Step 7 log contains daemon and request lifecycle markers", async () => {
  const log = await Deno.readTextFile(LOG_PATH);
  assertStringIncludes(log, "daemon.started");
  assertStringIncludes(log, "request.created");
});

Deno.test("Plan doc cites the evidence path and the durable CLI-objective test", async () => {
  const plan = await Deno.readTextFile(PLAN_DOC_PATH);
  assertStringIncludes(plan, "evidence/phase-195/step7-live-2026-09-24/run-manifest.json");
  assertStringIncludes(
    plan,
    "packages/execution/tests/agents/ste100_cli_objective_test.ts",
    "the durable CLI-objective test must be cited alongside the gitignored evidence",
  );
});

Deno.test("Evidence files exist at the gitignored local path", async () => {
  for (const p of [MANIFEST_PATH, LOG_PATH]) {
    assertEquals((await Deno.stat(p)).isFile, true, `expected ${p} to be a file`);
  }
});
