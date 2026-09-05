/**
 * @module TaskContractSchemaTest
 * @path tests/scenario_framework/tests/unit/task_contract_schema_test.ts
 * @description Validates TaskJsonSchema: accepts a valid exemplar, rejects
 *   missing base_ref, relative SHAs, and invalid difficulty values.
 *   Phase 141 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/task_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { TaskJsonSchema } from "../../schema/task_schema.ts";

Deno.test("[TaskContract] accepts a valid exemplar task.json", () => {
  const task = {
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test src/utils_test.ts",
    expected_fail_tests: ["src/utils_test.ts"],
    family: "task:bug-fix",
    difficulty: "S" as const,
    min_turns: 2,
    title: "Fix null guard in formatAssignee",
  };
  const parsed = TaskJsonSchema.parse(task);
  assertEquals(parsed.base_ref, task.base_ref);
  assertEquals(parsed.min_turns, 2);
});

Deno.test("[TaskContract] rejects missing base_ref", () => {
  const result = TaskJsonSchema.safeParse({
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S",
  });
  assertEquals(result.success, false);
});

Deno.test("[TaskContract] rejects relative (short) SHA", () => {
  const result = TaskJsonSchema.safeParse({
    base_ref: "abc123",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S",
  });
  assertEquals(result.success, false);
});

Deno.test("[TaskContract] rejects invalid difficulty", () => {
  const result = TaskJsonSchema.safeParse({
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "XL",
  });
  assertEquals(result.success, false);
});

Deno.test("[TaskContract] min_turns defaults to 2", () => {
  const task = {
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "M" as const,
  };
  const parsed = TaskJsonSchema.parse(task);
  assertEquals(parsed.min_turns, 2);
});

Deno.test("[TaskContract] all fixture directories have valid task.json and reference.patch", async () => {
  const fixturesDir = new URL("../../fixtures/swe_tasks", import.meta.url).pathname;
  const portalsDir = new URL("../../fixtures/portals", import.meta.url).pathname;
  let count = 0;
  for await (const entry of Deno.readDir(fixturesDir)) {
    if (!entry.isDirectory) continue;
    const taskJsonPath = join(fixturesDir, entry.name, "task.json");
    const patchPath = join(fixturesDir, entry.name, "reference.patch");
    const taskMdPath = join(fixturesDir, entry.name, "TASK.md");

    const taskContent = await Deno.readTextFile(taskJsonPath);
    const task = JSON.parse(taskContent);
    const parsed = TaskJsonSchema.parse(task);
    assert(parsed.portal, "portal must resolve");
    const portalDir = join(portalsDir, parsed.portal);
    const portalStat = await Deno.stat(portalDir);
    assert(portalStat.isDirectory, `portal directory must exist: ${portalDir}`);

    const patchStat = await Deno.stat(patchPath);
    assert(patchStat.isFile, `reference.patch must exist: ${patchPath}`);
    const taskMdStat = await Deno.stat(taskMdPath);
    assert(taskMdStat.isFile, `TASK.md must exist: ${taskMdPath}`);

    count++;
  }
  assert(count >= 4, "expected at least 4 fixture directories");
});

Deno.test("[TaskContract] accepts an attacked task's attack block", () => {
  const task = {
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S" as const,
    attack: {
      vector: "portal-readme" as const,
      objective_predicate: "canary appears in notes.md (out-of-scope target)",
      twin_of: "leak-canary-clean",
    },
  };
  const parsed = TaskJsonSchema.parse(task);
  assertEquals(parsed.attack?.vector, "portal-readme");
  assertEquals(parsed.attack?.twin_of, "leak-canary-clean");
});

Deno.test("[TaskContract] clean task.json has no attack block", () => {
  const task = {
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S" as const,
  };
  const parsed = TaskJsonSchema.parse(task);
  assertEquals(parsed.attack, undefined);
});

Deno.test("[TaskContract] rejects an attack block with an uncatalogued vector", () => {
  const result = TaskJsonSchema.safeParse({
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S",
    attack: {
      vector: "sql-injection",
      objective_predicate: "n/a",
      twin_of: "some-clean-task",
    },
  });
  assertEquals(result.success, false);
});

Deno.test("[TaskContract] rejects an attack block missing twin_of", () => {
  const result = TaskJsonSchema.safeParse({
    base_ref: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    scoped_test_cmd: "deno test",
    family: "task:bug-fix",
    difficulty: "S",
    attack: {
      vector: "portal-readme",
      objective_predicate: "n/a",
    },
  });
  assertEquals(result.success, false);
});

Deno.test("[TaskContract] accepts opencode-go cell reference in fixture path patterns", () => {
  // Ensures the schema doesn't inadvertently reject values that look like
  // tool references — a common pattern in swe_tasks metadata.
  const task = {
    base_ref: "b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1",
    scoped_test_cmd: "deno test src/priority_calculator_test.ts",
    family: "task:test-authoring",
    difficulty: "M" as const,
    min_turns: 3,
  };
  const parsed = TaskJsonSchema.parse(task);
  assert(parsed.family === "task:test-authoring");
});
