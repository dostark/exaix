/**
 * @module CompatSession
 * @path tests/compat/harness/session.ts
 * @description Runs one sandbox script that can pause at checkpoints while the host observes or acts.
 */

import { join } from "@std/path";
import type { ICandidateBinding, ICommandObservation } from "./compat_types.ts";
import { buildBwrapArgs, decodeOutput, SANDBOX_CONTROL } from "./sandbox.ts";

export interface ISessionOptions {
  binding: ICandidateBinding;
  copyDir: string;
  homeDir: string;
  /** POSIX shell text. It can call `compat_checkpoint <label>` and then read `$COMPAT_REPLY`. */
  script: string;
  /** Runs on the host while the script waits. The returned single line becomes `$COMPAT_REPLY`. */
  onCheckpoint: (label: string) => Promise<string>;
  /** Labels that the script must reach. A script that exits without one of them fails the session. */
  expectedCheckpoints?: string[];
}

export interface ISessionResult {
  observation: ICommandObservation;
  checkpoints: string[];
}

interface ILineBuffer {
  text: string;
}

const TO_HOST = "to-host";
const TO_SCRIPT = "to-script";
const EXIT_MARKER = "__compat_exit__";
const READ_CHUNK_BYTES = 4096;
const SHELL = "/bin/sh";
const PRELUDE =
  `compat_checkpoint() { printf '%s\\n' "$1" > ${SANDBOX_CONTROL}/${TO_HOST}; IFS= read -r COMPAT_REPLY < ${SANDBOX_CONTROL}/${TO_SCRIPT}; }`;

async function makeFifo(path: string): Promise<void> {
  const output = await new Deno.Command("mkfifo", { args: [path] }).output();
  if (!output.success) throw new Error(`mkfifo failed for ${path}`);
}

async function readLine(file: Deno.FsFile, buffer: ILineBuffer): Promise<string> {
  const decoder = new TextDecoder();
  const chunk = new Uint8Array(READ_CHUNK_BYTES);
  while (true) {
    const newline = buffer.text.indexOf("\n");
    if (newline >= 0) {
      const line = buffer.text.slice(0, newline);
      buffer.text = buffer.text.slice(newline + 1);
      return line;
    }
    const count = await file.read(chunk);
    if (count === null) throw new Error("the control channel closed");
    buffer.text += decoder.decode(chunk.subarray(0, count), { stream: true });
  }
}

/** Runs the script in one sandbox call. The host holds both FIFOs open, so no open blocks and no reply is lost. */
export async function runSession(options: ISessionOptions): Promise<ISessionResult> {
  const controlDir = await Deno.makeTempDir({ prefix: "compat-ctl-" });
  const encoder = new TextEncoder();
  const reached: string[] = [];
  let toHost: Deno.FsFile | null = null;
  let wakeHost: Deno.FsFile | null = null;
  let toScript: Deno.FsFile | null = null;
  try {
    await makeFifo(join(controlDir, TO_HOST));
    await makeFifo(join(controlDir, TO_SCRIPT));
    toHost = await Deno.open(join(controlDir, TO_HOST), { read: true, write: true });
    toScript = await Deno.open(join(controlDir, TO_SCRIPT), { read: true, write: true });
    // Deno serialises operations on one handle, so the wake-up write needs its own handle.
    wakeHost = await Deno.open(join(controlDir, TO_HOST), { read: true, write: true });

    const args = buildBwrapArgs(options.binding, options.copyDir, options.homeDir, controlDir);
    const child = new Deno.Command("bwrap", {
      args: [...args, "--", SHELL, "-c", `${PRELUDE}\n${options.script}`],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const host = toHost;
    const wake = wakeHost;
    const script = toScript;
    const finished = child.output().then(async (output) => {
      await wake.write(encoder.encode(`${EXIT_MARKER}\n`));
      return output;
    });

    const buffer: ILineBuffer = { text: "" };
    try {
      while (true) {
        const label = await readLine(host, buffer);
        if (label === EXIT_MARKER) break;
        reached.push(label);
        const reply = await options.onCheckpoint(label);
        if (reply.includes("\n")) throw new Error(`the reply to checkpoint ${label} has more than one line`);
        await script.write(encoder.encode(`${reply}\n`));
      }
    } catch (error) {
      child.kill("SIGKILL");
      await finished.catch(() => undefined);
      throw error;
    }

    const output = await finished;
    const missing = (options.expectedCheckpoints ?? []).filter((label) => !reached.includes(label));
    if (missing.length > 0) throw new Error(`the script exited without reaching checkpoint: ${missing.join(", ")}`);

    const stdout = decodeOutput(output.stdout);
    const stderr = decodeOutput(output.stderr);
    return {
      checkpoints: reached,
      observation: {
        argv: [SHELL, "-c", options.script],
        exitCode: output.code,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutEncoding: stdout.encoding,
        stderrEncoding: stderr.encoding,
      },
    };
  } finally {
    toHost?.close();
    wakeHost?.close();
    toScript?.close();
    await Deno.remove(controlDir, { recursive: true });
  }
}
