/**
 * @module MemoryCorpusLintTest
 * @path tests/scenario_framework/tests/unit/memory_corpus_lint_test.ts
 * @description RED-first tests for Phase 148 Step 1's `lintMemoryTaskCorpus` (ci-core,
 * agent-free): ability-conditional ground-truth enforcement (non-abstention tasks need
 * >=1 ground-truth id per query; abstention tasks need exactly 0) over a memory
 * task-fixture corpus. Exercised against hand-built temp corpora and the real fixture
 * corpus. Mirrors `corpus_lint_test.ts`'s shape.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/memory_corpus_lint.ts, tests/scenario_framework/schema/memory_task_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { lintMemoryTaskCorpus } from "../../runner/memory_corpus_lint.ts";

interface ITestQuery {
  text?: string;
  ground_truth_ids?: string[];
  expected_answer?: string;
}

interface ITestMemoryTaskFixture {
  ability?: string;
  session_writes?: Array<{ id?: string; title?: string; content?: string }>;
  queries?: ITestQuery[];
}

async function writeMemoryTask(dir: string, id: string, task: ITestMemoryTaskFixture): Promise<void> {
  const taskDir = join(dir, id);
  await Deno.mkdir(taskDir, { recursive: true });
  await Deno.writeTextFile(join(taskDir, "task.json"), JSON.stringify(task, null, 2));
}

const VALID_UUID = "aaaaaaaa-0000-4000-8000-000000000001";

const VALID_INFO_EXTRACTION_TASK: ITestMemoryTaskFixture = {
  ability: "information-extraction",
  session_writes: [{ id: VALID_UUID, title: "Rate limiter", content: "The rate limiter resets on a full restart." }],
  queries: [{ text: "rate limiter resets on a full restart", ground_truth_ids: [VALID_UUID] }],
};

Deno.test("[MemoryCorpusLint] accepts a well-formed non-abstention task", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeMemoryTask(root, "info-basic", VALID_INFO_EXTRACTION_TASK);
    const result = await lintMemoryTaskCorpus([root]);
    assertEquals(result.errors, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryCorpusLint] flags a non-abstention task with a query missing ground-truth ids", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeMemoryTask(root, "info-missing-gt", {
      ability: "information-extraction",
      session_writes: [{ id: VALID_UUID, title: "x", content: "y" }],
      queries: [{ text: "y", ground_truth_ids: [] }],
    });
    const result = await lintMemoryTaskCorpus([root]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].includes("info-missing-gt"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryCorpusLint] accepts an abstention task with zero ground-truth ids", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeMemoryTask(root, "abstention-basic", {
      ability: "abstention",
      session_writes: [{ id: VALID_UUID, title: "x", content: "y" }],
      queries: [{ text: "a fact never stored", ground_truth_ids: [] }],
    });
    const result = await lintMemoryTaskCorpus([root]);
    assertEquals(result.errors, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryCorpusLint] flags an abstention task whose query has non-empty ground-truth ids", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeMemoryTask(root, "abstention-bad", {
      ability: "abstention",
      session_writes: [{ id: VALID_UUID, title: "x", content: "y" }],
      queries: [{ text: "y", ground_truth_ids: [VALID_UUID] }],
    });
    const result = await lintMemoryTaskCorpus([root]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].includes("abstention-bad"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryCorpusLint] flags a task.json that fails schema validation", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeMemoryTask(root, "broken", { ability: "not-a-real-ability" });
    const result = await lintMemoryTaskCorpus([root]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].includes("broken"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryCorpusLint] the real fixtures/memory corpus is clean", async () => {
  const memoryFixturesDir = new URL("../../fixtures/memory", import.meta.url).pathname;
  const result = await lintMemoryTaskCorpus([memoryFixturesDir]);
  assertEquals(result.errors, []);
});
