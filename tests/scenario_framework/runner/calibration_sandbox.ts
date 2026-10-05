/**
 * @module ScenarioFrameworkCalibrationSandbox
 * @path tests/scenario_framework/runner/calibration_sandbox.ts
 * @description Phase 146 Step 1's isolated CLI execution profile: runs `claude`/`codex`
 *   inside a `bwrap` (bubblewrap) sandbox that starts from an empty root (`--tmpfs /`)
 *   and mounts only a recorded allowlist — the resolved CLI binary and its dynamic
 *   libraries, the host DNS/TLS runtime files, and the one read-only subscription auth
 *   file. `$HOME` is a private tmpfs, so the repository, Workspace, other conversation
 *   history, credentials and host files are all invisible. Linux-only; fails closed
 *   (throws) before any paid call when bwrap or the requested CLI's runtime is
 *   unavailable. Network stays reachable (the model call itself needs it); no MCP, no
 *   tools, no session persistence, no resume.
 * @architectural-layer Test
 * @related-files [tests/security/calibration_sandbox_test.ts, tests/scenario_framework/runner/calibration_reference.ts, tests/scenario_framework/runner/judge_profile_evaluator.ts, packages/core/src/helpers/subprocess.ts, packages/core/src/helpers/child_env.ts]
 */

import { join } from "@std/path";
import { buildAllowlistChildEnv, SafeSubprocess } from "@exaix/core";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";

export enum CalibrationSandboxCli {
  Claude = "claude",
  Codex = "codex",
}

export interface ISandboxedCliCallOptions {
  readonly cli: CalibrationSandboxCli;
  readonly model: string;
  readonly prompt: string;
  readonly scratchRoot: string;
  readonly timeoutMs?: number;
}

export interface ISandboxedCliCallResult {
  readonly stdout: string;
  readonly cli: CalibrationSandboxCli;
  readonly model: string;
}

/** One allowlisted host file mounted read-only, with the digest that identifies it. */
export interface IRuntimeFileRecord {
  readonly path: string;
  readonly sha256: string;
}

export interface ICliRuntimeManifest {
  readonly cli: CalibrationSandboxCli;
  readonly binary: string;
  readonly files: readonly IRuntimeFileRecord[];
  readonly authFile: string;
}

export class CalibrationSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationSandboxError";
  }
}

const DEFAULT_SANDBOX_TIMEOUT_MS = 300_000;
const BWRAP_BIN = "bwrap";

/** Host DNS/TLS runtime files a networked CLI needs inside an otherwise empty root.
 *  They carry no user data. Every other host path stays invisible. */
const HOST_RUNTIME_FILES: readonly string[] = [
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/ssl/certs",
  "/etc/ca-certificates.conf",
  "/etc/ssl/openssl.cnf",
];

interface ICliRuntimeProfile {
  readonly binary: string;
  readonly sessionTool: SessionTool;
  authFile(home: string): string;
  buildArgs(prompt: string, model: string): string[];
}

const CLI_PROFILES: Readonly<Record<CalibrationSandboxCli, ICliRuntimeProfile>> = {
  [CalibrationSandboxCli.Claude]: {
    binary: "claude",
    sessionTool: "claude-code",
    authFile: (home) => `${home}/.claude/.credentials.json`,
    buildArgs: (prompt, model) => [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      model,
      "--tools",
      "",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--strict-mcp-config",
    ],
  },
  [CalibrationSandboxCli.Codex]: {
    binary: "codex",
    sessionTool: "codex",
    authFile: (home) => `${home}/.codex/auth.json`,
    buildArgs: (prompt, model) => [
      "exec",
      "--json",
      "--model",
      model,
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      prompt,
    ],
  },
};

function requireHome(): string {
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new CalibrationSandboxError("HOME is not set — the sandbox cannot locate the CLI's auth/runtime files");
  }
  return home;
}

/** Throws before any call is attempted if this environment cannot run the isolation
 *  profile at all: non-Linux, or `bwrap` missing from PATH. */
export async function assertSandboxSupported(): Promise<void> {
  if (Deno.build.os !== "linux") {
    throw new CalibrationSandboxError(
      `Calibration reference isolation requires Linux (bwrap); this environment is "${Deno.build.os}"`,
    );
  }
  try {
    const result = await SafeSubprocess.run(BWRAP_BIN, ["--version"], { timeoutMs: 10_000 });
    if (result.code !== 0) {
      throw new CalibrationSandboxError(`bwrap --version exited with code ${result.code}: ${result.stderr}`);
    }
  } catch (error) {
    throw new CalibrationSandboxError(`bwrap is not available: ${(error as Error).message}`);
  }
}

async function whichOnPath(name: string): Promise<string | undefined> {
  const path = Deno.env.get("PATH") ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) return candidate;
    } catch {
      // Not in this PATH entry; keep searching.
    }
  }
  return undefined;
}

/** Resolves an executable to its canonical real path and requires a regular file. */
async function resolveExecutable(name: string): Promise<string> {
  const located = name.includes("/") ? name : await whichOnPath(name);
  if (!located) throw new CalibrationSandboxError(`executable "${name}" is not on PATH`);
  const resolved = await Deno.realPath(located);
  const info = await Deno.lstat(resolved);
  if (!info.isFile) throw new CalibrationSandboxError(`executable "${name}" is not a regular file`);
  return resolved;
}

/** Dynamic libraries an ELF binary needs. Empty for a static binary or a missing ldd. */
async function listSharedLibraries(binary: string): Promise<string[]> {
  let output: string;
  try {
    const result = await SafeSubprocess.run("ldd", [binary], { timeoutMs: 10_000 });
    if (result.code !== 0) return [];
    output = result.stdout;
  } catch {
    return [];
  }
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const arrow = line.match(/=>\s+(\/\S+)/);
    const direct = line.trim().match(/^(\/\S+)\s+\(0x/);
    const found = arrow?.[1] ?? direct?.[1];
    if (found) paths.add(found);
  }
  return [...paths].sort();
}

async function sha256File(path: string): Promise<string> {
  const data = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordFile(path: string): Promise<IRuntimeFileRecord> {
  return { path, sha256: await sha256File(path) };
}

async function resolveAuthFile(cli: CalibrationSandboxCli, home: string): Promise<string> {
  const requested = CLI_PROFILES[cli].authFile(home);
  try {
    const resolved = await Deno.realPath(requested);
    const info = await Deno.lstat(resolved);
    if (!info.isFile) throw new CalibrationSandboxError(`CLI auth path is not a regular file: ${requested}`);
    return resolved;
  } catch (error) {
    if (error instanceof CalibrationSandboxError) throw error;
    throw new CalibrationSandboxError(`CLI auth file is unavailable: ${requested}`);
  }
}

/** Resolves the binary, its libraries and the auth file into a hashed allowlist. */
export async function resolveCliRuntimeManifest(cli: CalibrationSandboxCli): Promise<ICliRuntimeManifest> {
  const home = requireHome();
  const binary = await resolveExecutable(CLI_PROFILES[cli].binary);
  const files = [binary, ...await listSharedLibraries(binary)];
  return {
    cli,
    binary,
    files: await Promise.all(files.map(recordFile)),
    authFile: await resolveAuthFile(cli, home),
  };
}

async function hostFileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function buildBwrapArgs(
  options: { home: string; scratchDir: string; files: readonly string[]; authFile?: string },
): Promise<string[]> {
  const args = [
    "--tmpfs",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    options.scratchDir,
    options.scratchDir,
    "--tmpfs",
    options.home,
  ];
  for (const file of options.files) args.push("--ro-bind", file, file);
  for (const file of HOST_RUNTIME_FILES) {
    if (await hostFileExists(file)) args.push("--ro-bind", file, file);
  }
  if (options.authFile) args.push("--ro-bind", options.authFile, options.authFile);
  args.push("--chdir", options.scratchDir, "--unshare-pid", "--die-with-parent");
  return args;
}

// codex exec blocks/misbehaves under SafeSubprocess's inherited stdin (which never sees
// EOF from a `deno test` process); SafeSubprocess has no stdin option, so this spawns
// directly with an explicit stdin: "null" and the same timeout pattern.
async function runProcessNoStdin(
  command: string,
  args: string[],
  options: { env: Record<string, string>; cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(command, {
    args,
    cwd: options.cwd,
    env: options.env,
    clearEnv: true,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  try {
    const result = await cmd.output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new CalibrationSandboxError(`sandboxed ${command} timed out after ${options.timeoutMs}ms`);
    }
    throw new CalibrationSandboxError(`sandboxed ${command} failed to run: ${(error as Error).message}`);
  }
}

/** Runs `command` inside the empty-root sandbox the CLI launcher uses.
 *  This is the seam the capability-preflight security tests share.
 *  A test can assert containment (for example `cat` on a forbidden path) without a live call. */
export async function runSandboxed(
  command: string,
  args: string[],
  scratchRoot: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = requireHome();
  const binary = await resolveExecutable(command);
  const files = [binary, ...await listSharedLibraries(binary)];
  const scratchDir = await Deno.makeTempDir({ dir: scratchRoot, prefix: "calib-sandbox-" });
  try {
    const bwrapArgs = await buildBwrapArgs({ home, scratchDir, files });
    const env = buildAllowlistChildEnv({}, Deno.env.toObject());
    return await runProcessNoStdin(BWRAP_BIN, [...bwrapArgs, "--", binary, ...args], {
      env,
      cwd: scratchDir,
      timeoutMs: 30_000,
    });
  } finally {
    await Deno.remove(scratchDir, { recursive: true });
  }
}

/** Runs one evaluator prompt inside the isolated profile for `options.cli`.
 *  Fails closed via {@link assertSandboxSupported} before any paid call — never falls
 *  back to an unsandboxed call on unsupported platforms or a missing bwrap/runtime. */
export async function runSandboxedCliCall(options: ISandboxedCliCallOptions): Promise<ISandboxedCliCallResult> {
  await assertSandboxSupported();
  const home = requireHome();
  const profile = CLI_PROFILES[options.cli];
  const manifest = await resolveCliRuntimeManifest(options.cli);

  const scratchDir = await Deno.makeTempDir({ dir: options.scratchRoot, prefix: "calib-sandbox-" });
  try {
    const bwrapArgs = await buildBwrapArgs({
      home,
      scratchDir,
      files: manifest.files.map((record) => record.path),
      authFile: manifest.authFile,
    });
    const cliArgs = profile.buildArgs(options.prompt, options.model);
    const env = buildAllowlistChildEnv({}, Deno.env.toObject());

    const result = await runProcessNoStdin(BWRAP_BIN, [...bwrapArgs, "--", manifest.binary, ...cliArgs], {
      env,
      cwd: scratchDir,
      timeoutMs: options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      // Codex/claude often report the real failure as a JSON error event on stdout
      // (e.g. an unsupported model) while stderr carries only a generic status line —
      // include both so the actual cause is never hidden behind "Reading stdin...".
      throw new CalibrationSandboxError(
        `sandboxed ${options.cli} exited with code ${result.code}: stderr=${result.stderr.trim() || "(empty)"} stdout=${
          result.stdout.trim().slice(0, 1000) || "(empty)"
        }`,
      );
    }
    const parsed = parseDelegateStdout(result.stdout, profile.sessionTool);
    if (!parsed.lastText) {
      throw new CalibrationSandboxError(`sandboxed ${options.cli} produced no parseable response text`);
    }
    return { stdout: parsed.lastText, cli: options.cli, model: options.model };
  } finally {
    await Deno.remove(scratchDir, { recursive: true });
  }
}

/** Maps a calibration transport adapter to its sandbox profile. */
export function resolveSandboxCli(provider: string): CalibrationSandboxCli {
  if (provider === "claude-cli") return CalibrationSandboxCli.Claude;
  if (provider === "codex-cli") return CalibrationSandboxCli.Codex;
  throw new CalibrationSandboxError(`no sandbox profile for provider "${provider}" (expected claude-cli or codex-cli)`);
}

// This module builds the CLI argv directly (no ModelResolver), so a "provider:model"
// intent string must have its prefix stripped — codex/claude reject the compound form.
export function stripProviderPrefix(model: string): string {
  const separatorIndex = model.indexOf(":");
  return separatorIndex === -1 ? model : model.slice(separatorIndex + 1);
}
