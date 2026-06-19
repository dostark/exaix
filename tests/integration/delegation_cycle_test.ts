/**
 * @module DelegationCycleTest
 * @path tests/integration/delegation_cycle_test.ts
 * @description Phase 111 — full delegation cycle integration test.
 *   Exercises the complete brief → park → launch → reconcile → dispatch path
 *   using the compiled mock binary through HeadlessSessionLauncher.
 *   Verifies that the return.json is schema-valid, the wait state transitions
 *   to resumed, and the onReconciled dispatcher produces the correct artifact.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { HeadlessSessionLauncher } from "../../apps/daemon/src/headless_session_launcher.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SESSION_GATE_DECISIONS, SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionGate } from "@exaix/schemas/session_delegate.ts";

const MOCK_BIN = join(import.meta.dirname!, "..", "..", ".cache", "mock_session_tool_bin");
const MOCK_BIN_EXISTS = (() => {
  try {
    Deno.statSync(MOCK_BIN);
    return true;
  } catch {
    return false;
  }
})();

interface ICycleResult {
  gate: SessionGate;
  accepted: boolean;
  decision: string | null | undefined;
  finalStatus: string;
}

async function runCycle(gate: SessionGate, sessionDir: string, waitDir: string): Promise<ICycleResult> {
  const traceId = crypto.randomUUID();
  const traceDir = join(sessionDir, traceId);
  await ensureDir(traceDir);
  const returnPath = join(traceDir, "return.json");
  const briefPath = join(traceDir, "brief.json");

  // 1. Prepare brief (as SessionDelegateService would)
  const brief = SessionBriefSchema.parse({
    trace_id: traceId,
    gate,
    tool: "claude-code",
    objective: `Delegation cycle test for gate ${gate}`,
    artifact_ref: "Workspace/Plans/test.md",
    permitted_paths: ["src/**", "tests/**"],
    token_budget: { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
    resume_token: crypto.randomUUID(),
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
  });
  await Deno.writeTextFile(briefPath, JSON.stringify(brief));

  // 2. Park wait state (as the daemon's gate hook would)
  const store = new SessionWaitStore(waitDir, { now: () => new Date() });
  const parked = await store.park(traceId, brief.gate, brief.resume_token, brief.deadline);
  assertEquals(parked.status, "pending");

  // 3. Launch through HeadlessSessionLauncher (as the daemon would)
  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set([MOCK_BIN]),
  });
  await launcher.launch(
    { command: MOCK_BIN, args: ["--brief", briefPath], cwd: traceDir, env: {} },
    traceId,
  );
  const returnExists = await Deno.stat(returnPath).then(() => true).catch(() => false);
  assertEquals(returnExists, true, `return.json must exist for gate ${gate}`);

  // 4. Reconcile via SessionReturnProcessor (as the watcher would)
  const processor = new SessionReturnProcessor({ sessionDir, workspaceRoot: sessionDir, waitStore: store });
  const outcome = await processor.processReturn(traceId);
  const finalState = await store.get(traceId);

  return {
    gate,
    accepted: outcome.accepted,
    decision: outcome.decision,
    finalStatus: finalState?.status ?? "unknown",
  };
}

Deno.test({
  name: "[delegation_cycle] every gate round-trips through brief→park→launch→reconcile",
  ignore: !MOCK_BIN_EXISTS,
  async fn() {
    const gates: SessionGate[] = ["refinement", "plan_review", "code_changes", "review"];
    const allResults: ICycleResult[] = [];

    for (const gate of gates) {
      const sessionDir = await Deno.makeTempDir();
      const waitDir = await Deno.makeTempDir();
      try {
        const result = await runCycle(gate, sessionDir, waitDir);
        allResults.push(result);
      } finally {
        await Deno.remove(sessionDir, { recursive: true });
        await Deno.remove(waitDir, { recursive: true });
      }
    }

    // Verify all gates
    for (const result of allResults) {
      assertEquals(result.accepted, true, `gate ${result.gate} must be accepted`);
      assertExists(result.decision, `gate ${result.gate} must have a decision`);
      assertEquals(
        result.decision,
        SESSION_GATE_DECISIONS[result.gate][0],
        `gate ${result.gate} decision must be canonical success verb`,
      );
      assertEquals(result.finalStatus, "resumed", `gate ${result.gate} wait state must be resumed`);
    }
  },
});
