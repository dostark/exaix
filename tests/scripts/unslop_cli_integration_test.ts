/**
 * @module UnslopCliIntegrationTest
 * @path tests/scripts/unslop_cli_integration_test.ts
 * @description The real constant-restatement task keeps its scoped read/env grants and descriptor input.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/unslop.project.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

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

Deno.test("exaix_unslop_cli_lists_59_rules_and_reports_a_seeded_violation", async () => {
  const listed = await runTask("unslop", ["rules", "list", "--format=json"]);
  assertEquals(listed.code, 0, listed.stderr);
  const rules = (JSON.parse(listed.stdout) as { rules: unknown[] }).rules;
  assertEquals(rules.length, 59);

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

Deno.test("inline_control_refusal_and_supported_edit_match_host", async () => {
  const configPath = join(REPO_ROOT, "unslop.config.json");
  const before = await Deno.readTextFile(configPath);
  const refused = await runTask(
    "unslop:write",
    ["rules", "disable", "package-instantiates-event-logger", "--reason=Not_used.", "--dry-run"],
  );
  assertEquals(refused.code, 2);
  assertStringIncludes(refused.stderr, "does not allow editing level");
  const supported = await runTask("unslop:write", ["rules", "set", "edition-leak", "soloTier=1", "--dry-run"]);
  assertEquals(supported.code, 0, supported.stderr);
  assertEquals(await Deno.readTextFile(configPath), before);
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
