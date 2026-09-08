/**
 * @module ScenarioFrameworkCalibrationSandbox
 * @path tests/scenario_framework/runner/calibration_sandbox.ts
 * @description Phase 146 Step 1's isolated reference-evaluator execution profile: runs
 *   `claude`/`codex` inside a `bwrap` (bubblewrap) sandbox with a fully masked $HOME —
 *   no repo, no Workspace, no other conversation history/credentials are visible — with
 *   only the CLI's own installed binary and its one auth file punched back in read-only
 *   at their real paths. Linux-only; fails closed (throws) before any paid call when
 *   bwrap or the requested CLI's runtime is unavailable. Network stays reachable (the
 *   model call itself needs it); no MCP, no tools, no session persistence, no resume.
 * @architectural-layer Test
 * @related-files [tests/security/calibration_sandbox_test.ts, tests/scenario_framework/runner/calibration_reference.ts, tests/scenario_framework/runner/calibration_runner.ts, packages/core/src/helpers/subprocess.ts, packages/core/src/helpers/child_env.ts]
 */

import { buildAllowlistChildEnv, SafeSubprocess } from "@exaix/core";
import type { ICalibrationRubric } from "@exaix/eval-history";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import { buildReferencePrompt, parseReferenceResponse } from "./calibration_reference.ts";
import type {
  ICalibrationReferenceAdapter,
  ICalibrationVendorTarget,
  IJudgeScoreResult,
} from "./calibration_runner.ts";
import type { ICalibrationSourceItem } from "./calibration_sources.ts";

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

export class CalibrationSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationSandboxError";
  }
}

const DEFAULT_SANDBOX_TIMEOUT_MS = 300_000;
const BWRAP_BIN = "bwrap";

interface ICliRuntimeProfile {
  readonly binary: string;
  readonly sessionTool: SessionTool;
  runtimeDirs(home: string): string[];
  authFiles(home: string): string[];
  buildArgs(prompt: string, model: string): string[];
}

const CLI_PROFILES: Readonly<Record<CalibrationSandboxCli, ICliRuntimeProfile>> = {
  [CalibrationSandboxCli.Claude]: {
    binary: "claude",
    sessionTool: "claude-code",
    runtimeDirs: (home) => [`${home}/.local/bin`, `${home}/.local/share/claude`],
    authFiles: (home) => [`${home}/.claude/.credentials.json`],
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
    runtimeDirs: (home) => [`${home}/.local/bin`, `${home}/.codex/packages`],
    authFiles: (home) => [`${home}/.codex/auth.json`],
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

function buildBwrapArgs(
  options: { home: string; scratchDir: string; runtimeDirs: string[]; authFiles: string[] },
): string[] {
  const args = [
    "--ro-bind",
    "/",
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
  for (const dir of options.runtimeDirs) {
    args.push("--ro-bind", dir, dir);
  }
  for (const file of options.authFiles) {
    args.push("--ro-bind", file, file);
  }
  args.push("--chdir", options.scratchDir, "--unshare-pid", "--die-with-parent");
  return args;
}

/** Runs `command` inside the same masked-$HOME sandbox a reference CLI call uses — the
 *  seam {@link runSandboxedCliCall} and the capability-preflight security tests share, so
 *  a test can assert containment (e.g. `cat` on a forbidden path) without a live model call. */
export async function runSandboxed(
  command: string,
  args: string[],
  scratchRoot: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = requireHome();
  const scratchDir = await Deno.makeTempDir({ dir: scratchRoot, prefix: "calib-sandbox-" });
  try {
    const bwrapArgs = buildBwrapArgs({ home, scratchDir, runtimeDirs: [], authFiles: [] });
    const env = buildAllowlistChildEnv({}, Deno.env.toObject());
    return await runProcessNoStdin(BWRAP_BIN, [...bwrapArgs, "--", command, ...args], {
      env,
      cwd: scratchDir,
      timeoutMs: 30_000,
    });
  } finally {
    await Deno.remove(scratchDir, { recursive: true });
  }
}

/** Runs one reference-evaluator prompt inside the isolated profile for `options.cli`.
 *  Fails closed via {@link assertSandboxSupported} before any paid call — never falls
 *  back to an unsandboxed call on unsupported platforms or a missing bwrap/runtime. */
export async function runSandboxedCliCall(options: ISandboxedCliCallOptions): Promise<ISandboxedCliCallResult> {
  await assertSandboxSupported();
  const home = requireHome();
  const profile = CLI_PROFILES[options.cli];

  const scratchDir = await Deno.makeTempDir({ dir: options.scratchRoot, prefix: "calib-sandbox-" });
  try {
    const bwrapArgs = buildBwrapArgs({
      home,
      scratchDir,
      runtimeDirs: profile.runtimeDirs(home),
      authFiles: profile.authFiles(home),
    });
    const cliArgs = profile.buildArgs(options.prompt, options.model);
    const env = buildAllowlistChildEnv({}, Deno.env.toObject());

    const result = await runProcessNoStdin(BWRAP_BIN, [...bwrapArgs, "--", profile.binary, ...cliArgs], {
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

function resolveSandboxCli(provider: string): CalibrationSandboxCli {
  if (provider === "claude-cli") return CalibrationSandboxCli.Claude;
  if (provider === "codex-cli") return CalibrationSandboxCli.Codex;
  throw new CalibrationSandboxError(`no sandbox profile for provider "${provider}" (expected claude-cli or codex-cli)`);
}

// This module builds the CLI argv directly (no ModelResolver), so a "provider:model"
// intent string must have its prefix stripped — codex/claude reject the compound form.
function stripProviderPrefix(model: string): string {
  const separatorIndex = model.indexOf(":");
  return separatorIndex === -1 ? model : model.slice(separatorIndex + 1);
}

/** The isolated (bwrap-sandboxed) counterpart to LocalCalibrationReferenceAdapter — same
 *  prompt/scoring semantics, but the live call runs inside the masked-$HOME profile.
 *  `CalibrationRunner` is unaware which reference adapter it was given. */
export class SandboxedCalibrationReferenceAdapter implements ICalibrationReferenceAdapter {
  constructor(private readonly scratchRoot: string) {}

  async score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult> {
    const { prompt } = buildReferencePrompt(item.snapshot.request_context, item.snapshot.artifact, rubric.preset);
    const cli = resolveSandboxCli(target.provider);

    const result = await runSandboxedCliCall({
      cli,
      model: stripProviderPrefix(target.model),
      prompt,
      scratchRoot: this.scratchRoot,
    });

    const { score } = parseReferenceResponse(result.stdout, rubric.preset, rubric.label_threshold);
    return { score, provider: target.provider, model: target.model };
  }
}
