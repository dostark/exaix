/**
 * @module UnslopCliIntegrationTest
 * @path packages/lint-policy/tests/unslop_cli_integration_test.ts
 * @description The real constant-restatement task keeps its scoped read/env grants and descriptor input.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/unslop.project.ts]
 */

import { assert, assertEquals, assertFalse, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { POLICY_COMPILED } from "../src/policy_config.ts";
import { checkRepository as checkConstantRestatement } from "../../../unslop-ts/src/rules/whole_tree/constant_restatement.ts";
import { checkRepository as checkOptionalParams } from "../../../unslop-ts/src/rules/whole_tree/optional_params.ts";
import { checkRepository as checkUnusedExports } from "../../../unslop-ts/src/rules/whole_tree/unused_exports.ts";
import { withTempDir } from "@exaix/testing";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

Deno.test("constant_restatement_descriptor_preserves_scoped_permissions", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  const task = config.tasks["check:constant-restatement"];
  assertStringIncludes(task, "--allow-read");
  assertStringIncludes(task, "--allow-env");
  assertStringIncludes(task, "--descriptor=packages/lint-policy/unslop.project.ts");
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "check:constant-restatement"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});

interface ITaskResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runTask(task: string, args: readonly string[]): Promise<ITaskResult> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", task, ...args],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

/** Assert the CLI lists exactly the compiled rule set, without a hard-coded count. */
function assertListsCompiledRules(stdout: string): void {
  const listed = (JSON.parse(stdout) as { rules: Array<{ id: string }> }).rules;
  const ids = listed.map((rule) => rule.id);
  assertEquals(ids.length, Object.keys(POLICY_COMPILED.rules).length);
  for (const id of Object.keys(POLICY_COMPILED.rules)) {
    assertEquals(ids.includes(id), true, id);
  }
}

Deno.test("exaix_unslop_cli_lists_the_compiled_rules_and_reports_a_seeded_violation", async () => {
  const listed = await runTask("unslop", ["rules", "list", "--format=json"]);
  assertEquals(listed.code, 0, listed.stderr);
  assertListsCompiledRules(listed.stdout);

  const fixture = join(REPO_ROOT, "scripts", ".report_fixture.ts");
  try {
    await Deno.writeTextFile(fixture, "export let value: unknown = 1;\n");
    const reported = await runTask("lint:report", ["--format=json", "scripts/.report_fixture.ts"]);
    assertEquals(reported.code, 1, reported.stderr);
    const report = JSON.parse(reported.stdout) as {
      completion: string;
      filesObserved: string[];
      findings: { ruleId: string; file: string }[];
      rules: { rule: { id: string }; observedChecked: number; coverage: string }[];
    };
    assertEquals(report.completion, "complete");
    assert(report.filesObserved.includes("scripts/.report_fixture.ts"));
    assert(report.findings.some((finding) => finding.file === "scripts/.report_fixture.ts"));
    const observed = report.rules.filter((rule) => rule.observedChecked > 0);
    assert(observed.length > 0);
    assert(observed.some((rule) => rule.coverage === "complete" || rule.coverage === "partial"));
    const moduleHeader = report.rules.find((rule) => rule.rule.id === "exaix/require-module-header");
    assert(moduleHeader);
    assertEquals(moduleHeader.observedChecked, 1);
  } finally {
    await Deno.remove(fixture);
  }
});

Deno.test("all_not_run_commands_resolve_in_the_consumer", async () => {
  const expected: Record<string, string> = {
    "duplicate-type": "check:style",
    "duplicate-constant": "check:magic",
    "magic-literals": "check:magic",
    "constant-restatement": "check:constant-restatement",
    "unused-exports": "check:unused-exports",
    "optional-params": "check:optional-params",
  };
  for (const [id, task] of Object.entries(expected)) {
    const shown = await runTask("unslop", ["rules", "show", id, "--format=json"]);
    assertEquals(shown.code, 0, `${id}: ${shown.stderr}`);
    const command = (JSON.parse(shown.stdout) as { rule: { command: string[] } }).rule.command;
    assertEquals(command, ["deno", "task", task], id);
  }
  const fixture = join(REPO_ROOT, "scripts", ".not_run_fixture.ts");
  try {
    await Deno.writeTextFile(fixture, "export const value = 1;\n");
    const reported = await runTask("lint:report", ["--format=json", "scripts/.not_run_fixture.ts"]);
    assert(reported.code === 0 || reported.code === 1, reported.stderr);
    const notRun = (JSON.parse(reported.stdout) as {
      notRun: { id: string; command: string[]; mode: string }[];
    }).notRun;
    for (const [id, task] of Object.entries(expected)) {
      const row = notRun.find((entry) => entry.id === id);
      assert(row, id);
      assertEquals(row.command, ["deno", "task", task], id);
      assertEquals(row.mode, "default", id);
    }
  } finally {
    await Deno.remove(fixture);
  }
});

Deno.test("consumer_tasks_use_exact_report_and_write_grants", async () => {
  const listed = await runTask("unslop", ["rules", "list", "--format=json"]);
  assertEquals(listed.code, 0, listed.stderr);
  const readOnlyEdit = await runTask("unslop", ["rules", "set", "duplicate-type", "minProperties=2"]);
  assertEquals(readOnlyEdit.code, 2);
  const dryRun = await runTask("unslop:write", ["rules", "set", "duplicate-type", "minProperties=2", "--dry-run"]);
  assertEquals(dryRun.code, 0, dryRun.stderr);

  const output = join(REPO_ROOT, "scripts", ".report_output.json");
  try {
    const refused = await runTask("lint:report", ["--format=json", "--out=scripts/.report_output.json", "scripts"]);
    assertEquals(refused.code, 2);
    assertEquals(await exists(output), false);
    const written = await runTask(
      "lint:report:write",
      ["--format=json", "--out=scripts/.report_output.json", "scripts"],
    );
    assertEquals(written.code, 0, written.stderr);
    assertEquals(await exists(output), true);
  } finally {
    await Deno.remove(output).catch(() => {});
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

const RUNNING_IN_PARALLEL_BATCH = Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") === "1";

Deno.test({
  name: "inline_control_refusal_and_supported_edit_match_host",
  ignore: RUNNING_IN_PARALLEL_BATCH,
  fn: async () => {
    const configPath = join(REPO_ROOT, "unslop.config.json");
    const before = await Deno.readTextFile(configPath);
    const refused = await runTask(
      "unslop:write",
      ["rules", "disable", "package-instantiates-event-logger", "--reason=Not_used.", "--dry-run"],
    );
    assertEquals(refused.code, 2);
    assertStringIncludes(refused.stderr, "does not allow editing level");
    const magicFixture = join(REPO_ROOT, "packages", "lint-policy", "edit_magic_fixture.ts");
    try {
      await Deno.writeTextFile(
        magicFixture,
        Array.from({ length: 8 }, (_, index) => `export const v${index} = 12345;`).join("\n"),
      );
      const beforeHost = await runTask("check:magic", []);
      assertEquals(beforeHost.code, 1, beforeHost.stderr);
      const supported = await runTask("unslop:write", ["rules", "set", "magic-literals", "checkNumbers=false"]);
      assertEquals(supported.code, 0, supported.stderr);
      assertNotEquals(await Deno.readTextFile(configPath), before);
      const afterHost = await runTask("check:magic", []);
      assertEquals(afterHost.code, 0, afterHost.stderr);
    } finally {
      await Deno.writeTextFile(configPath, before);
      await Deno.remove(magicFixture).catch(() => {});
    }
    const dryRun = await runTask("unslop:write", ["rules", "set", "edition-leak", "soloTier=1", "--dry-run"]);
    assertEquals(dryRun.code, 0, dryRun.stderr);
    assertEquals(await Deno.readTextFile(configPath), before);
  },
});

Deno.test("configured_options_reach_four_whole_tree_sections", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "unslop.config.json"))) as {
    rules: Record<string, { options?: Record<string, unknown> }>;
  };
  assert(config.rules["magic-literals"].options);
  assert(config.rules["optional-params"].options);
  assert(config.rules["unused-exports"].options);
  assert(config.rules["constant-restatement"].options);
  for (const task of ["check:magic", "check:optional-params", "check:unused-exports", "check:constant-restatement"]) {
    const result = await runTask(task, []);
    assertEquals(result.code, 0, `${task}: ${result.stderr}`);
  }
});

Deno.test("final_report_and_management_path", async () => {
  const listed = await runTask("unslop", ["rules", "list", "--format=json"]);
  assertEquals(listed.code, 0, listed.stderr);
  assertListsCompiledRules(listed.stdout);
  const config = await runTask("unslop", ["config", "print"]);
  assertEquals(config.code, 0, config.stderr);
  const parked = join(REPO_ROOT, "scripts", ".final_parked.ts");
  const broken = join(REPO_ROOT, "scripts", ".final_broken.ts");
  try {
    await Deno.writeTextFile(parked, "export interface Foo { x: string; }\n");
    const report = await runTask(
      "lint:report",
      ["--format=json", "--select=exaix/exported-interface-naming", "scripts/.final_parked.ts"],
    );
    assertEquals(report.code, 1, report.stderr);
    const parsed = JSON.parse(report.stdout) as {
      findings: { ruleId: string; effectiveLevel: string }[];
    };
    assert(
      parsed.findings.some((finding) =>
        finding.ruleId === "exaix/exported-interface-naming" && finding.effectiveLevel === "error"
      ),
    );
    await Deno.writeTextFile(broken, "export const = ;\n");
    const failed = await runTask("lint:report", ["--format=json", "scripts/.final_broken.ts"]);
    assertEquals(failed.code, 1, failed.stderr);
    assertEquals((JSON.parse(failed.stdout) as { completion: string }).completion, "failed");
  } finally {
    await Deno.remove(parked).catch(() => {});
    await Deno.remove(broken).catch(() => {});
  }
});

Deno.test("final_gate_and_cli_equivalence", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  for (
    const task of [
      "check:style",
      "check:magic",
      "check:constant-restatement",
      "check:unused-exports",
      "check:optional-params",
    ]
  ) {
    assert(config.tasks[task]);
    assertFalse(config.tasks[task].includes("catalog.json"));
  }
  const result = await runTask("check:constant-restatement", []);
  assertEquals(result.code, 0, result.stderr);
});

const REPORT_BENCH_WARMUP_RUNS = 1;
const REPORT_BENCH_SAMPLE_PAIRS = 5;
const REPORT_BENCH_MAX_RATIO = 2;
const BENCH_FILE = "packages/lint-policy/src/policy_config.ts";

const BENCH_ENV: Record<string, string> = Object.fromEntries(
  Object.entries(Deno.env.toObject()).filter(([name]) =>
    !name.startsWith("LD_") && !name.startsWith("DYLD_") && !name.startsWith("DEMO_") && !name.startsWith("EXAIX_")
  ),
);

async function timeCommand(args: readonly string[]): Promise<{ ms: number; bytes: number; code: number }> {
  const start = performance.now();
  const result = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd: REPO_ROOT,
    env: BENCH_ENV,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { ms: performance.now() - start, bytes: result.stdout.length + result.stderr.length, code: result.code };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

Deno.test("matched_host_report_benchmark_records_equivalent_samples", async () => {
  const absolute = join(REPO_ROOT, BENCH_FILE);
  const config = join(REPO_ROOT, "deno.json");
  const raw = ["lint", "--json", `--config=${config}`, absolute];
  const report = ["task", "lint:report", "--format=table", absolute];
  for (let index = 0; index < REPORT_BENCH_WARMUP_RUNS; index++) {
    await timeCommand(raw);
    await timeCommand(report);
  }
  const rawSamples: number[] = [];
  const reportSamples: number[] = [];
  const samples: {
    raw: { ms: number; bytes: number; code: number };
    report: { ms: number; bytes: number; code: number };
  }[] = [];
  for (let index = 0; index < REPORT_BENCH_SAMPLE_PAIRS; index++) {
    const first = index % 2 === 0 ? await timeCommand(raw) : await timeCommand(report);
    const second = index % 2 === 0 ? await timeCommand(report) : await timeCommand(raw);
    const rawSample = index % 2 === 0 ? first : second;
    const reportSample = index % 2 === 0 ? second : first;
    rawSamples.push(rawSample.ms);
    reportSamples.push(reportSample.ms);
    assertEquals(reportSample.code, rawSample.code);
    samples.push({ raw: rawSample, report: reportSample });
  }
  const ratio = median(reportSamples) / median(rawSamples);
  console.log(JSON.stringify({ reportBenchmark: { samples, ratio, maxRatio: REPORT_BENCH_MAX_RATIO } }));
  assert(ratio <= REPORT_BENCH_MAX_RATIO, `report median ratio ${ratio}`);
});

Deno.test("configured_options_reach_four_whole_tree_sections", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.mkdir(join(dir, "tests"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "constants.ts"), 'export const HOSTS = ["a.test", "b.test"];\n');
    await Deno.writeTextFile(join(dir, "tests", "hosts_test.ts"), "export const FLAG = 'a.test,b.test';\n");
    const restatement = {
      constantModules: ["src/constants.ts"],
      testRoots: ["tests"],
      minRestatedElements: 2,
    };
    assert((await checkConstantRestatement(dir, restatement)).length > 0);
    assert((await checkConstantRestatement(dir, { ...restatement, minRestatedElements: 3 })).length === 0);

    await Deno.writeTextFile(join(dir, "src", "optional.ts"), "export function f(value?: number) { return value; }\n");
    const optional = {
      wrapperType: "Opt",
      wrapperImport: "@demo/types",
      reasonExamples: ["OptionalInput"],
      testSegments: ["tests/"],
      testSuffixes: ["_test.ts"],
      skipSegments: [],
      walkSkipSegments: [],
      pluginRuleId: "demo/require-optional",
    };
    assert((await checkOptionalParams(dir, false, optional)).length > 0);
    assert((await checkOptionalParams(dir, false, { ...optional, skipSegments: ["src/optional.ts"] })).length === 0);

    await Deno.writeTextFile(join(dir, "src", "unused.ts"), "export const neverUsed = 1;\n");
    const unused = {
      productionRoots: ["src"],
      testSegments: ["tests"],
      testSuffixes: ["_test.ts"],
      entrypointSuffixes: ["mod.ts"],
      mainEntrypointSuffixes: ["main.ts"],
      scriptRoot: "scripts",
      walkSkipPatterns: [],
      strictSkipPrefixes: [],
      strictSkipSegments: [],
    };
    assert((await checkUnusedExports(dir, false, unused)).findings.length > 0);
    assert((await checkUnusedExports(dir, false, { ...unused, productionRoots: ["other"] })).findings.length === 0);
  }, { prefix: "whole_tree_options_" });
});
