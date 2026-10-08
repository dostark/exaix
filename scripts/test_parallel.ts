#!/usr/bin/env -S deno run -A
/**
 * @module TestParallel
 * @path scripts/test_parallel.ts
 * @description Two-batch test runner: a Parallel Batch (the whole suite with `--parallel`)
 *   and a Containered Batch (the isolation-sensitive files, run in worker containers or
 *   serially). The Containered Batch uses the pretty reporter so every test name stays
 *   visible.
 * Usage:
 *   deno task test_all
 */

import { basename, fromFileUrl, join } from "@std/path";
import { z } from "zod";
import {
  DOT_REPORTER_SYMBOLS_PATTERN,
  extractTapFailures,
  parseDotReporterCounts,
  parseSummaryLine,
  parseTapOutput,
  stripAnsi,
} from "./test_output_parse.ts";
import type { ITapFailure, ITestCounts } from "./test_output_parse.ts";
import {
  DEFAULT_TEST_CONTAINER_IMAGE,
  DEFAULT_TEST_CONTAINER_NETWORK,
  DEFAULT_TEST_CONTAINER_WATCHDOG_MS,
  ensureDevTestImage,
  MIN_TEST_CONTAINER_JOBS,
  resolveContainerResourceBounds,
  runBatch2InContainers,
  selectBatch2Strategy,
  TEST_CONTAINER_IMAGE_ENV,
} from "./test_isolation.ts";
import { TEST_CONTAINER_REPORTER_ENV } from "./test_container_driver.ts";
import type { IContainerRunResult } from "./test_container_driver.ts";

export interface IDotReporterState {
  pendingDots: string;
  partialLine: string;
  wrapWidth: number;
}

export {
  DOT_REPORTER_SYMBOLS_PATTERN,
  extractTapFailures,
  parseDotReporterCounts,
  parseSummaryLine,
  parseTapOutput,
  stripAnsi,
};

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");
const SUPPORTED_REPORTERS = ["pretty", "dot", "tap"] as const;
export const DOT_REPORTER_LEGEND = "dot legend: .=passed ,=ignored !=failed";

/** Human-readable label for the parallel batch (the whole suite with `--parallel`). */
export const PARALLEL_BATCH_LABEL = "Parallel Batch";
/** Human-readable label for the container batch (the isolation-sensitive files). */
export const CONTAINERED_BATCH_LABEL = "Containered Batch";
/** The Containered Batch always uses the pretty reporter, so every test name stays visible. */
const CONTAINERED_BATCH_REPORTER = "pretty";

/** CLI input option for the worker-container count. */
export const TEST_CONTAINER_JOBS_FLAG = "--test-container-jobs";

/** CLI input option that forces the serial Batch-2 path (opts out of containers). */
export const TEST_SERIAL_FLAG = "--test-serial";

// Matches deno test --parallel's own default (hardwareConcurrency) rather than a
// hardcoded value: oversubscribing the host's core count causes concurrent CLI-heavy
// tests to fail spawning subprocesses transiently (observed on a 4-core WSL2 host).
const BATCH1_WORKER_COUNT = Deno.env.get("DENO_JOBS") ?? String(navigator.hardwareConcurrency);

// PIDs of running `deno test` batch children, spawned `detached` so a group-wide
// SIGTERM also reaches subprocesses they spawn (e.g. daemons booted by individual
// test files) — a child's own children are not signaled when only the child is killed.
const activeChildPids = new Set<number>();

/** `pids`/`kill` are injectable (default: real tracked set, `Deno.kill`) so this is unit-testable without spawning real processes. */
export function killActiveChildGroups(
  pids: Iterable<number> = activeChildPids,
  kill: (pid: number) => void = (pid) => Deno.kill(pid, "SIGTERM"),
): void {
  for (const pid of pids) {
    try {
      kill(-pid);
    } catch {
      // already dead, or not a process group leader (e.g. non-Linux) — nothing to signal
    }
  }
}

/** Register a spawned child's pid so `killActiveChildGroups` reaches it on shutdown. */
export function trackChild(pid: number): void {
  activeChildPids.add(pid);
}

/** Remove a child's pid once it has exited. */
export function untrackChild(pid: number): void {
  activeChildPids.delete(pid);
}

type TestReporter = typeof SUPPORTED_REPORTERS[number];

/** The isolation reasons a Batch-2 file can carry. */
export const IsolationReason = {
  moduleCache: "module-cache",
  processEnv: "process-env",
  port: "port",
  sharedPath: "shared-path",
  pressure: "pressure",
} as const;

export const IsolationReasonSchema = z.enum([
  IsolationReason.moduleCache,
  IsolationReason.processEnv,
  IsolationReason.port,
  IsolationReason.sharedPath,
  IsolationReason.pressure,
]);

export const SequentialTestSchema = z.object({
  file: z.string().min(1),
  reasons: z.array(IsolationReasonSchema).min(1),
  serializedOutput: z.boolean().default(false),
  /** true ⇒ the file runs alone, so a repo-shared writer never overlaps another file. */
  exclusive: z.boolean().default(false),
  network: z.boolean().default(false),
});

export type SequentialTest = z.input<typeof SequentialTestSchema>;

/** Containered Batch files with their isolation reasons. Order is authoritative and feeds the Parallel Batch's ignore list. */
export const SEQUENTIAL_TESTS: readonly SequentialTest[] = [
  { file: "apps/exactl/tests/exactl_all_test.ts", reasons: [IsolationReason.processEnv] },
  {
    file: "tests/scenario_framework/tests/unit/learning_effectiveness_live_test.ts",
    reasons: [IsolationReason.pressure],
    network: true,
  },
  {
    file: "tests/security/calibration_sandbox_security_test.ts",
    reasons: [IsolationReason.processEnv],
    network: true,
  },
  {
    file: "tests/scenario_framework/tests/portal_knowledge_strategies_scenario_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.pressure],
  },
  // Deploys a fresh workspace and runs `deno task setup`, which resolves npm deps at run
  // time. That egress cannot run under `--network none`, so it runs host-serial.
  {
    file: "apps/daemon/tests/deploy_workspace_test.ts",
    reasons: [IsolationReason.pressure],
    network: true,
  },
  {
    file: "tests/integration/cli_commands_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.pressure],
  },
  {
    file: "tests/integration/agent/mcp_handshake_test.ts",
    reasons: [IsolationReason.sharedPath],
    exclusive: true,
  },
  { file: "tests/scenario_framework/tests/plan_amendment_scenario_test.ts", reasons: [IsolationReason.port] },
  {
    file: "tests/integration/config_cutover_daemon_boot_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/config_integrity_daemon_boot_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.port],
  },
  {
    file: "tests/integration/execution_verification_cutover_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/openai_compatible_daemon_cutover_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/scenario_framework/tests/integration/openai_compatible_native_test.ts",
    reasons: [IsolationReason.processEnv, IsolationReason.port],
  },
  {
    file: "tests/scenario_framework/tests/integration/scenario_bindings_test.ts",
    reasons: [IsolationReason.processEnv, IsolationReason.port],
  },
  {
    file: "tests/scenario_framework/tests/integration/operator_override_axes_test.ts",
    reasons: [IsolationReason.processEnv, IsolationReason.port],
  },
  {
    file: "tests/scenario_framework/tests/integration/flow_step_model_bindings_test.ts",
    reasons: [IsolationReason.processEnv, IsolationReason.port],
  },
  {
    file: "tests/integration/dogfood_e2e_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.port],
  },
  {
    file: "tests/integration/dogfood_crash_recovery_e2e_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.port],
  },
  {
    file: "tests/integration/daemon_watcher_readiness_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.port],
  },
  { file: "tests/migrations/migrate_db_test.ts", reasons: [IsolationReason.moduleCache] },
  { file: "packages/core/tests/child_env_test.ts", reasons: [IsolationReason.processEnv] },
  { file: "tests/scripts/check_commit_msg_test.ts", reasons: [IsolationReason.processEnv] },
  { file: "packages/ai/tests/model_resolver_determinism_test.ts", reasons: [IsolationReason.processEnv] },
  { file: "packages/ai/tests/model_resolver_registry_test.ts", reasons: [IsolationReason.processEnv] },
  { file: "packages/storage-sqlite/tests/test_mode_schema_test.ts", reasons: [IsolationReason.processEnv] },
  { file: "apps/exactl/tests/blueprint_commands_test.ts", reasons: [IsolationReason.pressure] },
  { file: "apps/daemon/tests/session_delegation_coordinator_test.ts", reasons: [IsolationReason.pressure] },
  { file: "packages/flow/tests/session_delegate_cycle_sequencing_test.ts", reasons: [IsolationReason.pressure] },
  { file: "apps/daemon/tests/health_check_service_test.ts", reasons: [IsolationReason.pressure] },
  {
    file: "apps/daemon/tests/dynamic_step_wiring_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.pressure],
  },
  {
    file: "apps/daemon/tests/session_delegate_cycle_dogfood_e2e_test.ts",
    reasons: [IsolationReason.moduleCache, IsolationReason.pressure],
  },
  { file: "apps/daemon/tests/readiness_test.ts", reasons: [IsolationReason.pressure] },
  {
    file: "tests/integration/agent_runner_daemon_cutover_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  // `deno compile` downloads the `denort` runtime from dl.deno.land, so it needs egress.
  {
    file: "tests/infra/build_test.ts",
    reasons: [IsolationReason.sharedPath],
    serializedOutput: true,
    network: true,
  },
  {
    file: "tests/infra/exactl_edition_build_test.ts",
    reasons: [IsolationReason.sharedPath],
    serializedOutput: true,
    network: true,
  },
  {
    file: "apps/daemon/tests/agent_role_cutover_e2e_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/model_registry_route_admit_live_test.ts",
    reasons: [IsolationReason.port],
    network: true,
  },
  {
    file: "tests/integration/model_registry_team_cost_source_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/model_registry_team_edition_sweep_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/model_registry_team_cutover_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/integration/mcp_server_spec_compliance_cutover_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  { file: "tests/scripts/db_cache_schema_upgrade_test.ts", reasons: [IsolationReason.moduleCache] },
  {
    file: "tests/integration/daemon_net_policy_enforcement_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  { file: "tests/scenario_framework/tests/unit/assertions_evidence_test.ts", reasons: [IsolationReason.processEnv] },
  {
    file: "tests/scenario_framework/tests/integration/self_hosted_split_bindings_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/scenario_framework/tests/integration/binding_evidence_cli_test.ts",
    reasons: [IsolationReason.port, IsolationReason.pressure],
  },
  {
    file: "tests/scenario_framework/tests/integration/memory_pipeline_test.ts",
    reasons: [IsolationReason.moduleCache],
  },
  // CLI- and timing-sensitive: these fail under the Parallel Batch's concurrent load.
  { file: "apps/exactl/tests/commands/skill_commands_cli_test.ts", reasons: [IsolationReason.pressure] },
  { file: "packages/core/tests/skills/skill_folder_performance_test.ts", reasons: [IsolationReason.pressure] },
];

/** Derived so the Parallel Batch's `--ignore` list is unchanged. Content and order come from SEQUENTIAL_TESTS. */
export const SEQUENTIAL_FILES: string[] = SEQUENTIAL_TESTS.map((test) => test.file);

/** An explicit `--ignore` on the CLI overrides deno.json's config `exclude` for the walk, so fixtures excluded there (e.g. broken-on-purpose portal sources) must be re-listed here or they leak back into type-checking. */
const PARALLEL_IGNORE_PATHS: string[] = [
  "tests/scenario_framework/fixtures/",
];

interface TestStats extends ITestCounts {
  label: string;
  exitCode: number;
}

/** Subset passed to row() for rendering (everything except label). */
type TestRowData = Pick<TestStats, "passed" | "failed" | "ignored" | "durationSec" | "exitCode">;

/** Rule width for the failure blocks shown at the end of a run. */
const FAILURE_RULE = "═".repeat(60);

/** Render one failure block in the same shape `runAndCapture` uses. */
export function formatFailureBlock(batchTag: string, failedCount: number, body: string): string {
  return `\n${FAILURE_RULE}\n ${batchTag}: FAILURES (${failedCount} total)\n${FAILURE_RULE}\n${body}\n${FAILURE_RULE}\n`;
}

/** Map a container result onto the existing summary row shape. */
export function containerResultToStats(result: IContainerRunResult): TestStats {
  return {
    label: `${CONTAINERED_BATCH_LABEL} – ${basename(result.testFile)}`,
    passed: result.passed,
    failed: result.failed,
    ignored: result.ignored,
    durationSec: result.durationSec,
    exitCode: result.exitCode,
  };
}

/** Failure block for a failed container result, or null when it passed. */
export function containerResultFailureBlock(result: IContainerRunResult): string | null {
  if (result.exitCode === 0) return null;
  return formatFailureBlock("CONTAINERED BATCH", result.failed, result.failureDetail ?? "(no details)");
}

const DEFAULT_DOT_WRAP_WIDTH = 80;

export function resolveReporter(args: string[]): TestReporter {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--reporter=")) {
      return validateReporter(arg.slice("--reporter=".length));
    }
    if (arg === "--reporter") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing reporter value after --reporter");
      }
      return validateReporter(nextArg);
    }
  }

  return "pretty";
}

export function buildDenoTestArgs(extraArgs: string[], reporter: string): string[] {
  return ["test", "--allow-all", "--reporter", reporter, ...extraArgs];
}

export function stripReporterArgs(args: string[]): string[] {
  const filteredArgs: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--reporter=")) {
      continue;
    }
    if (arg === "--reporter") {
      index++;
      continue;
    }
    filteredArgs.push(arg);
  }

  return filteredArgs;
}

/** Parse `--test-container-jobs <N>` / `=<N>`. Undefined when absent, and throws on a bad value. */
export function resolveContainerJobs(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let raw: string | undefined;
    if (arg.startsWith(`${TEST_CONTAINER_JOBS_FLAG}=`)) {
      raw = arg.slice(TEST_CONTAINER_JOBS_FLAG.length + 1);
    } else if (arg === TEST_CONTAINER_JOBS_FLAG) {
      raw = args[index + 1];
      if (raw === undefined) {
        throw new Error(`Missing value after ${TEST_CONTAINER_JOBS_FLAG}`);
      }
    }
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < MIN_TEST_CONTAINER_JOBS) {
      throw new Error(
        `Invalid ${TEST_CONTAINER_JOBS_FLAG} value "${raw}": expected an integer >= ${MIN_TEST_CONTAINER_JOBS}`,
      );
    }
    return value;
  }
  return undefined;
}

/** Remove `--test-container-jobs` from the args forwarded to `deno test`. */
export function stripContainerJobsArgs(args: string[]): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith(`${TEST_CONTAINER_JOBS_FLAG}=`)) continue;
    if (arg === TEST_CONTAINER_JOBS_FLAG) {
      index++;
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

/** True when `--test-serial` is present. */
export function resolveTestSerial(args: string[]): boolean {
  return args.includes(TEST_SERIAL_FLAG);
}

/** Remove the container-control flags (`--test-container-jobs`, `--test-serial`) from the
 *  args forwarded to `deno test`. */
export function stripTestControlArgs(args: string[]): string[] {
  return stripContainerJobsArgs(args).filter((arg) => arg !== TEST_SERIAL_FLAG);
}

/** Host env vars forwarded to a worker container. Never the whole host env, never DENO_JOBS. */
const CONTAINER_ENV_ALLOWLIST = ["TZ", "CI", "LANG", "LC_ALL"];

/** Build the explicit worker-container env from the allowlist. The source defaults to the
 *  process env, but only allowlist keys are copied, so `Deno.env.toObject()` is never forwarded. */
export function buildContainerEnv(
  source: Record<string, string | undefined> = Deno.env.toObject(),
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CONTAINER_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env[TEST_CONTAINER_REPORTER_ENV] = CONTAINERED_BATCH_REPORTER;
  return env;
}

export function createDotReporterState(wrapWidth = DEFAULT_DOT_WRAP_WIDTH): IDotReporterState {
  return {
    pendingDots: "",
    partialLine: "",
    wrapWidth,
  };
}

function takeWrappedSymbolLines(state: IDotReporterState, newlineToken: string): string {
  let output = "";

  while (state.pendingDots.length >= state.wrapWidth) {
    output += `${state.pendingDots.slice(0, state.wrapWidth)}${newlineToken}`;
    state.pendingDots = state.pendingDots.slice(state.wrapWidth);
  }

  return output;
}

export function compactDotReporterChunk(text: string, state: IDotReporterState): string {
  const combined = `${state.partialLine}${text}`;
  const newlineMatch = combined.match(/\r?\n/g);
  const newlineToken = newlineMatch?.[0] ?? "\n";
  const completeLines = combined.split(/\r?\n/);

  state.partialLine = combined.match(/\r?\n$/) ? "" : completeLines.pop() ?? "";
  if (state.partialLine === "" && completeLines.at(-1) === "") {
    completeLines.pop();
  }

  let output = "";
  for (const line of completeLines) {
    const visibleLine = stripAnsi(line);
    if (DOT_REPORTER_SYMBOLS_PATTERN.test(visibleLine)) {
      state.pendingDots += visibleLine;
      output += takeWrappedSymbolLines(state, newlineToken);
      continue;
    }

    if (state.pendingDots.length > 0) {
      output += state.pendingDots;
      state.pendingDots = "";
    }

    output += `${line}${newlineToken}`;
  }

  return output;
}

export function flushDotReporterState(state: IDotReporterState): string {
  let output = "";

  const visiblePartialLine = stripAnsi(state.partialLine);

  if (DOT_REPORTER_SYMBOLS_PATTERN.test(visiblePartialLine)) {
    state.pendingDots += visiblePartialLine;
    output += takeWrappedSymbolLines(state, "\n");
    state.partialLine = "";
  } else if (state.partialLine.length > 0) {
    if (state.pendingDots.length > 0) {
      output += state.pendingDots;
      state.pendingDots = "";
    }
    output += state.partialLine;
    state.partialLine = "";
  }

  if (state.pendingDots.length > 0) {
    output += `${state.pendingDots}\n`;
    state.pendingDots = "";
  }

  return output;
}

/** Maps TAP lines to compact symbols: "ok" → ".", "not ok" → "!", "ok ... # SKIP" → ","; everything else (YAML/version/plan lines) is suppressed. */
export function compactTapReporterChunk(text: string, state: IDotReporterState): string {
  const lines = text.split(/\r?\n/);
  let output = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("not ok ")) {
      state.pendingDots += "!";
    } else if (trimmed.startsWith("ok ") && trimmed.includes("#")) {
      state.pendingDots += ",";
    } else if (trimmed.startsWith("ok ") && !trimmed.startsWith("ok ---")) {
      state.pendingDots += ".";
    }
  }

  output += takeWrappedSymbolLines(state, "\n");
  return output;
}

function validateReporter(value: string): TestReporter {
  if (value === "pretty" || value === "dot") {
    return value;
  }

  throw new Error(
    `Unsupported reporter \"${value}\". Expected one of: ${SUPPORTED_REPORTERS.join(", ")}`,
  );
}

function getTerminalWidth(_dest: typeof Deno.stdout): number {
  try {
    return Math.max(Deno.consoleSize().columns, 1);
  } catch {
    return DEFAULT_DOT_WRAP_WIDTH;
  }
}

/** Invokes `deno test` directly (not via `deno task`) so piped-stdout capture isn't obscured by the task shell wrapper. */
async function runAndCapture(
  extraArgs: string[],
  label: string,
  env: Record<string, string>,
  reporter: string,
  compactHeader = false,
): Promise<TestStats> {
  const header = formatRunHeader(label, compactHeader);
  if (header.length > 0) {
    console.log(header);
  }

  const startedAt = Date.now();

  const command = new Deno.Command(Deno.execPath(), {
    args: buildDenoTestArgs(extraArgs, reporter),
    stdout: "piped",
    stderr: "piped",
    cwd: REPO_ROOT,
    env,
    // New process group (Linux setsid-equivalent) so killActiveChildGroups's
    // Deno.kill(-pid, ...) reaches every subprocess this child spawns, not just itself.
    detached: true,
  });

  const child = command.spawn();
  activeChildPids.add(child.pid);
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];

  // Tee: forward each chunk to the terminal immediately AND accumulate it.
  const drain = (
    src: ReadableStream<Uint8Array>,
    store: Uint8Array[],
    dest: typeof Deno.stdout,
  ) => {
    const dotReporterState = reporter === "dot" ? createDotReporterState(getTerminalWidth(dest)) : undefined;
    const tapState = reporter === "tap" ? createDotReporterState(getTerminalWidth(dest)) : undefined;

    return (
      src
        .pipeTo(
          new WritableStream({
            write(chunk) {
              store.push(chunk);
              try {
                if (dotReporterState) {
                  const formatted = compactDotReporterChunk(new TextDecoder().decode(chunk), dotReporterState);
                  if (formatted.length > 0) {
                    dest.writeSync(new TextEncoder().encode(formatted));
                  }
                } else if (tapState) {
                  const text = new TextDecoder().decode(chunk);
                  const formatted = compactTapReporterChunk(text, tapState);
                  if (formatted.length > 0) {
                    dest.writeSync(new TextEncoder().encode(formatted));
                  }
                } else {
                  dest.writeSync(chunk);
                }
              } catch {
                // terminal fd gone (e.g. piped to grep) — ignore
              }
            },
          }),
        )
        .then(() => {
          if (dotReporterState) {
            const flushed = flushDotReporterState(dotReporterState);
            if (flushed.length > 0) {
              try {
                dest.writeSync(new TextEncoder().encode(flushed));
              } catch {
                // terminal fd gone — ignore
              }
            }
          }
          if (tapState) {
            const flushed = flushDotReporterState(tapState);
            if (flushed.length > 0) {
              try {
                dest.writeSync(new TextEncoder().encode(flushed));
              } catch {
                // terminal fd gone — ignore
              }
            }
          }
        })
        .catch(() => {})
    ); // stream errors on early process exit are benign
  };

  const [status] = await Promise.all([
    child.status,
    drain(child.stdout, outChunks, Deno.stdout),
    drain(child.stderr, errChunks, Deno.stderr),
  ]);
  activeChildPids.delete(child.pid);

  // Combine stdout + stderr to maximise chance of finding the summary line.
  const allText = new TextDecoder().decode(
    new Uint8Array([...outChunks, ...errChunks].flatMap((c) => [...c])),
  );

  const parsedSummary = parseSummaryLine(allText);
  const durationSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  let counts: ITestCounts;
  let failures: ITapFailure[] = [];

  if ((reporter as string) === "tap") {
    // Parse TAP output for test counts and failure details.
    const tapResult = parseTapOutput(allText, durationSec);
    counts = tapResult;
    failures = extractTapFailures(allText);
    if (failures.length > 0) {
      const batchTag = label.startsWith(PARALLEL_BATCH_LABEL) ? "PARALLEL BATCH" : "CONTAINERED BATCH";
      const body = failures.map((f) => `  ${f.name}\n  ${f.message}`).join("\n");
      allFailures.push(formatFailureBlock(batchTag, counts.failed, body));
    }
  } else {
    counts = reporter === "dot" && parsedSummary.passed === 0 && parsedSummary.failed === 0
      ? parseDotReporterCounts(allText, durationSec)
      : parsedSummary;

    // If there were test failures, collect error details for final display.
    if (counts.failed > 0) {
      const clean = stripAnsi(allText);
      const errorsMatch = clean.match(/\n\s*ERRORS\s*\n([\s\S]*?)(?:\n\s*FAILURES\s|\n\s*═|$)/);
      if (errorsMatch) {
        const body = errorsMatch[1].trim();
        if (body) {
          const batchTag = label.startsWith(PARALLEL_BATCH_LABEL) ? "PARALLEL BATCH" : "CONTAINERED BATCH";
          allFailures.push(formatFailureBlock(batchTag, counts.failed, body));
        }
      } else if (reporter === "dot") {
        allFailures.push(`(${counts.failed} test(s) failed in "${label}". Use dot legend '!' for location.)\n`);
      }
    }
  }

  const effectiveExitCode = (reporter as string) === "tap" ? (counts.failed > 0 ? 1 : 0) : status.code;
  return { label, exitCode: effectiveExitCode, ...counts };
}

// Summary table
const LABEL_W = 50; // visible chars for the label text
const NUM_W = 6; // width of each numeric column
const TIME_W = 7; // width of the time column
// Total row width: 2(indent) + 2(icon) + 1(sp) + LABEL_W + 3*(NUM_W+2) + TIME_W+2
const WIDTH = 2 + 2 + 1 + LABEL_W + 3 * (NUM_W + 2) + TIME_W + 2;
const HR = "─".repeat(WIDTH);
const DHR = "═".repeat(WIDTH);

function formatDur(sec: number): string {
  if (sec <= 0) return "--";
  return sec >= 60 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s` : `${sec}s`;
}

// Shared accumulator for failure messages displayed at the end.
const allFailures: string[] = [];

function row(
  label: string,
  stats: TestRowData,
): string {
  const icon = stats.exitCode === 0 ? "✅" : "❌";
  const l = label.length > LABEL_W ? label.slice(0, LABEL_W - 1) + "…" : label.padEnd(LABEL_W);
  const p = String(stats.passed).padStart(NUM_W);
  const f = String(stats.failed).padStart(NUM_W);
  const i = String(stats.ignored).padStart(NUM_W);
  const t = formatDur(stats.durationSec).padStart(TIME_W);
  return `${icon} ${l}  ${p}  ${f}  ${i}  ${t}`;
}

export function formatRunHeader(label: string, compact = false): string {
  const prefix = `${CONTAINERED_BATCH_LABEL} – `;
  const compactLabel = label.startsWith(prefix) ? label.slice(prefix.length) : label;
  return `${compact ? "\n" : ""}› ${compactLabel}`;
}

const HEADER_LABEL = "BATCH / FILE".padEnd(LABEL_W);
const HEADER_NUMS = `${"PASS".padStart(NUM_W)}  ${"FAIL".padStart(NUM_W)}  ${"SKIP".padStart(NUM_W)}  ${
  "TIME".padStart(TIME_W)
}`;

export async function main(args: string[]): Promise<number> {
  const reporter = resolveReporter(args);
  const forwardedArgs = stripTestControlArgs(stripReporterArgs(args));
  const cliJobs = resolveContainerJobs(args);
  const cliSerial = resolveTestSerial(args);

  if (reporter === "dot") {
    console.log(DOT_REPORTER_LEGEND);
  }

  // Edition filtering: exclude Team-only paths when EXAIX_EDITION is solo/unset
  const edition = Deno.env.get("EXAIX_EDITION") ?? "solo";
  const teamPaths = edition === "solo" ? [] : ["exaix-team/"];

  // Parallel Batch: the full test suite in parallel (TAP reporter for error capture).
  const batch1Env: Record<string, string> = {
    ...Deno.env.toObject(),
    DENO_JOBS: BATCH1_WORKER_COUNT,
    EXA_TEST_FORCE_CLI_PARALLEL: "1",
  };
  const batch1IgnorePaths = [...SEQUENTIAL_FILES, ...PARALLEL_IGNORE_PATHS];
  const batch1IgnoreArgs = batch1IgnorePaths.map((p) => `--ignore=${p}`);

  const batch1Args = ["--parallel", "tests/", "packages/", ...teamPaths, "apps/", ...forwardedArgs];
  batch1Args.splice(1, 0, ...batch1IgnoreArgs);

  const batch1Stats = await runAndCapture(
    batch1Args,
    PARALLEL_BATCH_LABEL,
    batch1Env,
    "tap",
  );

  // Measure the Containered Batch wall-clock here. Per-file durations overlap across
  // workers, so their sum is not the batch duration.
  const batch2StartedAt = Date.now();

  // Containered Batch: sequential files, one per Deno.Command, no DENO_JOBS set.
  // Kill any daemon left behind by the parallel batch. It holds the default CLI port,
  // so a sequential daemon test would fail with "Daemon died during startup".
  try {
    const cleanup = new Deno.Command("pkill", { args: ["-f", "daemon/main.ts"] }).outputSync();
    if (cleanup.code === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* pkill not available */ }
  // Pre-warm the daemon module cache: parallel compilation from the earlier batch
  // can leave partial/corrupted cache entries, so force a clean build before any
  // daemon subprocess touches it.
  if (SEQUENTIAL_FILES.some((f) => f.includes("daemon") || f.includes("dogfood"))) {
    const warmup = new Deno.Command("deno", { args: ["cache", "apps/daemon/main.ts"] }).spawn();
    await warmup.status;
  }
  const batch2Env: Record<string, string> = { ...Deno.env.toObject() };
  delete batch2Env["DENO_JOBS"]; // ensures skipInParallel === false inside each file

  const strategy = await selectBatch2Strategy(Deno.env.toObject(), undefined, { jobs: cliJobs, serial: cliSerial });
  console.log(`› ${CONTAINERED_BATCH_LABEL} strategy: ${strategy.mode} — ${strategy.reason}`);

  const seq: TestStats[] = [];
  if (strategy.mode === "container") {
    const image = Deno.env.get(TEST_CONTAINER_IMAGE_ENV) ?? DEFAULT_TEST_CONTAINER_IMAGE;
    const bounds = resolveContainerResourceBounds(Deno.env.toObject());
    await ensureDevTestImage(image);
    const results = await runBatch2InContainers(SEQUENTIAL_TESTS, {
      repoRoot: REPO_ROOT,
      image,
      jobs: strategy.jobs,
      env: buildContainerEnv(),
      network: DEFAULT_TEST_CONTAINER_NETWORK,
      pidsLimit: bounds.pidsLimit,
      memory: bounds.memory,
      cpus: bounds.cpus,
      watchdogMs: DEFAULT_TEST_CONTAINER_WATCHDOG_MS,
    });
    for (const result of results) {
      seq.push(containerResultToStats(result));
      const block = containerResultFailureBlock(result);
      if (block) allFailures.push(block);
    }
    // Network-flagged files run host-serial so their counts still join the Containered Batch.
    for (const entry of SEQUENTIAL_TESTS.filter((test) => test.network)) {
      const stats = await runAndCapture(
        [entry.file, ...forwardedArgs],
        `${CONTAINERED_BATCH_LABEL} – ${basename(entry.file)}`,
        batch2Env,
        CONTAINERED_BATCH_REPORTER,
        true,
      );
      seq.push(stats);
    }
  } else {
    for (const file of SEQUENTIAL_FILES) {
      const stats = await runAndCapture(
        [file, ...forwardedArgs],
        `${CONTAINERED_BATCH_LABEL} – ${basename(file)}`,
        batch2Env,
        CONTAINERED_BATCH_REPORTER,
        true,
      );
      seq.push(stats);
    }
  }

  const b2Passed = seq.reduce((a, s) => a + s.passed, 0);
  const b2Failed = seq.reduce((a, s) => a + s.failed, 0);
  const b2Ignored = seq.reduce((a, s) => a + s.ignored, 0);
  const batch2WallSec = Math.max(0, Math.round((Date.now() - batch2StartedAt) / 1000));
  const b2ExitCode = seq.some((s) => s.exitCode !== 0) ? 1 : 0;

  const totalPassed = batch1Stats.passed + b2Passed;
  const totalFailed = batch1Stats.failed + b2Failed;
  const totalIgnored = batch1Stats.ignored + b2Ignored;
  const totalSec = batch1Stats.durationSec + batch2WallSec;
  const anyFailed = batch1Stats.exitCode !== 0 || b2ExitCode !== 0;

  console.log(`\n${DHR}`);
  console.log(" TEST RUN SUMMARY");
  console.log(DHR);
  console.log(`   ${HEADER_LABEL}    ${HEADER_NUMS}`);
  console.log(HR);

  // Parallel Batch row
  console.log(`  ${row(PARALLEL_BATCH_LABEL, batch1Stats)}`);
  console.log(HR);

  // Containered Batch per-file rows
  for (const s of seq) {
    const shortLabel = s.label.replace(`${CONTAINERED_BATCH_LABEL} – `, "");
    console.log(`  ${row(shortLabel, s)}`);
  }
  console.log(HR);

  // Containered Batch subtotal
  console.log(
    `  ${
      row(`${CONTAINERED_BATCH_LABEL} total`, {
        passed: b2Passed,
        failed: b2Failed,
        ignored: b2Ignored,
        durationSec: batch2WallSec,
        exitCode: b2ExitCode,
      })
    }`,
  );
  console.log(DHR);

  // Grand total
  console.log(
    `  ${
      row("GRAND TOTAL", {
        passed: totalPassed,
        failed: totalFailed,
        ignored: totalIgnored,
        durationSec: totalSec,
        exitCode: anyFailed ? 1 : 0,
      })
    }`,
  );
  console.log(`${DHR}\n`);

  if (anyFailed) {
    console.error("❌  One or more batches failed.\n");
  } else {
    console.log("🎉  All batches passed.\n");
  }

  if (allFailures.length > 0) {
    for (const msg of allFailures) {
      console.error(msg);
    }
  }

  return anyFailed ? 1 : 0;
}

if (import.meta.main) {
  // On an external interrupt (Ctrl-C, or a harness/CI timeout sending SIGTERM), kill every
  // tracked child's process group before exiting — see activeChildPids's doc comment for why
  // this is required (a plain process exit does not cascade to a child's own children).
  const onSignal = () => {
    killActiveChildGroups();
    Deno.exit(1);
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);

  let exitCode = 1;
  try {
    exitCode = await main(Deno.args);
  } finally {
    // Defensive: a thrown error (not a signal) also leaves no further code running to reach
    // runAndCapture's own post-await cleanup — clear any still-tracked group just in case.
    killActiveChildGroups();
  }
  Deno.exit(exitCode);
}
