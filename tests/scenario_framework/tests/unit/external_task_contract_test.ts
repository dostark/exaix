/**
 * @module ExternalTaskContractTest
 * @path tests/scenario_framework/tests/unit/external_task_contract_test.ts
 * @description Corpus-lint equivalent of task_contract_schema_test.ts, scoped to
 *   fixtures/external/terminal_bench/ (Phase 144 Step 1): validates the extended
 *   TaskJsonSchema (optional source block), confirms every vendored external task
 *   directory resolves to a real portal, and confirms the swe_tasks corpus lint is
 *   unaffected by the additive schema change.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/task_schema.ts, tests/scenario_framework/tests/unit/task_contract_schema_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { TaskJsonSchema } from "../../schema/task_schema.ts";

Deno.test("[ExternalTaskContract] accepts a valid task.json with a source block", () => {
  const parsed = TaskJsonSchema.parse({
    base_ref: "a".repeat(40),
    scoped_test_cmd: "cd /app && pytest tests/test_outputs.py -rA",
    family: "task:log-analysis",
    difficulty: "S",
    portal: "external/terminal_bench/log-summary",
    source: { benchmark: "terminal-bench", version: "abc123", task_id: "log-summary" },
  });
  assertEquals(parsed.source?.benchmark, "terminal-bench");
});

Deno.test("[ExternalTaskContract] rejects an invalid benchmark enum value in the source block", () => {
  const result = TaskJsonSchema.safeParse({
    base_ref: "a".repeat(40),
    scoped_test_cmd: "true",
    family: "task:log-analysis",
    difficulty: "S",
    source: { benchmark: "not-a-real-benchmark", version: "abc123", task_id: "x" },
  });
  assertEquals(result.success, false);
});

Deno.test("[ExternalTaskContract] source is absent by default (internal swe_tasks unaffected)", () => {
  const parsed = TaskJsonSchema.parse({
    base_ref: "a".repeat(40),
    scoped_test_cmd: "true",
    family: "task:bug-fix",
    difficulty: "S",
  });
  assertEquals(parsed.source, undefined);
});

Deno.test("[ExternalTaskContract] every vendored fixtures/external/terminal_bench task has a valid contract and a resolvable portal", async () => {
  const fixturesDir = new URL("../../fixtures/external/terminal_bench", import.meta.url).pathname;
  const portalsDir = new URL("../../fixtures/portals", import.meta.url).pathname;
  let count = 0;
  for await (const entry of Deno.readDir(fixturesDir)) {
    if (!entry.isDirectory) continue;
    count += 1;
    const taskDir = join(fixturesDir, entry.name);
    const taskJsonRaw = await Deno.readTextFile(join(taskDir, "task.json"));
    const parsed = TaskJsonSchema.parse(JSON.parse(taskJsonRaw));

    assert(parsed.source, `${entry.name}: external task must carry a source block`);
    assert(parsed.portal, `${entry.name}: portal must resolve`);
    const portalStat = await Deno.stat(join(portalsDir, parsed.portal));
    assert(portalStat.isDirectory, `${entry.name}: portal directory must exist: ${parsed.portal}`);

    const patchStat = await Deno.stat(join(taskDir, "reference.patch"));
    assert(patchStat.isFile, `${entry.name}: reference.patch must exist`);

    const taskMdStat = await Deno.stat(join(taskDir, "TASK.md"));
    assert(taskMdStat.isFile, `${entry.name}: TASK.md must exist`);
  }
  assert(count >= 1, "at least one external task must be vendored (the Step 1 exemplar)");
});
