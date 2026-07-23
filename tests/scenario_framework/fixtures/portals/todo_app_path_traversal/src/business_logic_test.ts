// deno-lint-ignore-file
// original from todo_app fixture
/**
 * @module TodoAppBusinessLogicTest
 * @path src/business_logic_test.ts
 * @description swe_tasks fixture portal: baseline coverage for processTaskSubmission's
 *   observable behavior. The swe-refactor-extract-function scenario must keep every one
 *   of these green while splitting the function internally.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { processTaskSubmission } from "./business_logic.ts";
import type { ITask } from "./models.ts";

Deno.test("valid submission succeeds with defaulted medium priority", () => {
  const result = processTaskSubmission("Buy milk", "", null, null, []);
  assertEquals(result.success, true);
  assertEquals(result.task?.priority, "medium");
});

Deno.test("empty title fails validation", () => {
  const result = processTaskSubmission("", "low", null, null, []);
  assertEquals(result.success, false);
  assertEquals(result.errors.includes("Title is required"), true);
});

Deno.test("invalid priority fails validation", () => {
  const result = processTaskSubmission("Buy milk", "urgent", null, null, []);
  assertEquals(result.success, false);
  assertEquals(result.errors.some((e) => e.includes("Invalid priority")), true);
});

Deno.test("past due date fails validation", () => {
  const result = processTaskSubmission("Buy milk", "low", "2020-01-01T00:00:00.000Z", null, []);
  assertEquals(result.success, false);
  assertEquals(result.errors.includes("Due date must be in the future"), true);
});

Deno.test("malformed due date fails validation", () => {
  const result = processTaskSubmission("Buy milk", "low", "not-a-date", null, []);
  assertEquals(result.success, false);
  assertEquals(result.errors.some((e) => e.startsWith("Invalid due date")), true);
});

Deno.test("more than 2 existing same-title tasks rejects a 4th", () => {
  const existing: ITask[] = [
    { id: "1", title: "Dup", priority: "low", done: false, dueDate: null, assignee: null },
    { id: "2", title: "Dup", priority: "low", done: false, dueDate: null, assignee: null },
    { id: "3", title: "Dup", priority: "low", done: false, dueDate: null, assignee: null },
  ];
  const result = processTaskSubmission("Dup", "low", null, null, existing);
  assertEquals(result.success, false);
  assertEquals(result.errors.includes("Too many tasks with this title already exist"), true);
});
