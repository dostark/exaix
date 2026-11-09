/**
 * @module GlobalOptionPositionTest
 * @path apps/exactl/tests/global_option_position_test.ts
 * @description Runs each global option before the command and after the verb through the real binary and compares stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/exactl.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const PLAN_ID = "plan-position";
const COMMAND = ["plan", "list"];
const GLOBAL_OPTIONS: ReadonlyArray<readonly string[]> = [["-o", "json"], ["--json"], ["-q"], ["--yes"]];

async function seedPlan(root: string): Promise<void> {
  const plans = join(root, "Workspace", "Plans");
  await Deno.mkdir(plans, { recursive: true });
  await Deno.writeTextFile(
    join(plans, `${PLAN_ID}.md`),
    `---\ntrace_id: "trace-${PLAN_ID}"\nstatus: review\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\nsubject: Position\n---\n\n# Plan\n`,
  );
}

Deno.test("a global option before the command and after the verb gives identical stdout", async () => {
  const argsList = GLOBAL_OPTIONS.flatMap((option) => [[...option, ...COMMAND], [...COMMAND, ...option]]);
  const runs = await runExactlSeededWorkspace(seedPlan, argsList);
  GLOBAL_OPTIONS.forEach((option, index) => {
    const leading = runs[index * 2];
    const trailing = runs[index * 2 + 1];
    assertEquals(leading.code, 0, `${option.join(" ")} leading: ${leading.stderr}`);
    assertEquals(trailing.code, 0, `${option.join(" ")} trailing: ${trailing.stderr}`);
    assertEquals(leading.stdout, trailing.stdout, option.join(" "));
  });
});
