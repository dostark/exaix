/**
 * @module CompatSandbox
 * @path tests/compat/harness/sandbox.ts
 * @description Builds and runs the bubblewrap profile that isolates a candidate from the host and from any TS fallback.
 */

import { encodeBase64 } from "@std/encoding/base64";
import { basename, isAbsolute, join, resolve } from "@std/path";
import { CandidateKind, OutputEncoding } from "./compat_types.ts";
import type { ICandidateBinding, ICommandObservation } from "./compat_types.ts";

export const SANDBOX_COPY_ROOT = "/compat/ws";
export const SANDBOX_HOME = "/compat/home";
export const SANDBOX_BIN = "/compat/bin";
export const SANDBOX_LIB = "/compat/lib";
export const SANDBOX_REF = "/compat/ref";
export const SANDBOX_DENODIR = "/compat/denodir";
/** The harness work tree, a sibling of the repository, relative to the repository root. */
export const SANDBOX_TREE_ROOT = "../exaix-sandboxes/phase-214";

const BWRAP_COMMAND = "bwrap";
const BASE_MOUNTS = [
  "--ro-bind",
  "/usr",
  "/usr",
  "--symlink",
  "usr/bin",
  "/bin",
  "--symlink",
  "usr/lib",
  "/lib",
  "--symlink",
  "usr/lib64",
  "/lib64",
  "--ro-bind",
  "/etc",
  "/etc",
  "--proc",
  "/proc",
  "--dev",
  "/dev",
  "--tmpfs",
  "/tmp",
];
const ISOLATION_FLAGS = ["--unshare-net", "--unshare-pid", "--die-with-parent", "--clearenv"];
const PROBE_COMMAND = "/usr/bin/true";
const TS_FALLBACK_ENV_NAMES = ["DENO_SQLITE_PATH", "DENO_DIR", "EXA_DAEMON_SCRIPT"];
const TS_FALLBACK_MOUNTS = [SANDBOX_REF, SANDBOX_DENODIR];
const TS_FALLBACK_EXECUTABLE = "deno";

/** Resolves a binding path. A relative path is relative to the harness work tree. */
export function resolveBindingPath(path: string): string {
  return isAbsolute(path) ? path : resolve(join(SANDBOX_TREE_ROOT, path));
}

/** Builds the bubblewrap arguments, without the command to run. */
export function buildBwrapArgs(binding: ICandidateBinding, copyDir: string, homeDir: string): string[] {
  const args = [
    ...BASE_MOUNTS,
    "--bind",
    resolve(copyDir),
    SANDBOX_COPY_ROOT,
    "--bind",
    resolve(homeDir),
    SANDBOX_HOME,
  ];

  for (const executable of binding.executables) {
    args.push("--ro-bind", resolveBindingPath(executable.sourcePath), `${SANDBOX_BIN}/${executable.name}`);
  }
  for (const companion of binding.companions) {
    args.push("--ro-bind", resolveBindingPath(companion.path), `${SANDBOX_LIB}/${basename(companion.path)}`);
  }
  for (const tree of binding.trees) {
    args.push(tree.writable ? "--bind" : "--ro-bind", resolveBindingPath(tree.sourcePath), tree.mountPath);
  }

  args.push(...ISOLATION_FLAGS);
  for (const [name, value] of Object.entries(binding.env)) {
    args.push("--setenv", name, value);
  }
  args.push("--chdir", SANDBOX_COPY_ROOT);
  return args;
}

/** Throws when a Go binding could reach a TS executable, runtime, source tree or recorded binary. */
export function assertBindingAllowed(binding: ICandidateBinding, tsHashes: ReadonlySet<string>): void {
  if (binding.kind !== CandidateKind.GO_STANDALONE) return;
  const refuse = (reason: string): never => {
    throw new Error(`go-standalone binding ${binding.label} is refused: ${reason}`);
  };

  if (binding.executables.some((executable) => executable.name === TS_FALLBACK_EXECUTABLE)) {
    refuse("it declares a deno executable");
  }
  for (const tree of binding.trees) {
    if (TS_FALLBACK_MOUNTS.includes(tree.mountPath)) refuse(`it mounts ${tree.mountPath}`);
  }
  for (const name of TS_FALLBACK_ENV_NAMES) {
    if (name in binding.env) refuse(`it sets ${name}`);
  }
  for (const companion of binding.companions) {
    if (TS_FALLBACK_ENV_NAMES.includes(companion.envVar)) refuse(`it declares a companion for ${companion.envVar}`);
  }
  for (const executable of binding.executables) {
    if (tsHashes.has(executable.sha256)) refuse(`${executable.name} matches a recorded TS binary`);
  }
}

function decodeOutput(bytes: Uint8Array): { text: string; encoding: OutputEncoding } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: OutputEncoding.UTF8 };
  } catch {
    return { text: encodeBase64(bytes), encoding: OutputEncoding.BASE64 };
  }
}

/** Runs one command inside the sandbox and returns when the process exits. */
export async function runInSandbox(bwrapArgs: string[], argv: string[]): Promise<ICommandObservation> {
  const output = await new Deno.Command(BWRAP_COMMAND, {
    args: [...bwrapArgs, "--", ...argv],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = decodeOutput(output.stdout);
  const stderr = decodeOutput(output.stderr);
  return {
    argv,
    exitCode: output.code,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutEncoding: stdout.encoding,
    stderrEncoding: stderr.encoding,
  };
}

/** True when the command can start a minimal bubblewrap sandbox on this host. */
export async function probeBwrap(command: string = BWRAP_COMMAND): Promise<boolean> {
  try {
    const output = await new Deno.Command(command, {
      args: [...BASE_MOUNTS, "--unshare-net", "--", PROBE_COMMAND],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    return output.success;
  } catch {
    return false;
  }
}

/** Sandbox tests declare `ignore: !BWRAP_USABLE`, so Deno reports them as ignored and never as passed. */
export const BWRAP_USABLE = await probeBwrap();
