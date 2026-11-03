/**
 * @module GodObjectsPinTest
 * @path packages/lint-policy/tests/god_objects_pin_test.ts
 * @description Proves that the Exaix class-size rule stays on the legacy score until the god-class cutover.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/lint-policy/tests/rule_ceilings_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const RULE_ID = "exaix/max-class-size";
const TASK_NAME = "check:god-objects";
const REPORT_SCRIPT = "unslop-ts/src/cli/rule_report.ts";
const LEGACY_STRATEGY = "legacy-score";

interface IRuleReport {
  readonly selected: number;
  readonly total: number;
  readonly topFiles: readonly string[];
}

/** The arguments of the repository task after the report script, with the gate flag swapped for JSON output. */
async function reportArguments(): Promise<string[]> {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json")));
  const task: string = config.tasks[TASK_NAME];
  const rest = task.slice(task.indexOf(REPORT_SCRIPT) + REPORT_SCRIPT.length).trim().split(/\s+/);
  return [...rest.filter((argument) => argument !== "--fail"), "--json"];
}

Deno.test("legacy-pin-keeps-baseline: the compiled Exaix catalog pins max-class-size to the legacy strategy", () => {
  const options = POLICY_CATALOG.rules[RULE_ID].options;
  assertEquals(options?.strategy, LEGACY_STRATEGY);
});

Deno.test("legacy-pin-keeps-baseline: the god-objects task still reports weighted scores for the flagged classes", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-run",
      "--allow-read",
      "--allow-env",
      join(REPO_ROOT, REPORT_SCRIPT),
      ...await reportArguments(),
    ],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  assertEquals(result.code, 0, decoder.decode(result.stderr));
  const report: IRuleReport = JSON.parse(decoder.decode(result.stdout));
  assert(report.selected > 0, "the task flags no class, so the pin proves nothing");
  assert(report.total > 0, "a report without weighted scores means the task no longer runs the legacy strategy");
});
