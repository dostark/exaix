/**
 * @module TodoAppStorageTest
 * @path src/storage_test.ts
 * @description swe_tasks fixture portal: baseline coverage for TaskRepository, kept
 *   green across every scenario so a delegate's change must not break storage.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { TaskRepository } from "./storage.ts";
import type { ITask } from "./models.ts";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t1",
    title: "Buy milk",
    priority: "low",
    done: false,
    dueDate: null,
    assignee: null,
    ...overrides,
  };
}

Deno.test("add + get round-trips a task", () => {
  const repo = new TaskRepository();
  repo.add(makeTask());
  assertEquals(repo.get("t1")?.title, "Buy milk");
});

Deno.test("list returns all added tasks", () => {
  const repo = new TaskRepository();
  repo.add(makeTask({ id: "t1" }));
  repo.add(makeTask({ id: "t2", title: "Walk dog" }));
  assertEquals(repo.list().length, 2);
});

Deno.test("update merges changes and preserves other fields", () => {
  const repo = new TaskRepository();
  repo.add(makeTask());
  const updated = repo.update("t1", { done: true });
  assertEquals(updated?.done, true);
  assertEquals(updated?.title, "Buy milk");
});

Deno.test("update on missing id returns undefined", () => {
  const repo = new TaskRepository();
  assertEquals(repo.update("missing", { done: true }), undefined);
});

Deno.test("remove deletes the task", () => {
  const repo = new TaskRepository();
  repo.add(makeTask());
  assertEquals(repo.remove("t1"), true);
  assertEquals(repo.get("t1"), undefined);
});
