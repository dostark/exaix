/**
 * @module TestParallelRunnerTest
 * @path tests/scripts/test_parallel_test.ts
 * @description Verifies reporter parsing for the custom parallel test runner.
 */

import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { TEST_CONTAINER_REPORTER_ENV } from "../../scripts/test_container_driver.ts";

import {
  buildContainerEnv,
  buildDenoTestArgs,
  compactDotReporterChunk,
  containerResultFailureBlock,
  containerResultToStats,
  createDotReporterState,
  DOT_REPORTER_LEGEND,
  extractTapFailures,
  flushDotReporterState,
  formatRunHeader,
  killActiveChildGroups,
  parseDotReporterCounts,
  parseSummaryLine,
  parseTapOutput,
  resolveContainerJobs,
  resolveReporter,
  resolveTestSerial,
  SEQUENTIAL_FILES,
  SEQUENTIAL_TESTS,
  SequentialTestSchema,
  stripContainerJobsArgs,
  stripReporterArgs,
  stripTestControlArgs,
  TEST_CONTAINER_JOBS_FLAG,
  TEST_SERIAL_FLAG,
} from "../../scripts/test_parallel.ts";
import type { IContainerRunResult } from "../../scripts/test_container_driver.ts";
import * as testOutputParse from "../../scripts/test_output_parse.ts";

Deno.test("resolveReporter defaults to pretty output", () => {
  assertEquals(resolveReporter([]), "pretty");
});

Deno.test("resolveReporter accepts equals-form reporter flag", () => {
  assertEquals(resolveReporter(["--reporter=dot"]), "dot");
});

Deno.test("resolveReporter accepts spaced reporter flag", () => {
  assertEquals(resolveReporter(["--reporter", "pretty"]), "pretty");
});

Deno.test("resolveReporter rejects unsupported reporters", () => {
  assertThrows(() => resolveReporter(["--reporter=tap"]), Error, "Unsupported reporter");
});

Deno.test("buildDenoTestArgs injects the requested reporter", () => {
  assertEquals(buildDenoTestArgs(["--parallel"], "dot"), [
    "test",
    "--allow-all",
    "--reporter",
    "dot",
    "--parallel",
  ]);
});

Deno.test("stripReporterArgs preserves non-reporter flags", () => {
  assertEquals(stripReporterArgs(["--reporter=dot", "--filter", "flow", "--parallel"]), [
    "--filter",
    "flow",
    "--parallel",
  ]);
});

Deno.test("formatRunHeader renders compact Containered Batch header", () => {
  assertEquals(
    formatRunHeader("Containered Batch – 24_portal_e2e_workflow_test.ts", true),
    "\n› 24_portal_e2e_workflow_test.ts",
  );
});

Deno.test("formatRunHeader renders the Parallel Batch header unchanged", () => {
  assertEquals(formatRunHeader("Parallel Batch"), "› Parallel Batch");
});

Deno.test("DOT_REPORTER_LEGEND documents symbol meanings", () => {
  assertEquals(DOT_REPORTER_LEGEND, "dot legend: .=passed ,=ignored !=failed");
});

Deno.test("compactDotReporterChunk keeps passing dots on one line", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n.\n.\n", state), "");
  assertEquals(
    compactDotReporterChunk("ok | 3 passed | 0 failed (1ms)\n", state),
    "...ok | 3 passed | 0 failed (1ms)\n",
  );
  assertEquals(flushDotReporterState(state), "");
});

Deno.test("compactDotReporterChunk handles split chunks before flushing", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n.\n", state), "");
  assertEquals(compactDotReporterChunk(".", state), "");
  assertEquals(flushDotReporterState(state), "...\n");
});

Deno.test("compactDotReporterChunk keeps ignored commas with pass dots", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n,\n.\n", state), "");
  assertEquals(
    compactDotReporterChunk("ok | 2 passed | 0 failed | 1 ignored (1ms)\n", state),
    ".,.ok | 2 passed | 0 failed | 1 ignored (1ms)\n",
  );
  assertEquals(flushDotReporterState(state), "");
});

Deno.test("compactDotReporterChunk flushes once it reaches terminal width", () => {
  const state = createDotReporterState(3);

  assertEquals(compactDotReporterChunk(".\n,\n.\n", state), ".,.\n");
  assertEquals(flushDotReporterState(state), "");
});

// killActiveChildGroups: orphan-prevention on external kill (SIGINT/SIGTERM/timeout).
// Root cause: killing test_parallel.ts's top-level process does NOT cascade to a `deno test`
// child's own children on Linux, so signaling the negative (process-group) pid is required.

Deno.test("[killActiveChildGroups] signals every tracked pid as a negative (process-group) target", () => {
  const signaled: number[] = [];
  killActiveChildGroups([111, 222, 333], (pid) => signaled.push(pid));
  assertEquals(signaled, [-111, -222, -333]);
});

Deno.test("[killActiveChildGroups] a throw from one pid's kill does not stop the rest", () => {
  const signaled: number[] = [];
  killActiveChildGroups([111, 222, 333], (pid) => {
    signaled.push(pid);
    if (pid === -222) throw new Error("ESRCH: No such process");
  });
  assertEquals(signaled, [-111, -222, -333]);
});

Deno.test("[killActiveChildGroups] an empty pid set signals nothing (no-op, never throws)", () => {
  const signaled: number[] = [];
  killActiveChildGroups([], (pid) => signaled.push(pid));
  assertEquals(signaled, []);
});

Deno.test("parseSummaryLine handles failed batch summaries with step counts", () => {
  const summaryLine = "FAILED | 4420 passed (966 steps) | 1 failed (1 step) | 12 ignored (1m21s)";

  assertMatch(
    summaryLine,
    /^(?:ok|FAILED)\s*\|\s*\d+\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*\d+\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*\d+\s+ignored)?\s*\((?:\d+ms|\d+s|\d+m\d+s)\)$/,
  );

  assertEquals(
    parseSummaryLine(summaryLine),
    {
      passed: 4420,
      failed: 1,
      ignored: 12,
      durationSec: 81,
    },
  );
});

Deno.test("test_output_parse is the single source and test_parallel re-exports the parsers unchanged", () => {
  assertEquals(parseTapOutput, testOutputParse.parseTapOutput);
  assertEquals(extractTapFailures, testOutputParse.extractTapFailures);
  assertEquals(parseDotReporterCounts, testOutputParse.parseDotReporterCounts);
  assertEquals(parseSummaryLine, testOutputParse.parseSummaryLine);
});

// --- Batch-2 classification ---

/** The Batch-2 file list pinned before the classification change. Order is authoritative. */
const EXPECTED_SEQUENTIAL_FILES = [
  "apps/exactl/tests/exactl_all_test.ts",
  "tests/scenario_framework/tests/unit/learning_effectiveness_live_test.ts",
  "tests/security/calibration_sandbox_test.ts",
  "tests/scenario_framework/tests/portal_knowledge_strategies_scenario_test.ts",
  "apps/daemon/tests/deploy_workspace_test.ts",
  "tests/integration/cli_commands_test.ts",
  "tests/integration/agent/mcp_handshake_test.ts",
  "tests/scenario_framework/tests/plan_amendment_scenario_test.ts",
  "tests/integration/config_cutover_daemon_boot_test.ts",
  "tests/integration/config_integrity_daemon_boot_test.ts",
  "tests/integration/execution_verification_cutover_test.ts",
  "tests/integration/openai_compatible_daemon_cutover_test.ts",
  "tests/scenario_framework/tests/integration/openai_compatible_native_test.ts",
  "tests/scenario_framework/tests/integration/scenario_bindings_test.ts",
  "tests/scenario_framework/tests/integration/operator_override_axes_test.ts",
  "tests/scenario_framework/tests/integration/flow_step_model_bindings_test.ts",
  "tests/integration/dogfood_e2e_test.ts",
  "tests/integration/dogfood_crash_recovery_e2e_test.ts",
  "tests/integration/daemon_watcher_readiness_test.ts",
  "tests/migrations/migrate_db_test.ts",
  "packages/core/tests/child_env_test.ts",
  "tests/scripts/check_commit_msg_test.ts",
  "packages/ai/tests/model_resolver_determinism_test.ts",
  "packages/ai/tests/model_resolver_registry_test.ts",
  "packages/storage-sqlite/tests/test_mode_schema_test.ts",
  "tests/agents/build_agents_index_test.ts",
  "apps/exactl/tests/blueprint_commands_test.ts",
  "apps/daemon/tests/session_delegation_coordinator_test.ts",
  "packages/flow/tests/session_delegate_cycle_sequencing_test.ts",
  "apps/daemon/tests/health_check_service_test.ts",
  "apps/daemon/tests/dynamic_step_wiring_test.ts",
  "apps/daemon/tests/session_delegate_cycle_dogfood_e2e_test.ts",
  "apps/daemon/tests/readiness_test.ts",
  "tests/integration/agent_runner_daemon_cutover_test.ts",
  "tests/infra/build_test.ts",
  "tests/infra/exactl_edition_build_test.ts",
  "apps/daemon/tests/agent_role_cutover_e2e_test.ts",
  "tests/integration/model_registry_route_admit_live_test.ts",
  "tests/integration/model_registry_team_cost_source_test.ts",
  "tests/integration/model_registry_team_edition_sweep_test.ts",
  "tests/integration/model_registry_team_cutover_test.ts",
  "tests/integration/mcp_server_spec_compliance_cutover_test.ts",
  "tests/scripts/db_cache_schema_upgrade_test.ts",
  "tests/integration/daemon_net_policy_enforcement_test.ts",
  "tests/scenario_framework/tests/unit/assertions_evidence_test.ts",
  "tests/scenario_framework/tests/integration/self_hosted_split_bindings_test.ts",
  "tests/scenario_framework/tests/integration/binding_evidence_cli_test.ts",
  "tests/scenario_framework/tests/integration/memory_pipeline_test.ts",
  "apps/exactl/tests/commands/skill_commands_cli_test.ts",
  "packages/core/tests/skills/skill_folder_performance_test.ts",
];

Deno.test("SEQUENTIAL_FILES is unchanged in content and order after classification", () => {
  assertEquals(SEQUENTIAL_FILES, EXPECTED_SEQUENTIAL_FILES);
});

Deno.test("every SEQUENTIAL_TESTS entry names at least one isolation reason", () => {
  for (const test of SEQUENTIAL_TESTS) {
    assert(test.reasons.length >= 1, `${test.file} names no isolation reason`);
    assert(SequentialTestSchema.safeParse(test).success, `${test.file} fails SequentialTestSchema`);
  }
});

Deno.test("only the dist/bin writers are marked serializedOutput and the egress-dependent files are marked network", () => {
  const serialized = SEQUENTIAL_TESTS.filter((test) => test.serializedOutput).map((test) => test.file);
  assertEquals(serialized, ["tests/infra/build_test.ts", "tests/infra/exactl_edition_build_test.ts"]);
  const network = SEQUENTIAL_TESTS.filter((test) => test.network).map((test) => test.file);
  assertEquals(network, [
    "tests/scenario_framework/tests/unit/learning_effectiveness_live_test.ts",
    "tests/security/calibration_sandbox_test.ts",
    "apps/daemon/tests/deploy_workspace_test.ts",
    "tests/infra/build_test.ts",
    "tests/infra/exactl_edition_build_test.ts",
    "tests/integration/model_registry_route_admit_live_test.ts",
  ]);
});

// --- container-jobs CLI and result mapping ---

Deno.test("resolveContainerJobs parses the equals and spaced forms", () => {
  assertEquals(resolveContainerJobs([`${TEST_CONTAINER_JOBS_FLAG}=6`]), 6);
  assertEquals(resolveContainerJobs([TEST_CONTAINER_JOBS_FLAG, "6"]), 6);
  assertEquals(resolveContainerJobs(["--filter", "flow"]), undefined);
});

Deno.test("resolveContainerJobs rejects zero, negative, and non-numeric values", () => {
  assertThrows(() => resolveContainerJobs([`${TEST_CONTAINER_JOBS_FLAG}=0`]), Error);
  assertThrows(() => resolveContainerJobs([`${TEST_CONTAINER_JOBS_FLAG}=-2`]), Error);
  assertThrows(() => resolveContainerJobs([`${TEST_CONTAINER_JOBS_FLAG}=abc`]), Error);
  assertThrows(() => resolveContainerJobs([`${TEST_CONTAINER_JOBS_FLAG}=1.5`]), Error);
  assertThrows(() => resolveContainerJobs([TEST_CONTAINER_JOBS_FLAG]), Error);
});

Deno.test("the --test-container-jobs flag is stripped from the shared forwarded args (Parallel and Containered Batch)", () => {
  assertEquals(stripContainerJobsArgs([TEST_CONTAINER_JOBS_FLAG, "6", "--filter", "flow"]), ["--filter", "flow"]);
  assertEquals(stripContainerJobsArgs([`${TEST_CONTAINER_JOBS_FLAG}=6`, "--parallel"]), ["--parallel"]);
});

Deno.test("the --test-serial flag is stripped from the shared forwarded args and selects serial", () => {
  assertEquals(stripTestControlArgs([TEST_SERIAL_FLAG, "--filter", "flow"]), ["--filter", "flow"]);
  assertEquals(stripTestControlArgs([TEST_CONTAINER_JOBS_FLAG, "6", TEST_SERIAL_FLAG]), []);
  assertEquals(resolveTestSerial([TEST_SERIAL_FLAG]), true);
  assertEquals(resolveTestSerial(["--filter", "flow"]), false);
});

Deno.test("IContainerRunResult maps to a TestStats row and a failure block in allFailures", () => {
  const result: IContainerRunResult = {
    testFile: "tests/x_test.ts",
    passed: 3,
    failed: 1,
    ignored: 2,
    durationSec: 4,
    exitCode: 1,
    failureDetail: "boom",
  };
  const stats = containerResultToStats(result);
  assertEquals(stats.label, "Containered Batch – x_test.ts");
  assertEquals(stats.passed, 3);
  assertEquals(stats.failed, 1);
  assertEquals(stats.ignored, 2);
  assertEquals(stats.durationSec, 4);
  assertEquals(stats.exitCode, 1);
  const block = containerResultFailureBlock(result);
  assert(block !== null && block.includes("CONTAINERED BATCH: FAILURES (1 total)") && block.includes("boom"));
  assertEquals(containerResultFailureBlock({ ...result, exitCode: 0, failed: 0 }), null);
});

Deno.test("the container env is an explicit allowlist, never Deno.env.toObject(), and omits DENO_JOBS", () => {
  const env = buildContainerEnv({
    PATH: "/host/bin",
    TZ: "UTC",
    CI: "true",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    DENO_JOBS: "8",
    EXA_TEST_MODE: "1",
    LD_LIBRARY_PATH: "/host/lib",
    HOME: "/home/host",
  });
  assertEquals(env, {
    TZ: "UTC",
    CI: "true",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    [TEST_CONTAINER_REPORTER_ENV]: "pretty",
  });
  assert(!("DENO_JOBS" in env), "DENO_JOBS must never be forwarded");
  assert(!("PATH" in env) && !("HOME" in env), "host PATH/HOME must not leak into the container");
});

Deno.test("the worker container env tells the driver to use the Containered Batch reporter", () => {
  assertEquals(buildContainerEnv({ PATH: "/usr/bin" })[TEST_CONTAINER_REPORTER_ENV], "pretty");
});
