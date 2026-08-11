#!/usr/bin/env -S deno run -A
/**
 * @module IngestTerminalBench
 * @path scripts/ingest_terminal_bench.ts
 * @description Converts a pinned Terminal-Bench task (upstream task.yaml + solution.sh +
 *   environment files) into a Phase 141 task-contract directory (TASK.md/task.json/
 *   reference.patch) plus a vendored portal under fixtures/portals/external/terminal_bench/.
 *   License-eligibility gated (GAP-10): a task whose license does not match
 *   LICENSE_ALLOWLIST is skipped, not vendored — never aborting a batch run. The task-id
 *   is sanitized via PathSecurity.normalizePath before use as a directory segment (GAP-3).
 *   The oracle solution is applied dockerlessly by rewriting its hardcoded `/app` working
 *   directory to the real temp working directory (Step 1 has no container; Step 2 will run
 *   the unmodified upstream script inside the real container).
 *   Usage:
 *     deno run -A scripts/ingest_terminal_bench.ts --source <dir> --task-id <id>
 *       --benchmark-version <sha> --license <root-license-path>
 *       [--out-fixtures <dir>] [--out-portals <dir>]
 *     deno run -A scripts/ingest_terminal_bench.ts --batch <upstream-release-root>
 *       --benchmark-version <sha> --license <root-license-path> [--out-fixtures <dir>]
 *       [--out-portals <dir>] [--out-scenarios <dir>] [--out-requests <dir>]  (Phase 144 Step 3)
 * @related-files [tests/scenario_framework/schema/task_schema.ts, tests/scenario_framework/runner/scenario_templates.ts, tests/scripts/ingest_terminal_bench_test.ts, tests/scripts/license_eligibility_test.ts, tests/scripts/classifier_test.ts, tests/scripts/manifest_integrity_test.ts]
 */

import { z } from "zod";
import { parse as parseYaml } from "@std/yaml";
import { copy, walk } from "@std/fs";
import { join, resolve } from "@std/path";
import { PathSecurity } from "@exaix/tool-runtime";
import type { Opt, Reason } from "@exaix/core/types";
import { type ITaskJson, TaskJsonSchema } from "../tests/scenario_framework/schema/task_schema.ts";
import { renderExternalBenchTaskTemplate } from "../tests/scenario_framework/runner/scenario_templates.ts";

/** The 5 permissive, redistribution-safe licenses accepted for vendoring external benchmark content (GAP-10). */
export type LicenseIdentifier = "MIT" | "Apache-2.0" | "BSD-2-Clause" | "BSD-3-Clause" | "ISC";

export interface ILicenseEligibility {
  eligible: boolean;
  matched: LicenseIdentifier | null;
  reason?: string;
}

export interface IIngestOptions {
  sourceDir: string;
  taskId: string;
  benchmarkVersion: string;
  rootLicenseText: string;
  outFixturesDir: string;
  outPortalsDir: string;
  /** Bounds a single oracle solution.sh run — batch ingest must never let one hung or
   *  pathologically slow upstream task block the whole release (Phase 144 Step 5).
   *  Defaults to `DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS`. */
  oracleSolutionTimeoutMs?: Opt<number, Reason.SensibleDefault>;
}

export interface IIngestResult {
  taskId: string;
  contractDir: string;
  portalDir: string;
  baseRef: string;
  eligibility: ILicenseEligibility;
  skipped: boolean;
  reason?: string;
}

/** Reasons classifyTerminalBenchTask can disqualify a task from the supported subset
 *  (Phase 144 Step 3's classifier table: `supported` = file-oriented, solvable/verifiable
 *  by editing/creating files in the working dir; everything else is `unsupported`).
 *  Every branch is a structural or content signal the bind-mount + single `docker run`
 *  substrate (GAP-1) cannot faithfully represent. */
export type UnsupportedReason =
  | "multi-container"
  | "custom-network-config"
  | "privileged-or-device-access"
  | "gpu-required"
  | "requires-live-service"
  | "requires-interactive-terminal"
  | "ambiguous-environment"
  | "ingest-error";

export interface IClassifierInput {
  /** Raw docker-compose.yaml text from the upstream task dir. */
  dockerComposeText: string;
  /** Raw Dockerfile text from the upstream task dir. */
  dockerfileText: string;
  /** Concatenated content of every file under the upstream task's tests/ dir. */
  testScriptsText: string;
}

export interface IClassificationResult {
  supported: boolean;
  reason?: UnsupportedReason;
}

/** A batch-ingested task's final disposition in the coverage manifest. */
export type TaskClass = "supported" | "unsupported" | "license-ineligible";
/** Docker-gated controls-sweep outcome (Step 3 Actions); ingest itself never runs docker,
 *  so every freshly-ingested task starts "pending" until the separate sweep updates it. */
export type ControlsStatus = "pending" | "pass" | "fail" | "docker-unavailable";

/** One task's classification/ingestion outcome inside a batch manifest. */
export interface IManifestTaskEntry {
  task_id: string;
  class: TaskClass;
  reason?: string;
  controls_status: ControlsStatus;
}

/** Published per-release coverage manifest (Phase 144 Step 3). */
export interface IManifest {
  generated_at: string;
  benchmark_version: string;
  total_tasks: number;
  supported_count: number;
  coverage_pct: number;
  tasks: IManifestTaskEntry[];
}

export interface IBatchIngestOptions {
  /** Directory containing one subdirectory per upstream task. */
  upstreamRoot: string;
  benchmarkVersion: string;
  rootLicenseText: string;
  outFixturesDir: string;
  outPortalsDir: string;
  /** Where generated `<task-id>.yaml` scenarios are written (external_terminal_bench pack). */
  outScenariosDir: string;
  /** Where generated `<task-id>.md` request fixtures are written. */
  outRequestsDir: string;
  /** Bounds each task's oracle solution.sh run — see IIngestOptions. Defaults to
   *  `DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS`. */
  oracleSolutionTimeoutMs?: Opt<number, Reason.SensibleDefault>;
  /** Delegate tool baked into every generated scenario's bare-delegate step (a
   *  BARE_DELEGATE_LAUNCH_SHAPES key). Defaults to `DEFAULT_SCENARIO_TOOL`. */
  scenarioTool?: Opt<string, Reason.SensibleDefault>;
}

interface ICliArgs {
  source?: string;
  taskId?: string;
  batch?: string;
  benchmarkVersion: string;
  license: string;
  outFixtures: string;
  outPortals: string;
  outScenarios: string;
  outRequests: string;
}

/** Canonical order of LICENSE_ALLOWLIST — GAP-10's fixed permissive allowlist. */
export const LICENSE_ALLOWLIST: readonly LicenseIdentifier[] = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
];

/** Deterministic substring signatures identifying each allowlisted license's canonical opening text. */
const LICENSE_SIGNATURES: Record<LicenseIdentifier, string> = {
  "MIT": "MIT License",
  "Apache-2.0": "Apache License",
  "BSD-2-Clause": "BSD 2-Clause",
  "BSD-3-Clause": "BSD 3-Clause",
  "ISC": "ISC License",
};

/** Deterministic substring match of a license text's canonical opening signature (GAP-10 matcher). */
export function matchLicense(licenseText: string): LicenseIdentifier | null {
  for (const identifier of LICENSE_ALLOWLIST) {
    if (licenseText.includes(LICENSE_SIGNATURES[identifier])) return identifier;
  }
  return null;
}

/**
 * Checks the repo-root license plus an optional task-local override (GAP-10 abort/skip
 * semantics). Both must match the allowlist for a task to be eligible.
 */
export function checkLicenseEligibility(
  rootLicenseText: string,
  taskLocalLicenseText: Opt<string, Reason.OptionalInput>,
): ILicenseEligibility {
  const rootMatch = matchLicense(rootLicenseText);
  if (!rootMatch) {
    return { eligible: false, matched: null, reason: "root license does not match LICENSE_ALLOWLIST" };
  }
  if (taskLocalLicenseText !== undefined) {
    const localMatch = matchLicense(taskLocalLicenseText);
    if (!localMatch) {
      return {
        eligible: false,
        matched: null,
        reason: "task-local license does not match LICENSE_ALLOWLIST",
      };
    }
  }
  return { eligible: true, matched: rootMatch };
}

/** Permissive compose-service schema — only the fields the classifier inspects are typed;
 *  every other real docker-compose field (image, build, volumes, environment, command, …)
 *  is stripped by zod's default unknown-key behavior, matching `UpstreamTaskYamlSchema`. */
const ComposeServiceSchema = z.object({
  dns: z.unknown().optional(),
  extra_hosts: z.unknown().optional(),
  networks: z.unknown().optional(),
  privileged: z.boolean().optional(),
  cap_add: z.unknown().optional(),
  devices: z.unknown().optional(),
});
const ComposeSchema = z.object({
  services: z.record(z.string(), ComposeServiceSchema).optional(),
});

/** Test-script content signals a live network probe (HTTP client, raw socket, curl to a host). */
const LIVE_SERVICE_PATTERN =
  /\brequests\.(get|post|put|delete|patch)\(|urllib\.request|socket\.(socket|create_connection)|https?:\/\/(localhost|127\.0\.0\.1)|curl\s+https?:\/\//i;
/** Test-script content signals interactive-terminal control (the bind-mount jail has no TTY/pty). */
const INTERACTIVE_TERMINAL_PATTERN = /\btmux\b|\bpexpect\b|\bpty\.(spawn|openpty)|\bpyte\.|send_keys\(/i;
/** Dockerfile content signals a GPU/CUDA base image or runtime requirement. */
const GPU_PATTERN = /\bnvidia\b|\bcuda\b/i;

/**
 * Classifies an upstream Terminal-Bench task as `supported` (runs faithfully inside the
 * bind-mount single-container substrate) or `unsupported` with a machine-readable reason
 * (Phase 144 Step 3). Conservative: any ambiguous or unparseable signal is `unsupported`,
 * never silently defaulted to `supported` — matching the plan's classifier disposition
 * table ("ambiguous ⇒ unsupported with reason recorded").
 */
export function classifyTerminalBenchTask(input: IClassifierInput): IClassificationResult {
  let compose: z.infer<typeof ComposeSchema>;
  try {
    compose = ComposeSchema.parse(parseYaml(input.dockerComposeText) ?? {});
  } catch {
    return { supported: false, reason: "ambiguous-environment" };
  }
  const serviceNames = Object.keys(compose.services ?? {});
  if (serviceNames.length !== 1) {
    return {
      supported: false,
      reason: serviceNames.length > 1 ? "multi-container" : "ambiguous-environment",
    };
  }
  const service = compose.services![serviceNames[0]];
  if (service.dns !== undefined || service.extra_hosts !== undefined || service.networks !== undefined) {
    return { supported: false, reason: "custom-network-config" };
  }
  if (service.privileged === true || service.cap_add !== undefined || service.devices !== undefined) {
    return { supported: false, reason: "privileged-or-device-access" };
  }
  if (GPU_PATTERN.test(input.dockerfileText)) {
    return { supported: false, reason: "gpu-required" };
  }
  if (LIVE_SERVICE_PATTERN.test(input.testScriptsText)) {
    return { supported: false, reason: "requires-live-service" };
  }
  if (INTERACTIVE_TERMINAL_PATTERN.test(input.testScriptsText)) {
    return { supported: false, reason: "requires-interactive-terminal" };
  }
  return { supported: true };
}

const DIFFICULTY_MAP: Record<string, ITaskJson["difficulty"]> = {
  "easy": "S",
  "medium": "M",
  "hard": "M",
};

/** Maps a Terminal-Bench difficulty rating onto Phase 141's S/M scale (M absorbs "hard"). */
export function mapDifficulty(upstreamDifficulty: string): ITaskJson["difficulty"] {
  const mapped = DIFFICULTY_MAP[upstreamDifficulty.toLowerCase()];
  if (!mapped) {
    throw new Error(`Unknown upstream difficulty: ${upstreamDifficulty}`);
  }
  return mapped;
}

const UpstreamTaskYamlSchema = z.object({
  instruction: z.string().min(1),
  difficulty: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
});

export type IUpstreamTaskMeta = z.infer<typeof UpstreamTaskYamlSchema>;

export function parseUpstreamTaskYaml(yamlText: string): IUpstreamTaskMeta {
  return UpstreamTaskYamlSchema.parse(parseYaml(yamlText));
}

/** Benchmark scaffold entries that are never copied into the vendored portal's initial state. */
const BENCHMARK_SCAFFOLD_ENTRIES: Record<string, true> = {
  "task.yaml": true,
  "Dockerfile": true,
  "docker-compose.yaml": true,
  "solution.sh": true,
  "run-tests.sh": true,
  "tests": true,
  "task-deps": true,
  "LICENSE": true,
  "NOTICE": true,
};

const SYNTHETIC_COMMIT_DATE = "2020-01-01T00:00:00Z";
const SYNTHETIC_COMMIT_AUTHOR_NAME = "external-bench-ingest";
const SYNTHETIC_COMMIT_AUTHOR_EMAIL = "external-bench-ingest@exaix.dev";
const CONTAINER_WORKDIR = "/app";
const DEFAULT_OUT_FIXTURES_DIR = "tests/scenario_framework/fixtures/external/terminal_bench";
const DEFAULT_OUT_PORTALS_DIR = "tests/scenario_framework/fixtures/portals/external/terminal_bench";
const DEFAULT_OUT_SCENARIOS_DIR = "tests/scenario_framework/scenarios/external_terminal_bench";
const DEFAULT_OUT_REQUESTS_DIR = "tests/scenario_framework/fixtures/requests/external/terminal_bench";
/** Delegate tool used to render batch-generated scenarios (Phase 143's BARE_DELEGATE_LAUNCH_SHAPES key). */
const DEFAULT_SCENARIO_TOOL = "claude-code";
/** Minimum supported-subset coverage (Risks R4): below this, reassess the subset choice
 *  before spending on a live run — declared locally per this module's own convention
 *  (no shared "framework evaluation constants" file exists, matching
 *  DEFAULT_BARE_DELEGATE_TIMEOUT_SEC in scenario_templates.ts, GAP-9). */
export const MIN_SUPPORTED_COVERAGE_PCT = 30;
/** Default bound for a single oracle solution.sh run (Phase 144 Step 5) — a batch ingest
 *  must never let one hung or pathologically slow upstream task (e.g. a real kernel build)
 *  block the whole release; the task is simply recorded `ingest-error` and the batch continues. */
export const DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS = 180_000;
/** Cap on bytes retained from a continuously-drained oracle-solution stdout/stderr stream
 *  (Phase 144 post-gap remediation, GAP-4) — the pipe must be drained WHILE awaiting the
 *  child's exit (never only after) to avoid the OS pipe-buffer deadlock a verbose script can
 *  otherwise trigger; this bound stops a pathologically chatty script from growing the
 *  in-memory buffer unboundedly while still draining (and discarding) everything past it. */
export const MAX_DRAINED_STREAM_BYTES = 65_536;

async function runGit(
  args: string[],
  cwd: string,
  env?: Opt<Record<string, string>, Reason.OptionalContext>,
): Promise<string> {
  const command = new Deno.Command("git", { args, cwd, env, stdout: "piped", stderr: "piped" });
  const output = await command.output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

/**
 * Runs `git diff` and returns its RAW output with exactly one trailing newline appended only
 * if missing — never `.trim()`ed. `runGit`'s blanket `.trim()` is safe for plumbing output
 * (rev-parse, status) but corrupts a `--binary` diff: a binary hunk's "literal <n>" block is
 * terminated by a blank line, and `.trim()` strips exactly that trailing blank line when the
 * binary hunk is the diff's last line, producing a patch `git apply` rejects with "corrupt
 * binary patch" (found via a real controls-sweep run across the pinned Terminal-Bench release,
 * Phase 144 Step 5).
 */
async function runGitDiff(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
  const output = await command.output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  const raw = new TextDecoder().decode(output.stdout);
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}

/** Reads `reader` to EOF into an at-most-`capBytes` buffer, decoding what was kept — excess
 *  bytes past the cap are still read (so the pipe keeps draining) but discarded. Never rejects:
 *  a cancelled or errored reader resolves with whatever was accumulated so far, so a caller
 *  racing this against a kill/timeout never has to await a stream that might hang forever on
 *  an orphaned grandchild still holding the pipe open. */
async function drainCapped(reader: ReadableStreamDefaultReader<Uint8Array>, capBytes: number): Promise<string> {
  const kept: Uint8Array[] = [];
  let keptBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && keptBytes < capBytes) {
        const remaining = capBytes - keptBytes;
        const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
        kept.push(chunk);
        keptBytes += chunk.length;
      }
    }
  } catch {
    // Reader cancelled (timeout path) or the underlying stream errored — return what we have.
  }
  const merged = new Uint8Array(keptBytes);
  let offset = 0;
  for (const chunk of kept) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Applies the upstream oracle solution against a dockerless temp working directory.
 * The solution's hardcoded container WORKDIR (`/app`) is rewritten to the real temp
 * path first — Step 1 has no container to provide `/app`; Step 2 will run the
 * unmodified upstream script inside the real container.
 */
async function applyOracleSolutionDockerless(
  solutionPath: string,
  workDir: string,
  timeoutMs: number = DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS,
): Promise<void> {
  const originalScript = await Deno.readTextFile(solutionPath);
  const adaptedScript = originalScript.replaceAll(CONTAINER_WORKDIR, workDir);
  const adaptedPath = join(workDir, ".oracle-solution-dockerless.sh");
  await Deno.writeTextFile(adaptedPath, adaptedScript);
  const command = new Deno.Command("bash", { args: [adaptedPath], cwd: workDir, stdout: "piped", stderr: "piped" });
  const child = command.spawn();
  // GAP-4: drain stdout/stderr CONCURRENTLY with awaiting the child's exit, not only after —
  // otherwise a script writing more than the OS pipe buffer capacity (~64KiB) blocks on its
  // own write() with nothing reading the other end, deadlocking until the timeout kills it
  // (a false timeout on a verbose-but-correct solution).
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const stdoutPromise = drainCapped(stdoutReader, MAX_DRAINED_STREAM_BYTES);
  const stderrPromise = drainCapped(stderrReader, MAX_DRAINED_STREAM_BYTES);
  const timeoutHandle = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process already exited between the timer firing and the kill call — fine.
    }
  }, timeoutMs);
  // child.status resolves purely on the DIRECT child's exit — unlike child.output(), it never
  // waits for stdout/stderr pipe EOF. That distinction matters here: killing bash does not kill
  // any grandchild it forked (e.g. a `sleep`/build step the script started), and an orphaned
  // grandchild inheriting the piped stdout/stderr fds can hold the pipe open indefinitely —
  // output() would then block past the timeout for exactly as long as the orphan keeps running
  // (observed directly: a killed bash wrapping `sleep 30` still made output() wait the full 30s).
  let status: Deno.CommandStatus;
  try {
    status = await child.status;
  } finally {
    clearTimeout(timeoutHandle);
  }
  await Deno.remove(adaptedPath);
  const timedOut = status.signal === "SIGKILL";
  if (timedOut) {
    // An orphaned grandchild can still hold the pipe open past the killed direct child's
    // exit — cancel rather than await the drain, so it can never hang this function (matches
    // the prior cancel-not-read behavior for this path exactly).
    stdoutReader.cancel().catch(() => {});
    stderrReader.cancel().catch(() => {});
    throw new Error(`oracle solution timed out after ${timeoutMs}ms and was killed`);
  }
  const stderrText = await stderrPromise;
  await stdoutPromise;
  if (!status.success) {
    throw new Error(`oracle solution failed: ${stderrText}`);
  }
}

function humanizeTaskId(taskId: string): string {
  return taskId.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Reads a task-local LICENSE/NOTICE override if present in the upstream source dir. A real
 *  I/O error on a file that DOES exist (permission denied, an unreadable directory in its
 *  place, etc.) must never be silently treated as "no override present" — GAP-7: it fails
 *  closed and propagates, matching `readOptionalFile`'s already-correct pattern below. */
export async function readTaskLocalLicense(sourceDir: string): Promise<string | undefined> {
  for (const name of ["LICENSE", "NOTICE"]) {
    try {
      return await Deno.readTextFile(join(sourceDir, name));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return undefined;
}

/** Copies every non-scaffold entry of the upstream source dir into the destination (environment initial state). */
async function copyEnvironmentEntries(sourceDir: string, destDir: string): Promise<void> {
  for await (const entry of Deno.readDir(sourceDir)) {
    if (BENCHMARK_SCAFFOLD_ENTRIES[entry.name]) continue;
    await copy(join(sourceDir, entry.name), join(destDir, entry.name), { overwrite: true });
  }
}

/** The pinned uv release used to bootstrap pytest dockerlessly for verification (matches
 *  every observed upstream run-tests.sh's own pinned uv installer version). */
const UV_INSTALLER_VERSION = "0.7.13";
/** Fallback pip package spec when the upstream run-tests.sh names none explicitly. */
const DEFAULT_TEST_PACKAGES = "pytest==8.4.1";
/** Conservative PyPI package-spec allowlist (GAP-1): names, version operators/specifiers,
 *  extras brackets, and comma/space separators only — no shell metacharacters. `run-tests.sh`
 *  is upstream, externally-authored content; this is the last line of defense before its
 *  `uv pip install` argument is spliced into a shell command executed inside the jail. */
const PACKAGE_SPEC_PATTERN = /^[A-Za-z0-9_.\-\[\]<>=!, ]+$/;

/**
 * Derives a self-contained, dockerless-safe scoped_test_cmd from the upstream run-tests.sh:
 * every observed Terminal-Bench task's run-tests.sh installs uv + the task's pytest package
 * set, then runs `pytest $TEST_DIR/test_outputs.py`. The eval-jail image already ships
 * curl/python3 but not uv/pytest, so this derivation extracts ONLY the task-specific
 * `uv pip install` package list and rebuilds a minimal, non-root-safe bootstrap around it —
 * dropping the upstream script's `apt-get` lines (root-only; curl is already present) and
 * pointing at the hidden oracle-tests mount (/oracle_tests) instead of $TEST_DIR (an env var
 * Exaix's harness does not set).
 */
export function deriveScopedTestCmd(runTestsShText: string): string {
  // Normalize backslash-newline shell line continuations first so a single wrapped
  // `uv pip install` invocation reads as one logical line, then join every distinct
  // `uv pip install` invocation's package list (not just the first) — see GAP-1.
  const normalized = runTestsShText.replace(/\\\r?\n[ \t]*/g, " ");
  const pipInstallMatches = [...normalized.matchAll(/uv pip install\s+([^\n]+)/g)];
  const packages = (pipInstallMatches.length > 0
    ? pipInstallMatches.map((m) => m[1].trim()).join(" ")
    : DEFAULT_TEST_PACKAGES).replace(/\s+/g, " ");
  if (!PACKAGE_SPEC_PATTERN.test(packages)) {
    throw new Error(
      `deriveScopedTestCmd: rejected upstream package spec containing disallowed characters: ${packages}`,
    );
  }
  // Invoke uv by its full, known container path (`HOME=/tmp` is hardcoded onto every jailed
  // launch — see buildJailLaunch) rather than `export PATH="$HOME/.local/bin:$PATH"`: this
  // whole command is embedded as ONE persisted scenario-YAML args element, which passes
  // through the scenario framework's expandInString — a generic pass that substitutes any
  // `$HOME`/`$PATH`-shaped token with the HOST's own environment value, not the container's
  // runtime one, silently rewriting the uv bin path to a host path that doesn't exist inside
  // the container ("uv: command not found") — found via a real scenario-driven live run
  // (Phase 144 Step 5; the controls-sweep script bypasses expandInString, so it never hit
  // this). `. /tmp/.venv/bin/activate` still safely prepends the venv's own bin dir to PATH
  // via bash's OWN runtime variable expansion inside the container — never text baked in here.
  const uvBin = "/tmp/.local/bin/uv";
  return [
    `curl -LsSf https://astral.sh/uv/${UV_INSTALLER_VERSION}/install.sh | sh -s -- -q`,
    `${uvBin} venv /tmp/.venv -q`,
    `. /tmp/.venv/bin/activate`,
    `${uvBin} pip install -q ${packages}`,
    `cd ${CONTAINER_WORKDIR}`,
    `pytest /oracle_tests/test_outputs.py -rA`,
  ].join(" && ");
}

export async function ingestTerminalBenchTask(options: IIngestOptions): Promise<IIngestResult> {
  const sanitizedTaskId = PathSecurity.normalizePath(options.taskId);

  const taskLocalLicenseText = await readTaskLocalLicense(options.sourceDir);
  const eligibility = checkLicenseEligibility(options.rootLicenseText, taskLocalLicenseText);
  if (!eligibility.eligible) {
    return {
      taskId: sanitizedTaskId,
      contractDir: "",
      portalDir: "",
      baseRef: "",
      eligibility,
      skipped: true,
      reason: eligibility.reason,
    };
  }

  const upstreamYamlText = await Deno.readTextFile(join(options.sourceDir, "task.yaml"));
  const upstream = parseUpstreamTaskYaml(upstreamYamlText);

  const workDir = await Deno.makeTempDir({ prefix: "exaix-tb-ingest-" });
  try {
    await copyEnvironmentEntries(options.sourceDir, workDir);

    await runGit(["init", "-q"], workDir);
    await runGit(["add", "-A"], workDir);
    const gitEnv: Record<string, string> = {
      GIT_COMMITTER_DATE: SYNTHETIC_COMMIT_DATE,
      GIT_AUTHOR_DATE: SYNTHETIC_COMMIT_DATE,
    };
    await runGit(
      [
        "-c",
        `user.email=${SYNTHETIC_COMMIT_AUTHOR_EMAIL}`,
        "-c",
        `user.name=${SYNTHETIC_COMMIT_AUTHOR_NAME}`,
        "commit",
        "-q",
        "-m",
        `init ${sanitizedTaskId} fixture`,
        "--allow-empty",
      ],
      workDir,
      gitEnv,
    );
    const baseRef = await runGit(["rev-parse", "HEAD"], workDir);

    const solutionPath = resolve(join(options.sourceDir, "solution.sh"));
    await applyOracleSolutionDockerless(solutionPath, workDir, options.oracleSolutionTimeoutMs);
    await runGit(["add", "-A"], workDir);
    const referencePatch = await runGitDiff(["diff", "--cached", "--binary"], workDir);

    const contractDir = join(options.outFixturesDir, sanitizedTaskId);
    await Deno.mkdir(contractDir, { recursive: true });
    const title = humanizeTaskId(sanitizedTaskId);
    const instructionLines = upstream.instruction.trim().split("\n").map((line) => line.replace(/[ \t]+$/, ""));
    await Deno.writeTextFile(join(contractDir, "TASK.md"), `# ${title}\n\n${instructionLines.join("\n")}\n`);

    const runTestsShText = await Deno.readTextFile(join(options.sourceDir, "run-tests.sh"));
    const scopedTestCmd = deriveScopedTestCmd(runTestsShText);
    const oracleTestsDir = join(contractDir, "oracle_tests");
    await copy(join(options.sourceDir, "tests"), oracleTestsDir, { overwrite: true });

    const taskJson: ITaskJson = TaskJsonSchema.parse({
      base_ref: baseRef,
      scoped_test_cmd: scopedTestCmd,
      family: `task:${upstream.category}`,
      difficulty: mapDifficulty(upstream.difficulty),
      min_turns: 2,
      portal: `external/terminal_bench/${sanitizedTaskId}`,
      title,
      source: {
        benchmark: "terminal-bench",
        version: options.benchmarkVersion,
        task_id: sanitizedTaskId,
      },
    });
    await Deno.writeTextFile(join(contractDir, "task.json"), JSON.stringify(taskJson, null, 2) + "\n");
    await Deno.writeTextFile(join(contractDir, "reference.patch"), referencePatch);

    const portalDir = join(options.outPortalsDir, sanitizedTaskId);
    await Deno.mkdir(portalDir, { recursive: true });
    await copyEnvironmentEntries(options.sourceDir, portalDir);

    return { taskId: sanitizedTaskId, contractDir, portalDir, baseRef, eligibility, skipped: false };
  } finally {
    await Deno.remove(workDir, { recursive: true });
  }
}

/** Reads a file, returning "" if it does not exist (classifier inputs are all optional —
 *  a task without a docker-compose.yaml/Dockerfile is judged on whatever signals exist). */
async function readOptionalFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
}

/** Concatenates every regular file under `testsDir` (classifier test-script inspection
 *  input) — recursive, since some upstream tasks nest helper modules under tests/. */
async function concatenateTestScripts(testsDir: string): Promise<string> {
  const chunks: string[] = [];
  try {
    for await (const entry of walk(testsDir, { includeDirs: false })) {
      chunks.push(await Deno.readTextFile(entry.path));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return chunks.join("\n");
}

/**
 * Classifies, ingests, and generates the scenario/request fixture for one upstream task —
 * the single-task unit of `batchIngestTerminalBench`'s loop. Any failure anywhere in this
 * path (a malformed upstream file, an oracle solution that cannot apply outside its real
 * container, an unexpected schema mismatch) is caught and recorded as `unsupported` with
 * an `ingest-error` reason instead of propagating — one bad upstream task must never abort
 * the whole release batch (Actions: "failures either fix ingest bugs or reclassify the
 * task with reason").
 */
async function ingestOneBatchTask(taskId: string, options: IBatchIngestOptions): Promise<IManifestTaskEntry> {
  try {
    const taskSourceDir = join(options.upstreamRoot, taskId);
    const classification = classifyTerminalBenchTask({
      dockerComposeText: await readOptionalFile(join(taskSourceDir, "docker-compose.yaml")),
      dockerfileText: await readOptionalFile(join(taskSourceDir, "Dockerfile")),
      testScriptsText: await concatenateTestScripts(join(taskSourceDir, "tests")),
    });
    if (!classification.supported) {
      return { task_id: taskId, class: "unsupported", reason: classification.reason, controls_status: "pending" };
    }

    const result = await ingestTerminalBenchTask({
      sourceDir: taskSourceDir,
      taskId,
      benchmarkVersion: options.benchmarkVersion,
      rootLicenseText: options.rootLicenseText,
      outFixturesDir: options.outFixturesDir,
      outPortalsDir: options.outPortalsDir,
      oracleSolutionTimeoutMs: options.oracleSolutionTimeoutMs,
    });
    if (result.skipped) {
      return { task_id: taskId, class: "license-ineligible", reason: result.reason, controls_status: "pending" };
    }

    const taskJson: ITaskJson = TaskJsonSchema.parse(
      JSON.parse(await Deno.readTextFile(join(result.contractDir, "task.json"))),
    );
    const taskMdText = await Deno.readTextFile(join(result.contractDir, "TASK.md"));
    await Deno.mkdir(options.outRequestsDir, { recursive: true });
    await Deno.writeTextFile(join(options.outRequestsDir, `${result.taskId}.md`), taskMdText);

    const scenarioYaml = renderExternalBenchTaskTemplate({
      id: `external-terminal-bench-${result.taskId}`,
      title: taskJson.title ?? humanizeTaskId(result.taskId),
      requestFixture: `fixtures/requests/external/terminal_bench/${result.taskId}.md`,
      portalDir: `external/terminal_bench/${result.taskId}`,
      scopedTestCmd: taskJson.scoped_test_cmd,
      oracleTestsDir: `${result.taskId}/oracle_tests`,
      tool: options.scenarioTool ?? DEFAULT_SCENARIO_TOOL,
      benchmarkVersion: options.benchmarkVersion,
    });
    await Deno.mkdir(options.outScenariosDir, { recursive: true });
    await Deno.writeTextFile(join(options.outScenariosDir, `${result.taskId}.yaml`), scenarioYaml + "\n");

    return { task_id: result.taskId, class: "supported", controls_status: "pending" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      task_id: taskId,
      class: "unsupported",
      reason: `ingest-error: ${message.split("\n")[0].slice(0, 200)}`,
      controls_status: "pending",
    };
  }
}

/**
 * Batch-ingests every task subdirectory of `options.upstreamRoot` (Phase 144 Step 3):
 * classifies each task, ingests the supported+license-eligible subset through the exact
 * same `ingestTerminalBenchTask` mapping/license/portal logic Step 1 established (no
 * duplication — Architecture Notes), generates one scenario + request fixture per ingested
 * task, and publishes a coverage manifest. 100% dockerless — classification is pure file
 * inspection, matching the Constraints ("CI is docker-free"); the controls sweep that
 * validates the supported subset live is a separate, explicitly docker-gated concern.
 */
export async function batchIngestTerminalBench(options: IBatchIngestOptions): Promise<IManifest> {
  const taskIds = (await Array.fromAsync(Deno.readDir(options.upstreamRoot)))
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();

  const tasks: IManifestTaskEntry[] = [];
  for (const taskId of taskIds) {
    tasks.push(await ingestOneBatchTask(taskId, options));
  }

  const supportedCount = tasks.filter((task) => task.class === "supported").length;
  const manifest: IManifest = {
    generated_at: new Date().toISOString(),
    benchmark_version: options.benchmarkVersion,
    total_tasks: tasks.length,
    supported_count: supportedCount,
    coverage_pct: tasks.length > 0 ? (supportedCount / tasks.length) * 100 : 0,
    tasks,
  };
  await Deno.mkdir(options.outFixturesDir, { recursive: true });
  await Deno.writeTextFile(join(options.outFixturesDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function parseArgs(argv: string[]): ICliArgs {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  const source = flags["source"];
  const taskId = flags["task-id"];
  const batch = flags["batch"];
  const benchmarkVersion = flags["benchmark-version"];
  const license = flags["license"];
  const usage = "Usage: --source <dir> --task-id <id> --benchmark-version <sha> --license <path> " +
    "[--out-fixtures <dir>] [--out-portals <dir>]\n" +
    "   or: --batch <upstream-release-root> --benchmark-version <sha> --license <path> " +
    "[--out-fixtures <dir>] [--out-portals <dir>] [--out-scenarios <dir>] [--out-requests <dir>]";
  if (!benchmarkVersion || !license) {
    throw new Error(usage);
  }
  if (batch) {
    if (source || taskId) {
      throw new Error(`--batch is mutually exclusive with --source/--task-id.\n${usage}`);
    }
  } else if (!source || !taskId) {
    throw new Error(usage);
  }
  return {
    source,
    taskId,
    batch,
    benchmarkVersion,
    license,
    outFixtures: flags["out-fixtures"] ?? DEFAULT_OUT_FIXTURES_DIR,
    outPortals: flags["out-portals"] ?? DEFAULT_OUT_PORTALS_DIR,
    outScenarios: flags["out-scenarios"] ?? DEFAULT_OUT_SCENARIOS_DIR,
    outRequests: flags["out-requests"] ?? DEFAULT_OUT_REQUESTS_DIR,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const rootLicenseText = await Deno.readTextFile(args.license);

  if (args.batch) {
    const manifest = await batchIngestTerminalBench({
      upstreamRoot: args.batch,
      benchmarkVersion: args.benchmarkVersion,
      rootLicenseText,
      outFixturesDir: args.outFixtures,
      outPortalsDir: args.outPortals,
      outScenariosDir: args.outScenarios,
      outRequestsDir: args.outRequests,
    });
    console.log(
      `BATCH INGESTED ${manifest.total_tasks} tasks -> ${manifest.supported_count} supported ` +
        `(${manifest.coverage_pct.toFixed(1)}% coverage)`,
    );
    if (manifest.coverage_pct < MIN_SUPPORTED_COVERAGE_PCT) {
      console.warn(
        `WARNING: coverage ${manifest.coverage_pct.toFixed(1)}% is below MIN_SUPPORTED_COVERAGE_PCT ` +
          `(${MIN_SUPPORTED_COVERAGE_PCT}%) — reassess the subset choice before spending on a live run.`,
      );
    }
    return;
  }

  const result = await ingestTerminalBenchTask({
    sourceDir: args.source!,
    taskId: args.taskId!,
    benchmarkVersion: args.benchmarkVersion,
    rootLicenseText,
    outFixturesDir: args.outFixtures,
    outPortalsDir: args.outPortals,
  });
  if (result.skipped) {
    console.log(`SKIPPED ${result.taskId}: ${result.reason}`);
    return;
  }
  console.log(`INGESTED ${result.taskId} -> ${result.contractDir} (base_ref=${result.baseRef})`);
}

if (import.meta.main) {
  await main();
}
