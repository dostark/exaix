/**
 * @module CodexSessionScopeTest
 * @path apps/daemon/tests/codex_session_scope_test.ts
 * @description Phase 167 Step 1 integration test proving an untracked forbidden
 *   Codex write is included in synthesized paths, rejected by reconciliation,
 *   journaled as a scope violation, and never resumes the durable wait state.
 * @architectural-layer Services
 * @related-files [apps/daemon/src/headless_session_launcher.ts, apps/daemon/src/session_return_watcher.ts, packages/session/src/session_return_processor.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { ILogEvent } from "@exaix/core/types";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { HeadlessSessionLauncher } from "../src/headless_session_launcher.ts";
import type { ISpawnArgs } from "../src/headless_session_launcher.ts";
import { SessionReturnWatcher } from "../src/session_return_watcher.ts";

const FIXED_NOW = new Date("2026-08-20T00:00:00.000Z");

class RecordingSink {
  readonly events: ILogEvent[] = [];

  log(event: ILogEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

function makeCodexChild(stdout: string): Deno.ChildProcess {
  return {
    status: Promise.resolve({ code: 0, signal: null }),
    stdout: new Response(stdout).body!,
    stderr: new ReadableStream(),
    kill: () => {},
  } as Deno.ChildProcess;
}

Deno.test("[codex_session_scope][security] untracked forbidden Codex write cannot resume the gate", async () => {
  const sessionDir = await Deno.makeTempDir({ prefix: "phase167-session-" });
  const waitDir = await Deno.makeTempDir({ prefix: "phase167-wait-" });
  const worktree = await Deno.makeTempDir({ prefix: "phase167-worktree-" });
  try {
    const gitInit = await new Deno.Command("git", {
      args: ["-C", worktree, "init", "--quiet"],
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(gitInit.success, true, new TextDecoder().decode(gitInit.stderr));

    const registry = createDefaultSessionAdapterRegistry();
    const clock = { now: () => FIXED_NOW };
    const service = new SessionDelegateService({ registry, clock, sessionDir });
    const store = new SessionWaitStore(waitDir, clock);
    const resultStore = new SessionDelegationResultStore(waitDir, clock.now);
    const brief = await service.prepareBrief({
      traceId: crypto.randomUUID(),
      identityId: "test-identity",
      gate: "code_changes",
      tool: "codex",
      objective: "Implement the permitted source change.",
      artifactRef: "Workspace/Plans/phase-167.md",
      permittedPaths: ["src/**"],
      worktreePath: worktree,
      tokenBudget: { max_input_tokens: 100, max_output_tokens: 100, max_total_tokens: 200 },
    });
    await store.park(brief.trace_id, brief.gate, brief.resume_token, brief.deadline);

    const codexStdout = [
      { type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Done." } },
      { type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } },
    ].map((event) => JSON.stringify(event)).join("\n");
    const launcher = new HeadlessSessionLauncher({
      sessionDir,
      allowlist: new Set(["codex"]),
      spawn: (_args: ISpawnArgs) => {
        Deno.writeTextFileSync(join(worktree, ".env"), "FORBIDDEN=true\n");
        return makeCodexChild(codexStdout);
      },
    });

    await launcher.launch(service.resolveLaunch(brief, "headless"), brief.trace_id, undefined);

    let reconciled = false;
    const sink = new RecordingSink();
    const watcher = new SessionReturnWatcher({
      sessionDir,
      processor: new SessionReturnProcessor({ sessionDir, workspaceRoot: worktree, waitStore: store, resultStore }),
      resultStore,
      logger: sink,
      onReconciled: () => {
        reconciled = true;
      },
    });
    await watcher.handleReturnPath(join(sessionDir, brief.trace_id, "return.json"));

    assertEquals(
      sink.events.map((event) => event.action).includes(DomainEventType.SessionDelegateScopeViolation),
      true,
    );
    assertEquals((await store.get(brief.trace_id))?.status, "pending");
    assertEquals(reconciled, false);
  } finally {
    await Deno.remove(sessionDir, { recursive: true });
    await Deno.remove(waitDir, { recursive: true });
    await Deno.remove(worktree, { recursive: true });
  }
});
