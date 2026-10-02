/**
 * @module BindingEvidenceCliTest
 * @path tests/scenario_framework/tests/integration/binding_evidence_cli_test.ts
 * @description Runs the real scenario runner CLI and opens the binding evidence it wrote. Bound runs in any pack keep
 *   their overlays, lock entries, judges and pin decisions, a refused bound run keeps its issues, and each scenario
 *   and trial keeps only its own request traces.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/provider_live_evidence.ts]
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { startToolChoiceRefusingFixture } from "./synthetic_test_helpers.ts";

const EVIDENCE_DIR = "provider-live-evidence";
const MOCK_JUDGE_BIND = "judge=service=mock,model=mock/mock-model";
const FIXTURE_REPLY = "COMPLETE\nSUMMARY: exploration complete";

interface IEvidence {
  outcome: string;
  qualified: boolean;
  traceIds: string[];
  overlays: Array<{ role: string; path: string; sha256: string }>;
  bindings: Array<{ traceId: string; stepId: string; outcome: string; service?: string; model?: string }>;
  judges: Array<{ stepId: string; service: string; model: string }>;
  pins: Array<{ selector: string; field: string }>;
  issues?: Array<{ code: string; stepId?: string }>;
}

/** Run the scenario runner CLI with a fresh output directory. With `mintSandbox`, the runner mints its own
 *  sandbox and reclaims it after a passing run, as an operator's run does. */
async function runCli(args: string[], env: Record<string, string> = {}, mintSandbox = false) {
  const root = await Deno.makeTempDir({ prefix: "binding-evidence-cli-" });
  const output = join(root, "out");
  const workspace = mintSandbox ? [] : ["--workspace", join(root, "ws")];
  // A minted sandbox goes under the test's own root. The runner still mints and reclaims it.
  const sandboxBase: Record<string, string> = mintSandbox ? { EXA_SANDBOX_BASE: join(root, "sandbox-base") } : {};
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "tests/scenario_framework/runner/main.ts", ...workspace, "--output", output, ...args],
    env: { ...env, ...sandboxBase, CI: "" },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const log = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  return { root, output, code: result.code, log };
}

async function readEvidence(dir: string, scenarioId: string): Promise<IEvidence> {
  return JSON.parse(await Deno.readTextFile(join(dir, EVIDENCE_DIR, `${scenarioId}.json`)));
}

async function sha256Of(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Every recorded overlay still holds the bytes its digest names. */
async function assertOverlayDigests(evidence: IEvidence): Promise<void> {
  assert(evidence.overlays.length > 0, "a bound run records its overlays");
  for (const overlay of evidence.overlays) assertEquals(await sha256Of(overlay.path), overlay.sha256, overlay.path);
}

Deno.test({
  name: "[evidence.cli] an agent-role run with a bound judge retains its judge, overlays and pin decisions",
  ignore: Deno.env.get("CI") === "true",
  async fn() {
    const run = await runCli(
      ["--cell", "mock", "--scenario", "senior-coder-smoke", "--bind", MOCK_JUDGE_BIND],
      {},
      true,
    );
    try {
      assertEquals(run.code, 0, run.log);
      // The runner reclaimed its own sandbox after the pass, and the evidence in the output directory survives it.
      assert(run.log.includes("Sandbox reclaimed:"), run.log);
      const evidence = await readEvidence(run.output, "senior-coder-smoke");
      assertEquals(evidence.outcome, "success");
      assertEquals(evidence.overlays.map((overlay) => overlay.role).sort(), ["operator", "scenario"]);
      await assertOverlayDigests(evidence);
      // The operator's judge choice is retained in its digest-checked overlay file.
      const operator = evidence.overlays.find((overlay) => overlay.role === "operator")!;
      const written = JSON.parse(await Deno.readTextFile(operator.path)) as { bindings: Record<string, object> };
      assertEquals(written.bindings.judge, { service: "mock", model: "mock/mock-model" });
      // Every agent-role judge step belongs to the live cell, so the mock run grades nothing.
      assertEquals(evidence.judges, []);
      assertEquals(evidence.pins, []);
      assert(evidence.traceIds.length > 0, "the run's own request traces are recorded");
    } finally {
      await Deno.remove(run.root, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[evidence.cli] the agent-flows cutover writes binding evidence through main.ts",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = startToolChoiceRefusingFixture([], "compat-fixture-v1", FIXTURE_REPLY);
    const port = String((fixture.addr as Deno.NetAddr).port);
    const run = await runCli(["--scenario", "self-hosted-split-bindings"], { EXA_COMPAT_FIXTURE_PORT: port });
    try {
      assertEquals(run.code, 0, run.log);
      const evidence = await readEvidence(run.output, "self-hosted-split-bindings");
      await assertOverlayDigests(evidence);
      const services = new Map(evidence.bindings.map((row) => [row.stepId, row.service]));
      assertEquals(services.get("compose"), "mock");
      assertEquals(services.get("explore-one"), "self-hosted-fixture");
      assertEquals(services.get("explore-two"), "self-hosted-fixture");
      assert(evidence.bindings.every((row) => evidence.traceIds.includes(row.traceId)), "lock rows use run traces");
      assertEquals(evidence.judges.map((judge) => [judge.stepId, judge.service]), [["grade-flow-plan", "claude-cli"]]);
    } finally {
      await fixture.shutdown();
      await Deno.remove(run.root, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[evidence.cli] a failed bound run retains diagnostics and is not qualified",
  ignore: Deno.env.get("CI") === "true",
  async fn() {
    // The pinned compose step refuses this override before the daemon starts, so no fixture server is needed.
    const run = await runCli(
      [
        "--scenario",
        "self-hosted-split-bindings",
        "--bind",
        "flow:self-hosted-split/step:compose=service=self-hosted-fixture",
      ],
      { EXA_COMPAT_FIXTURE_PORT: "1" },
    );
    try {
      assertNotEquals(run.code, 0, run.log);
      const evidence = await readEvidence(run.output, "self-hosted-split-bindings");
      assertEquals(evidence.outcome, "refused");
      assertEquals(evidence.qualified, false);
      assertEquals(evidence.issues?.map((issue) => issue.code), ["pinned"]);
    } finally {
      await Deno.remove(run.root, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[evidence.cli] two scenarios and two trials retain only their own request traces",
  ignore: Deno.env.get("CI") === "true",
  async fn() {
    const scenarios = ["senior-coder-smoke", "qa-engineer-smoke"];
    const run = await runCli([
      "--eval-mode",
      "--trials",
      "2",
      "--cell",
      "mock",
      ...scenarios.flatMap((id) => ["--scenario", id]),
      "--bind",
      MOCK_JUDGE_BIND,
    ]);
    try {
      const seen = new Set<string>();
      for (const trial of ["trial-0", "trial-1"]) {
        for (const scenarioId of scenarios) {
          const evidence = await readEvidence(join(run.output, trial), scenarioId);
          assert(evidence.traceIds.length > 0, `${trial}/${scenarioId} recorded no trace`);
          for (const traceId of evidence.traceIds) {
            assert(!seen.has(traceId), `${trial}/${scenarioId} reused trace ${traceId}`);
            seen.add(traceId);
          }
          await assertOverlayDigests(evidence);
        }
      }
    } finally {
      await Deno.remove(run.root, { recursive: true }).catch(() => {});
    }
  },
});
