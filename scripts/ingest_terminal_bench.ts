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
 *   Usage: deno run -A scripts/ingest_terminal_bench.ts --source <dir> --task-id <id>
 *     --benchmark-version <sha> --license <root-license-path> --test-command <cmd>
 *     [--out-fixtures <dir>] [--out-portals <dir>]
 * @related-files [tests/scenario_framework/schema/task_schema.ts, tests/scripts/ingest_terminal_bench_test.ts, tests/scripts/license_eligibility_test.ts]
 */

import { z } from "zod";
import { parse as parseYaml } from "@std/yaml";
import { copy } from "@std/fs";
import { join, resolve } from "@std/path";
import { PathSecurity } from "@exaix/tool-runtime";
import type { Opt, Reason } from "@exaix/core/types";
import { type ITaskJson, TaskJsonSchema } from "../tests/scenario_framework/schema/task_schema.ts";

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

interface ICliArgs {
  source: string;
  taskId: string;
  benchmarkVersion: string;
  license: string;
  outFixtures: string;
  outPortals: string;
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
 * Applies the upstream oracle solution against a dockerless temp working directory.
 * The solution's hardcoded container WORKDIR (`/app`) is rewritten to the real temp
 * path first — Step 1 has no container to provide `/app`; Step 2 will run the
 * unmodified upstream script inside the real container.
 */
async function applyOracleSolutionDockerless(solutionPath: string, workDir: string): Promise<void> {
  const originalScript = await Deno.readTextFile(solutionPath);
  const adaptedScript = originalScript.replaceAll(CONTAINER_WORKDIR, workDir);
  const adaptedPath = join(workDir, ".oracle-solution-dockerless.sh");
  await Deno.writeTextFile(adaptedPath, adaptedScript);
  const command = new Deno.Command("bash", { args: [adaptedPath], cwd: workDir, stdout: "piped", stderr: "piped" });
  const output = await command.output();
  await Deno.remove(adaptedPath);
  if (!output.success) {
    throw new Error(`oracle solution failed: ${new TextDecoder().decode(output.stderr)}`);
  }
}

function humanizeTaskId(taskId: string): string {
  return taskId.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Reads a task-local LICENSE/NOTICE override if present in the upstream source dir. */
async function readTaskLocalLicense(sourceDir: string): Promise<string | undefined> {
  for (const name of ["LICENSE", "NOTICE"]) {
    try {
      return await Deno.readTextFile(join(sourceDir, name));
    } catch {
      continue;
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
  const pipInstallMatch = runTestsShText.match(/uv pip install\s+([^\n]+)/);
  const packages = pipInstallMatch ? pipInstallMatch[1].trim() : DEFAULT_TEST_PACKAGES;
  return [
    `curl -LsSf https://astral.sh/uv/${UV_INSTALLER_VERSION}/install.sh | sh -s -- -q`,
    `export PATH="$HOME/.local/bin:$PATH"`,
    `uv venv /tmp/.venv -q`,
    `. /tmp/.venv/bin/activate`,
    `uv pip install -q ${packages}`,
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
    await applyOracleSolutionDockerless(solutionPath, workDir);
    await runGit(["add", "-A"], workDir);
    const referencePatch = await runGit(["diff", "--cached"], workDir) + "\n";

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
  const benchmarkVersion = flags["benchmark-version"];
  const license = flags["license"];
  if (!source || !taskId || !benchmarkVersion || !license) {
    throw new Error(
      "Usage: --source <dir> --task-id <id> --benchmark-version <sha> --license <path> " +
        "[--out-fixtures <dir>] [--out-portals <dir>]",
    );
  }
  return {
    source,
    taskId,
    benchmarkVersion,
    license,
    outFixtures: flags["out-fixtures"] ?? DEFAULT_OUT_FIXTURES_DIR,
    outPortals: flags["out-portals"] ?? DEFAULT_OUT_PORTALS_DIR,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const rootLicenseText = await Deno.readTextFile(args.license);
  const result = await ingestTerminalBenchTask({
    sourceDir: args.source,
    taskId: args.taskId,
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
