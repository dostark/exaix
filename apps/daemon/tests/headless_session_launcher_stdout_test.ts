/**
 * @module HeadlessSessionLauncherStdoutTest
 * @path apps/daemon/tests/headless_session_launcher_stdout_test.ts
 * @description Phase 111 — unit tests for the tryReadStdoutAndSynthesize JSON
 *   event parsing in HeadlessSessionLauncher. Tests that opencode --format json
 *   output is correctly parsed into return.json.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { HeadlessSessionLauncher } from "../src/headless_session_launcher.ts";
import type { ISpawnArgs } from "../src/headless_session_launcher.ts";
import { SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";

const TRACE_ID = "00000000-0000-4000-8000-0000000000a1";

function makeMockChild(stdoutData: string, exitCode = 0): Deno.ChildProcess {
  const encoder = new TextEncoder();
  let read = false;
  return {
    status: Promise.resolve({ code: exitCode, signal: null }),
    stdout: new ReadableStream({
      pull(controller) {
        if (read) {
          controller.close();
          return;
        }
        read = true;
        controller.enqueue(encoder.encode(stdoutData));
        controller.close();
      },
    }),
    // Immediately-closed, not `new ReadableStream()` with no controller — that variant never
    // emits `done`, so drainStream() would wait out the full idle timeout on every test using
    // this helper instead of resolving instantly.
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    kill: () => {},
  } as Deno.ChildProcess;
}

const PIPE_STRESS_PAYLOAD_BYTES = 256 * 1024;
const DRAIN_START_TIMEOUT_MS = 1_000;

function makeBackpressuredChild(stdoutData: string, stderrData: string): Deno.ChildProcess {
  const status = Promise.withResolvers<Deno.CommandStatus>();
  let stdoutPulled = false;
  let stderrPulled = false;
  const markPulled = (stream: "stdout" | "stderr") => {
    stdoutPulled ||= stream === "stdout";
    stderrPulled ||= stream === "stderr";
    if (stdoutPulled && stderrPulled) status.resolve({ success: true, code: 0, signal: null });
  };
  const makeStream = (data: string, stream: "stdout" | "stderr") => {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.close();
          return;
        }
        sent = true;
        markPulled(stream);
        controller.enqueue(new TextEncoder().encode(data));
        controller.close();
      },
    }, { highWaterMark: 0 });
  };
  return {
    status: status.promise,
    stdout: makeStream(stdoutData, "stdout"),
    stderr: makeStream(stderrData, "stderr"),
    kill: () => {},
  } as Deno.ChildProcess;
}

interface IRig {
  sessionDir: string;
  launcher: HeadlessSessionLauncher;
  cleanup: () => Promise<void>;
}

async function makeRig(tool: "claude-code" | "opencode" | "codex" = "opencode"): Promise<IRig> {
  const sessionDir = await Deno.makeTempDir();
  const traceDir = join(sessionDir, TRACE_ID);
  await ensureDir(traceDir);
  // Write a minimal brief so synthesis can read it
  await Deno.writeTextFile(
    join(traceDir, "brief.json"),
    JSON.stringify({
      trace_id: TRACE_ID,
      gate: "refinement",
      tool,
      resume_token: "tok-01",
    }),
  );
  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set(["test"]),
    spawn: (_args: ISpawnArgs) => makeMockChild(""),
  });
  return {
    sessionDir,
    launcher,
    cleanup: async () => {
      await Deno.remove(sessionDir, { recursive: true });
    },
  };
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(
    output.success,
    true,
    `git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`,
  );
}

Deno.test("[launcher_stdout] dispatches a Codex brief to the Codex parser", async () => {
  const rig = await makeRig("codex");
  try {
    const stdout = [
      { type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Codex completed." } },
      {
        type: "item.completed",
        item: {
          id: "item-2",
          type: "file_change",
          changes: [{ path: "src/codex.ts", kind: "add" }],
          status: "completed",
        },
      },
      { type: "turn.completed", usage: { input_tokens: 41, cached_input_tokens: 11, output_tokens: 7 } },
    ].map((event) => JSON.stringify(event)).join("\n");

    const synthesized = await rig.launcher.tryReadStdoutAndSynthesize(
      makeMockChild(stdout),
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );

    assertEquals(synthesized, true);
    const parsed = SessionReturnSchema.parse(
      JSON.parse(await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"))),
    );
    assertEquals(parsed.summary, "Codex completed.");
    assertEquals(parsed.paths_touched, ["src/codex.ts"]);
    assertEquals(parsed.token_stats, { input_tokens: 41, output_tokens: 7, total_tokens: 48 });
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout][security] rejects an unknown brief tool at the schema boundary", async () => {
  const rig = await makeRig();
  try {
    await Deno.writeTextFile(
      join(rig.sessionDir, TRACE_ID, "brief.json"),
      JSON.stringify({
        trace_id: TRACE_ID,
        gate: "refinement",
        tool: "untrusted-tool",
        resume_token: "tok-01",
      }),
    );
    const synthesized = await rig.launcher.tryReadStdoutAndSynthesize(
      makeMockChild(JSON.stringify({ type: "text", part: { text: "must not parse" } })),
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synthesized, false);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] git porcelain adds modified, deleted, renamed, and untracked paths", async () => {
  const rig = await makeRig();
  const worktree = await Deno.makeTempDir({ prefix: "phase167-git-paths-" });
  try {
    await runGit(worktree, ["init", "--quiet"]);
    await runGit(worktree, ["config", "user.email", "phase167@example.invalid"]);
    await runGit(worktree, ["config", "user.name", "Phase 167 Test"]);
    await Deno.writeTextFile(join(worktree, "modified.ts"), "export const value = 1;\n");
    await Deno.writeTextFile(join(worktree, "deleted.ts"), "delete me\n");
    await Deno.writeTextFile(join(worktree, "old.ts"), "rename me\n");
    await runGit(worktree, ["add", "."]);
    await runGit(worktree, ["commit", "--quiet", "-m", "baseline"]);

    await Deno.writeTextFile(join(worktree, "modified.ts"), "export const value = 2;\n");
    await Deno.remove(join(worktree, "deleted.ts"));
    await runGit(worktree, ["mv", "old.ts", "new.ts"]);
    await Deno.writeTextFile(join(worktree, "untracked.ts"), "export const untracked = true;\n");

    const stdout = JSON.stringify({ type: "text", part: { text: "Work completed." } });
    const synthesized = await rig.launcher.tryReadStdoutAndSynthesize(
      makeMockChild(stdout),
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
      worktree,
    );

    assertEquals(synthesized, true);
    const parsed = SessionReturnSchema.parse(
      JSON.parse(await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"))),
    );
    assertEquals(parsed.paths_touched.toSorted(), [
      "deleted.ts",
      "modified.ts",
      "new.ts",
      "old.ts",
      "untracked.ts",
    ]);
  } finally {
    await rig.cleanup();
    await Deno.remove(worktree, { recursive: true });
  }
});

Deno.test("[launcher_stdout] parses single text event into return.json", async () => {
  const rig = await makeRig();
  try {
    const stdout = JSON.stringify({ type: "text", part: { text: "Paris." } }) + "\n" +
      JSON.stringify({ type: "step_finish", part: { tokens: { input: 10, output: 2, total: 12 } } });
    const child = makeMockChild(stdout);
    // Access private method via type cast to test in isolation
    const synth = await rig.launcher.tryReadStdoutAndSynthesize(
      child,
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synth, true, "should synthesize from stdout");

    const returnPath = join(rig.sessionDir, TRACE_ID, "return.json");
    const raw = await Deno.readTextFile(returnPath);
    const parsed = SessionReturnSchema.parse(JSON.parse(raw));
    assertEquals(parsed.trace_id, TRACE_ID);
    assertEquals(parsed.summary, "Paris.");
    assertEquals(parsed.token_stats.input_tokens, 10);
    assertEquals(parsed.token_stats.output_tokens, 2);
    assertEquals(parsed.token_stats.total_tokens, 12);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] uses last text event when multiple events", async () => {
  const rig = await makeRig();
  try {
    const stdout = [
      { type: "text", part: { text: "First draft." } },
      { type: "text", part: { text: "Final answer." } },
      { type: "step_finish", part: { tokens: { input: 50, output: 5, total: 55 } } },
    ].map((e) => JSON.stringify(e)).join("\n");
    const child = makeMockChild(stdout);
    const synth = await rig.launcher.tryReadStdoutAndSynthesize(
      child,
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synth, true);
    const raw = await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"));
    const parsed = JSON.parse(raw);
    assertEquals(parsed.summary, "Final answer.");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] empty stdout returns false (no synthesis)", async () => {
  const rig = await makeRig();
  try {
    const child = makeMockChild("");
    const synth = await rig.launcher.tryReadStdoutAndSynthesize(
      child,
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synth, false);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] non-JSON stdout synthesizes fallback return", async () => {
  const rig = await makeRig();
  try {
    const child = makeMockChild("just regular text output\nwith multiple lines");
    const synth = await rig.launcher.tryReadStdoutAndSynthesize(
      child,
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synth, true, "non-JSON stdout still produces a synthesized return");
    const raw = await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"));
    const parsed = JSON.parse(raw);
    assertEquals(parsed.trace_id, TRACE_ID);
    assertEquals(typeof parsed.summary, "string");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] missing brief.json returns false", async () => {
  const emptyDir = await Deno.makeTempDir();
  try {
    const launcher = new HeadlessSessionLauncher({
      sessionDir: emptyDir,
      allowlist: new Set(["test"]),
    });
    const child = makeMockChild(JSON.stringify({ type: "text", part: { text: "hi" } }));
    const synth = await launcher.tryReadStdoutAndSynthesize(
      child,
      "no-trace",
      join(emptyDir, "no-trace", "return.json"),
    );
    assertEquals(synth, false);
  } finally {
    await Deno.remove(emptyDir, { recursive: true });
  }
});

Deno.test("[launcher_stdout] step_finish without tokens uses zeroed stats", async () => {
  const rig = await makeRig();
  try {
    const stdout = JSON.stringify({ type: "text", part: { text: "No stats." } }) + "\n" +
      JSON.stringify({ type: "step_finish", part: {} });
    const child = makeMockChild(stdout);
    const synth = await rig.launcher.tryReadStdoutAndSynthesize(
      child,
      TRACE_ID,
      join(rig.sessionDir, TRACE_ID, "return.json"),
    );
    assertEquals(synth, true);
    const raw = await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"));
    const parsed = JSON.parse(raw);
    assertEquals(parsed.token_stats.input_tokens, 0);
    assertEquals(parsed.token_stats.output_tokens, 0);
    assertEquals(parsed.token_stats.total_tokens, 0);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] drains verbose stdout and stderr before awaiting child status", async () => {
  const rig = await makeRig("codex");
  try {
    const filler = "x".repeat(PIPE_STRESS_PAYLOAD_BYTES);
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: filler }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "drained" } }),
    ].join("\n");
    const child = makeBackpressuredChild(stdout, filler);
    const launcher = new HeadlessSessionLauncher({
      sessionDir: rig.sessionDir,
      allowlist: new Set(["codex"]),
      spawn: () => child,
    });
    const completed = await Promise.race([
      launcher.launch(
        { command: "codex", args: ["exec", "--json", "test"], cwd: rig.sessionDir, env: {} },
        TRACE_ID,
        undefined,
      ).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DRAIN_START_TIMEOUT_MS)),
    ]);

    assertEquals(completed, true, "launcher must begin draining both streams before awaiting status");
    const parsed = SessionReturnSchema.parse(
      JSON.parse(await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"))),
    );
    assertEquals(parsed.summary, "drained");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[launcher_stdout] cumulative byte cap truncates a stream instead of buffering it unbounded", async () => {
  // streamMaxBytes caps cumulative buffered bytes (not just idle time between reads); here it's
  // set far below the payload so the JSONL line is truncated mid-object, forcing the generic
  // summary fallback — proving the cap actually stops buffering.
  const rig = await makeRig("codex");
  try {
    const filler = "y".repeat(2_000);
    const stdout = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: filler } });
    const child = makeMockChild(stdout);
    const launcher = new HeadlessSessionLauncher({
      sessionDir: rig.sessionDir,
      allowlist: new Set(["codex"]),
      spawn: () => child,
      streamMaxBytes: 200,
    });
    await launcher.launch(
      { command: "codex", args: ["exec", "--json", "test"], cwd: rig.sessionDir, env: {} },
      TRACE_ID,
      undefined,
    );
    const parsed = SessionReturnSchema.parse(
      JSON.parse(await Deno.readTextFile(join(rig.sessionDir, TRACE_ID, "return.json"))),
    );
    assertEquals(
      parsed.summary.includes(filler),
      false,
      "a capped stream must never yield the full unbounded filler text in the synthesized summary",
    );
  } finally {
    await rig.cleanup();
  }
});
