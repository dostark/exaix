/**
 * @module HeadlessSessionLauncherReasoningTokensTest
 * @path apps/daemon/tests/headless_session_launcher_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. synthesizeFromStdout's written
 * Session/{traceId}/return.json token_stats object only reads
 * parsed.tokenStats.{input,output,total} — reasoning_tokens would be silently dropped at this
 * exact leaf-to-trunk assembly point (the session-delegate path's own equivalent of
 * ReActLoopStrategy's finishLoop/LegacyAgentStrategy's parsedResult.usage) even after
 * IDelegateParsedReturn and SessionTokenStatsSchema are both widened. Verifies a Codex spawn
 * whose stdout reports reasoning_output_tokens produces a return.json token_stats.reasoning_tokens.
 * @architectural-layer Services
 * @related-files [apps/daemon/src/headless_session_launcher.ts, packages/schemas/src/session_delegate.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { HeadlessSessionLauncher } from "../src/headless_session_launcher.ts";
import type { ISpawnArgs } from "../src/headless_session_launcher.ts";

const FIXED_NOW = new Date("2026-08-22T00:00:00.000Z");

function makeCodexChild(stdout: string): Deno.ChildProcess {
  return {
    status: Promise.resolve({ code: 0, signal: null }),
    stdout: new Response(stdout).body!,
    // Immediately-closed, not `new ReadableStream()` with no controller — that variant never
    // emits `done`, so drainStream() would wait out the full idle timeout instead of resolving
    // instantly.
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    kill: () => {},
  } as Deno.ChildProcess;
}

Deno.test("[headless_session_launcher] a Codex reasoning-token breakdown reaches return.json's token_stats.reasoning_tokens", async () => {
  const sessionDir = await Deno.makeTempDir({ prefix: "phase167-step12-session-" });
  const worktree = await Deno.makeTempDir({ prefix: "phase167-step12-worktree-" });
  try {
    const registry = createDefaultSessionAdapterRegistry();
    const clock = { now: () => FIXED_NOW };
    const service = new SessionDelegateService({ registry, clock, sessionDir });
    const brief = await service.prepareBrief({
      traceId: crypto.randomUUID(),
      agentRole: "test-role",
      gate: "code_changes",
      tool: "codex",
      objective: "Implement the permitted source change.",
      artifactRef: "Workspace/Plans/phase-167.md",
      permittedPaths: ["src/**"],
      worktreePath: worktree,
      tokenBudget: { max_input_tokens: 100, max_output_tokens: 100, max_total_tokens: 200 },
    });

    const codexStdout = [
      { type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Done." } },
      {
        type: "turn.completed",
        usage: { input_tokens: 150, output_tokens: 2340, reasoning_output_tokens: 2048 },
      },
    ].map((event) => JSON.stringify(event)).join("\n");
    const launcher = new HeadlessSessionLauncher({
      sessionDir,
      allowlist: new Set(["codex"]),
      spawn: (_args: ISpawnArgs) => makeCodexChild(codexStdout),
    });

    await launcher.launch(service.resolveLaunch(brief, "headless"), brief.trace_id, undefined);

    const returnPath = join(sessionDir, brief.trace_id, "return.json");
    const written = JSON.parse(await Deno.readTextFile(returnPath));

    assertEquals(written.token_stats.reasoning_tokens, 2048);
    // Existing fields remain correct.
    assertEquals(written.token_stats.input_tokens, 150);
    assertEquals(written.token_stats.output_tokens, 2340);
  } finally {
    await Deno.remove(sessionDir, { recursive: true });
    await Deno.remove(worktree, { recursive: true });
  }
});
