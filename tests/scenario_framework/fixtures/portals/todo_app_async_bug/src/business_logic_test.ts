// deno-lint-ignore-file
// original from todo_app fixture
import { assertEquals } from "jsr:@std/assert@1";
import { processBatchSubmissions, processTaskSubmission } from "./business_logic.ts";
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

Deno.test("processBatchSubmissions enforces 3-duplicate limit across the batch", async () => {
  const tasks: ITask[] = [];
  const results = await processBatchSubmissions(
    [
      { title: "Meeting", rawPriority: "low", dueDate: null, assignee: null },
      { title: "Meeting", rawPriority: "low", dueDate: null, assignee: null },
      { title: "Meeting", rawPriority: "low", dueDate: null, assignee: null },
      { title: "Meeting", rawPriority: "low", dueDate: null, assignee: null },
    ],
    () => Promise.resolve(tasks),
    async (task) => {
      tasks.push(task);
    },
  );
  const succeeded = results.filter((r) => r.success).length;
  // Without the fix, all 4 succeed (bug). With the fix, only 3 succeed.
  assertEquals(succeeded, 3, "Only 3 same-titled tasks should succeed in a batch");
});
