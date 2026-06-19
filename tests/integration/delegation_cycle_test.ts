/**
 * @module DelegationCycleTest
 * @path tests/integration/delegation_cycle_test.ts
 * @description Phase 111 — parametrized delegation cycle integration test.
 *   Exercises the complete brief → park → launch → reconcile path for all 4
 *   gates using any supported session tool. Supports mock binary, claude-code,
 *   and opencode. To test with a real tool, ensure the binary is on PATH:
 *
 *     # Mock (CI-safe, requires deno task build:mock-tool)
 *     deno test --filter delegation_cycle tests/integration/
 *
 *     # Real tools (requires auth)
 *     deno test --filter "delegation_cycle:claude" tests/integration/
 *     deno test --filter "delegation_cycle:opencode" tests/integration/
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { HeadlessSessionLauncher } from "../../apps/daemon/src/headless_session_launcher.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SESSION_GATE_DECISIONS, SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionGate, SessionTool } from "@exaix/schemas/session_delegate.ts";

interface IToolConfig {
  name: string;
  command: string;
  args: (objective: string) => string[];
  allowlist: string[];
  /** True if the tool writes return.json natively (like the mock). False = stdout capture. */
  writesReturnJson: boolean;
}

const MOCK_BIN = join(import.meta.dirname!, "..", "..", ".cache", "mock_session_tool_bin");
const GATES: SessionGate[] = ["refinement", "plan_review", "code_changes", "review"];

/** Available tools — detected by checking binary existence. */
const TOOLS: IToolConfig[] = [
  {
    name: "mock",
    command: MOCK_BIN,
    args: (_obj: string) => ["--brief"],
    allowlist: [MOCK_BIN],
    writesReturnJson: true,
  },
  {
    name: "claude-code",
    command: "claude",
    args: (obj: string) => ["-p", obj, "--output-format", "json"],
    allowlist: ["claude"],
    writesReturnJson: false,
  },
  {
    name: "opencode",
    command: "opencode",
    args: (obj: string) => ["run", "--format", "json", obj],
    allowlist: ["opencode"],
    writesReturnJson: false,
  },
];

interface ICycleResult {
  gate: SessionGate;
  accepted: boolean;
  decision: string | null | undefined;
  finalStatus: string;
}

async function runCycle(
  gate: SessionGate,
  tool: IToolConfig,
  sessionDir: string,
  waitDir: string,
): Promise<ICycleResult> {
  const traceId = crypto.randomUUID();
  const traceDir = join(sessionDir, traceId);
  await ensureDir(traceDir);
  const returnPath = join(traceDir, "return.json");
  const briefPath = join(traceDir, "brief.json");

  const brief = SessionBriefSchema.parse({
    trace_id: traceId,
    gate,
    tool: tool.name === "mock" ? "claude-code" as SessionTool : tool.name as SessionTool,
    objective: `Delegation cycle test for gate ${gate}`,
    artifact_ref: "Workspace/Plans/test.md",
    permitted_paths: ["src/**", "tests/**"],
    token_budget: { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
    resume_token: crypto.randomUUID(),
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
  });
  await Deno.writeTextFile(briefPath, JSON.stringify(brief));

  const store = new SessionWaitStore(waitDir, { now: () => new Date() });
  const parked = await store.park(traceId, brief.gate, brief.resume_token, brief.deadline);
  assertEquals(parked.status, "pending");

  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set(tool.allowlist),
  });

  // Build launch args — mock uses --brief, real tools use their own format
  const launchArgs = tool.writesReturnJson ? [...tool.args(brief.objective), briefPath] : tool.args(brief.objective);
  const cwd = tool.writesReturnJson ? traceDir : traceDir;

  await launcher.launch(
    { command: tool.command, args: launchArgs, cwd, env: {} },
    traceId,
  );

  const returnExists = await Deno.stat(returnPath).then(() => true).catch(() => false);
  assertEquals(returnExists, true, `return.json must exist for gate ${gate} (${tool.name})`);

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

// ── Tool-agnostic test: run every available tool against all gates ──
// For each available tool, we generate a Deno.test that runs all 4 gates.

// First check what's available
const hasMock = (() => {
  try {
    Deno.statSync(MOCK_BIN);
    return true;
  } catch {
    return false;
  }
})();

type TestCase = { tool: string; skip: boolean };

const testCases: TestCase[] = [
  { tool: "mock", skip: !hasMock },
  { tool: "claude-code", skip: Deno.env.get("EXA_TEST_LIVE_DELEGATION") !== "true" },
  { tool: "opencode", skip: Deno.env.get("EXA_TEST_LIVE_DELEGATION") !== "true" },
];

for (const tc of testCases) {
  const toolConfig = TOOLS.find((t) => t.name === tc.tool) ?? {
    name: tc.tool,
    command: tc.tool === "claude-code" ? "claude" : tc.tool,
    args: (obj: string) =>
      tc.tool === "claude-code" ? ["-p", obj, "--output-format", "json"] : ["run", "--format", "json", obj],
    allowlist: [tc.tool === "claude-code" ? "claude" : tc.tool],
    writesReturnJson: false,
  };

  Deno.test({
    name: `[delegation_cycle:${tc.tool}] all 4 gates round-trip`,
    ignore: tc.skip,
    async fn() {
      const allResults: ICycleResult[] = [];

      for (const gate of GATES) {
        const sessionDir = await Deno.makeTempDir();
        const waitDir = await Deno.makeTempDir();
        try {
          const result = await runCycle(gate, toolConfig, sessionDir, waitDir);
          allResults.push(result);
        } finally {
          await Deno.remove(sessionDir, { recursive: true });
          await Deno.remove(waitDir, { recursive: true });
        }
      }

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
}
