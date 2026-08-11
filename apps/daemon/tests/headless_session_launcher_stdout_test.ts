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
    stderr: new ReadableStream(),
    kill: () => {},
  } as Deno.ChildProcess;
}

interface IRig {
  sessionDir: string;
  launcher: HeadlessSessionLauncher;
  cleanup: () => Promise<void>;
}

async function makeRig(): Promise<IRig> {
  const sessionDir = await Deno.makeTempDir();
  const traceDir = join(sessionDir, TRACE_ID);
  await ensureDir(traceDir);
  // Write a minimal brief so synthesis can read it
  await Deno.writeTextFile(
    join(traceDir, "brief.json"),
    JSON.stringify({
      trace_id: TRACE_ID,
      gate: "refinement",
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
