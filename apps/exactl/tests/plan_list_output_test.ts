/**
 * @module PlanListOutputTest
 * @path apps/exactl/tests/plan_list_output_test.ts
 * @description Runs `exactl plan list` through the real binary on a seeded workspace in the table, JSON and quiet formats.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/plan_command.ts, apps/exactl/src/output/exactl_output.ts]
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const PLAN_IDS = ["plan-alpha", "plan-beta", "plan-gamma"];

async function seedPlans(root: string): Promise<void> {
  const plans = join(root, "Workspace", "Plans");
  await Deno.mkdir(plans, { recursive: true });
  for (const id of PLAN_IDS) {
    await Deno.writeTextFile(
      join(plans, `${id}.md`),
      `---\ntrace_id: "trace-${id}"\nstatus: review\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\nsubject: Subject of ${id}\n---\n\n# Plan\n`,
    );
  }
}

Deno.test("plan list -o json prints the plans of a seeded workspace", async () => {
  const [json] = await runExactlSeededWorkspace(seedPlans, [["plan", "list", "-o", "json"]]);
  assertEquals(json.code, 0, json.stderr);
  const plans = JSON.parse(json.stdout) as Array<{ id: string; status: string }>;
  assertEquals(plans.map((plan) => plan.id).sort(), [...PLAN_IDS].sort());
  assertEquals(new Set(plans.map((plan) => plan.status)), new Set(["review"]));
});

Deno.test("plan list prints a table by default and one id per line with -q", async () => {
  const [table, quiet] = await runExactlSeededWorkspace(seedPlans, [["plan", "list"], ["plan", "list", "-q"]]);
  assertEquals(table.code, 0, table.stderr);
  for (const id of PLAN_IDS) assertStringIncludes(table.stdout, id);
  assertEquals(quiet.code, 0, quiet.stderr);
  assertEquals(quiet.stdout.trimEnd().split("\n").sort(), [...PLAN_IDS].sort());
});

Deno.test("plan list --json -o table exits 2 and prints nothing on stdout", async () => {
  const [run] = await runExactlSeededWorkspace(seedPlans, [["plan", "list", "--json", "-o", "table"]]);
  assertEquals(run.code, 2, run.stderr);
  assertEquals(run.stdout, "");
});

Deno.test("--no-color removes escape codes from help output that carries them by default", async () => {
  const [colored, plain] = await runExactlSeededWorkspace(seedPlans, [["plan", "list", "--help"], [
    "--no-color",
    "plan",
    "list",
    "--help",
  ]]);
  assertEquals(colored.code, 0, colored.stderr);
  assertEquals(plain.code, 0, plain.stderr);
  assertStringIncludes(colored.stdout, "\u001b[");
  assertFalse(plain.stdout.includes("\u001b"));
});

Deno.test("NO_COLOR removes escape codes from help output that carries them by default", async () => {
  Deno.env.set("NO_COLOR", "1");
  try {
    const [plain] = await runExactlSeededWorkspace(seedPlans, [["plan", "list", "--help"]]);
    assertEquals(plain.code, 0, plain.stderr);
    assertFalse(plain.stdout.includes("\u001b"));
  } finally {
    Deno.env.delete("NO_COLOR");
  }
});
