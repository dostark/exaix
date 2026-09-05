/**
 * @module TodoAppUtilsTest
 * @path src/utils_test.ts
 * @description swe_tasks fixture portal: baseline tests for utils.ts's null-safe display
 *   formatting helpers, shared across every swe_tasks scenario using this fixture.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { formatAssignee, formatDueDate, formatTaskSummary } from "./utils.ts";
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

Deno.test("formatAssignee does not throw for an unassigned task", () => {
  assertEquals(formatAssignee(makeTask()), "");
});

Deno.test("formatAssignee still formats a present assignee", () => {
  const task = makeTask({ assignee: { id: "u1", name: "ada", email: "ada@example.com" } });
  assertEquals(formatAssignee(task), "ADA");
});

Deno.test("formatDueDate does not throw for a task with no due date", () => {
  assertEquals(formatDueDate(makeTask()), "");
});

Deno.test("formatDueDate still formats a present due date", () => {
  const task = makeTask({ dueDate: "2030-01-15T00:00:00.000Z" });
  assertEquals(formatDueDate(task), "2030-01-15");
});

Deno.test("formatTaskSummary marks a done task", () => {
  assertEquals(formatTaskSummary(makeTask({ done: true, title: "Buy milk" })), "[x] Buy milk (low)");
});
