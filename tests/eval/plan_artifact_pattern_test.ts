/**
 * @module PlanArtifactPatternTest
 * @path tests/eval/plan_artifact_pattern_test.ts
 * @description Guards the one plan-artifact filename the runtime actually produces.
 *   `PlanWriter.generatePlanFilename` emits `${requestId}_plan.md` and the daemon's plan
 *   watcher filters on `_plan.md`, yet 12 scenarios waited on `**\/*_plan.yaml` — a pattern
 *   nothing ever writes, so those steps could only ever time out. They were all
 *   provider-live and therefore never ran in CI, which is why the drift survived.
 * @architectural-layer Test
 * @dependencies [packages/core/src/planning/plan_writer.ts]
 * @related-files [tests/scenario_framework/scenarios/, apps/daemon/main.ts]
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { walk } from "@std/fs";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SCENARIOS_DIR = join(REPO_ROOT, "tests", "scenario_framework", "scenarios");
const PLAN_WRITER = join(REPO_ROOT, "packages", "core", "src", "planning", "plan_writer.ts");

/** The only plan-artifact suffix the runtime writes. */
const PLAN_SUFFIX = "_plan.md";

Deno.test("plan_artifact_pattern — PlanWriter still emits the suffix scenarios rely on", async () => {
  const source = await Deno.readTextFile(PLAN_WRITER);
  assertEquals(
    source.includes(`${"$"}{requestId}${PLAN_SUFFIX}`),
    true,
    `PlanWriter no longer emits "${PLAN_SUFFIX}" — every scenario waiting on that pattern is now broken`,
  );
});

Deno.test("plan_artifact_pattern — no scenario waits on a plan suffix nothing writes", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(SCENARIOS_DIR, { exts: [".yaml", ".yml"], includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    for (const [index, line] of text.split("\n").entries()) {
      // Any `_plan.<ext>` reference where the extension is not `md`.
      const match = line.match(/_plan\.(\w+)/);
      if (match && match[1] !== "md") {
        offenders.push(`${entry.path.slice(SCENARIOS_DIR.length + 1)}:${index + 1} -> _plan.${match[1]}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `scenarios reference a plan suffix the runtime never writes (expected "${PLAN_SUFFIX}"):\n${offenders.join("\n")}`,
  );
});
