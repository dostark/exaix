/**
 * @module HeadlessSessionLauncherTest
 * @path apps/daemon/tests/headless_session_launcher_test.ts
 * @description Phase 111 Step 2 — tests for the HeadlessSessionLauncher hardened
 *   spawn: binary allowlist enforcement, round-trip via a stub-binary return.json,
 *   and abandoned synthesis on exit-without-return.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { HeadlessSessionLauncher } from "../src/headless_session_launcher.ts";
import type { ISpawnArgs } from "../src/headless_session_launcher.ts";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionGate } from "@exaix/schemas/session_delegate.ts";
import { SESSION_GATE_DECISIONS } from "@exaix/schemas/session_delegate.ts";
import { SESSION_BIN_CODEX, SESSION_ENV_MAX_TOTAL_TOKENS } from "@exaix/core/types";
import { withEnv } from "@exaix/testing";

function makeLaunch(overrides: Partial<ISessionLaunch> = {}): ISessionLaunch {
  return {
    command: "claude",
    args: ["-p", "do work"],
    cwd: "/tmp",
    env: {},
    ...overrides,
  };
}

function makeMockChild(code: number): Deno.ChildProcess {
  return {
    status: Promise.resolve({ code, signal: null }),
    stdout: new ReadableStream(),
    stderr: new ReadableStream(),
    kill: () => {},
  } as Deno.ChildProcess;
}

Deno.test("[headless_launcher][security] non-allowlisted binary is rejected", async () => {
  const launcher = new HeadlessSessionLauncher({
    sessionDir: "/tmp/sessions",
    allowlist: new Set(["safe-bin"]),
    spawn: () => makeMockChild(0),
  });
  await assertRejects(
    () => launcher.launch(makeLaunch({ command: "evil-script" }), "00000000-0000-0000-0000-000000000000", undefined),
    Error,
  );
});

Deno.test("[headless_launcher] spawn is called with the command and args from the launch descriptor", async () => {
  const captured: ISpawnArgs[] = [];
  const launcher = new HeadlessSessionLauncher({
    sessionDir: "/tmp/sessions",
    allowlist: new Set(["claude"]),
    spawn: (args: ISpawnArgs) => {
      captured.push(args);
      return makeMockChild(0);
    },
  });
  await launcher.launch(
    makeLaunch({ command: "claude", args: ["-p", "refactor"] }),
    "00000000-0000-4000-8000-000000000001",
    undefined,
  );
  assertEquals(captured.length, 1, "spawn must be called exactly once");
  if (captured.length > 0) {
    assertEquals(captured[0].command, "claude");
    assertEquals(captured[0].args, ["-p", "refactor"]);
  }
});

Deno.test("[headless_launcher][security] Codex spawn preserves cwd and strips ambient secrets", async () => {
  const sessionDir = await Deno.makeTempDir();
  const worktree = await Deno.makeTempDir();
  const captured: ISpawnArgs[] = [];
  try {
    await withEnv(
      {
        OPENAI_API_KEY: "ambient-openai-secret",
        CODEX_API_KEY: "ambient-codex-secret",
        PHASE167_PRIVATE_KEY: "ambient-private-secret",
        PATH: "/safe/bin",
        LANG: "C.UTF-8",
      },
      async () => {
        const launcher = new HeadlessSessionLauncher({
          sessionDir,
          allowlist: new Set([SESSION_BIN_CODEX]),
          spawn: (args: ISpawnArgs) => {
            captured.push(args);
            return makeMockChild(0);
          },
        });
        await launcher.launch(
          makeLaunch({
            command: SESSION_BIN_CODEX,
            args: ["exec", "--json", "objective", "--sandbox", "workspace-write"],
            cwd: worktree,
            env: { [SESSION_ENV_MAX_TOTAL_TOKENS]: "15000" },
          }),
          "00000000-0000-4000-8000-000000000167",
          undefined,
        );
      },
    );

    assertEquals(captured.length, 1);
    assertEquals(captured[0].command, SESSION_BIN_CODEX);
    assertEquals(captured[0].cwd, worktree);
    assertEquals(captured[0].env.PATH, "/safe/bin");
    assertEquals(captured[0].env.LANG, "C.UTF-8");
    assertEquals(captured[0].env[SESSION_ENV_MAX_TOTAL_TOKENS], "15000");
    assertEquals(captured[0].env.OPENAI_API_KEY, undefined);
    assertEquals(captured[0].env.CODEX_API_KEY, undefined);
    assertEquals(captured[0].env.PHASE167_PRIVATE_KEY, undefined);
    // The sanitized child env must REPLACE (not merge with) the parent env: Deno.Command
    // merges `env` into the parent by default, so without clearEnv the ambient
    // LD_LIBRARY_PATH / secrets leak back in.
    assertEquals(captured[0].clearEnv, true);
    assertEquals(captured[0].args.includes("danger-full-access"), false);
    assertEquals(captured[0].args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  } finally {
    await Deno.remove(sessionDir, { recursive: true });
    await Deno.remove(worktree, { recursive: true });
  }
});

Deno.test("[headless_launcher] stub binary that writes return.json round-trips", async () => {
  const sessionDir = await Deno.makeTempDir();
  const traceId = "00000000-0000-0000-0000-000000000002";
  const traceDir = join(sessionDir, traceId);
  await Deno.mkdir(traceDir, { recursive: true });
  const returnPath = join(traceDir, "return.json");

  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set(["stub"]),
    spawn: (_args: ISpawnArgs) => {
      Deno.writeTextFileSync(returnPath, JSON.stringify({ decision: "approved" }));
      return makeMockChild(0);
    },
  });
  await launcher.launch(
    makeLaunch({ command: "stub", cwd: traceDir }),
    traceId,
    undefined,
  );
  const content = await Deno.readTextFile(returnPath).catch(() => null);
  assertEquals(content !== null, true, "return.json must exist after launch");
});

Deno.test("[headless_launcher] exit-without-return synthesizes abandoned return.json", async () => {
  const sessionDir = await Deno.makeTempDir();
  const traceId = "00000000-0000-4000-8000-000000000003";
  const traceDir = join(sessionDir, traceId);
  await Deno.mkdir(traceDir, { recursive: true });
  const returnPath = join(traceDir, "return.json");

  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set(["stub"]),
    spawn: (_args: ISpawnArgs) => makeMockChild(0),
  });
  await launcher.launch(
    makeLaunch({ command: "stub", cwd: traceDir }),
    traceId,
    undefined,
  );
  const content = await Deno.readTextFile(returnPath).catch(() => null);
  assertEquals(content !== null, true, "abandoned return.json must be synthesized");
  if (content) {
    const parsed = JSON.parse(content);
    assertEquals(parsed.decision, "abandoned");
  }
});

Deno.test("[headless_launcher][security] a never-exiting child is killed within the bounded launch timeout", async () => {
  // A hung child (unanswerable interactive prompt, deadlock, etc.) must not wedge the
  // launch forever: an injected short deadline kills the child and the launch still
  // completes, degraded to an abandoned return, instead of hanging.
  const sessionDir = await Deno.makeTempDir();
  const traceId = "00000000-0000-4000-8000-000000000005";
  let killed = false;
  const hungChild: Deno.ChildProcess = {
    status: new Promise<Deno.CommandStatus>(() => {}), // never resolves
    stdout: new ReadableStream(),
    stderr: new ReadableStream(),
    kill: () => {
      killed = true;
    },
  } as Deno.ChildProcess;

  try {
    const launcher = new HeadlessSessionLauncher({
      sessionDir,
      allowlist: new Set(["stub"]),
      spawn: (_args: ISpawnArgs) => hungChild,
      launchTimeoutMs: 50,
    });
    await launcher.launch(makeLaunch({ command: "stub" }), traceId, undefined);

    assertEquals(killed, true, "the hung child must be killed once the launch timeout expires");
    const content = await Deno.readTextFile(join(sessionDir, traceId, "return.json")).catch(() => null);
    assertEquals(
      content !== null,
      true,
      "an abandoned return.json must still be synthesized — the launch must degrade, not hang unhandled",
    );
    if (content) {
      assertEquals(JSON.parse(content).decision, "abandoned");
    }
  } finally {
    await Deno.remove(sessionDir, { recursive: true });
  }
});

const MOCK_BIN_PATH = join(import.meta.dirname!, "../../..", ".cache", "mock_session_tool_bin");
const MOCK_BIN_EXISTS = (() => {
  try {
    Deno.statSync(MOCK_BIN_PATH);
    return true;
  } catch {
    return false;
  }
})();
const GATES: SessionGate[] = ["refinement", "plan_review", "code_changes", "review"];

// This test requires the mock binary to be pre-compiled via `deno task build:mock-tool`.
// CI should compile it in a setup step. Skip gracefully if missing.
Deno.test({
  name: "[headless_launcher][e2e] compiled mock binary round-trips through the launcher for every gate",
  ignore: !MOCK_BIN_EXISTS,
  async fn() {
    for (const gate of GATES) {
      const sessionDir = await Deno.makeTempDir();
      const traceId = crypto.randomUUID();
      const traceDir = join(sessionDir, traceId);
      await ensureDir(traceDir);
      const briefPath = join(traceDir, "brief.json");
      const returnPath = join(traceDir, "return.json");

      const brief = SessionBriefSchema.parse({
        trace_id: traceId,
        agent_role: "test-role",
        gate,
        tool: "claude-code",
        objective: `E2E test for gate ${gate}`,
        artifact_ref: "Workspace/Plans/test.md",
        permitted_paths: ["src/**", "tests/**"],
        token_budget: { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
        resume_token: crypto.randomUUID(),
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await Deno.writeTextFile(briefPath, JSON.stringify(brief));

      const launcher = new HeadlessSessionLauncher({
        sessionDir,
        allowlist: new Set([MOCK_BIN_PATH]),
      });
      const launch: ISessionLaunch = {
        command: MOCK_BIN_PATH,
        args: ["--brief", briefPath],
        cwd: traceDir,
        env: {},
      };
      await launcher.launch(launch, traceId, undefined);

      const raw = await Deno.readTextFile(returnPath).catch(() => null);
      assertEquals(raw !== null, true, `return.json must exist for gate ${gate}`);
      if (!raw) continue;

      const parsed = SessionReturnSchema.safeParse(JSON.parse(raw));
      assertEquals(parsed.success, true, `return must be schema-valid for gate ${gate}`);
      if (!parsed.success) continue;

      assertEquals(parsed.data.trace_id, traceId, `trace_id must match brief for gate ${gate}`);
      assertEquals(
        parsed.data.decision,
        SESSION_GATE_DECISIONS[gate][0],
        `decision must be the canonical success verb for gate ${gate}`,
      );

      await Deno.remove(sessionDir, { recursive: true });
    }
  },
});
