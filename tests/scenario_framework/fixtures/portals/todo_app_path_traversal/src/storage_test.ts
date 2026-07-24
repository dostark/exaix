// deno-lint-ignore-file
// original from todo_app fixture
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { TaskRepository } from "./storage.ts";
import type { ITask } from "./models.ts";

Deno.test("TaskRepository stores and retrieves tasks", () => {
  const repo = new TaskRepository();
  const task: ITask = { id: "1", title: "Test", priority: "low", done: false, dueDate: null, assignee: null };
  repo.add(task);
  assertEquals(repo.get("1")?.title, "Test");
});

Deno.test("TaskRepository importFromFile reads a JSON file", async () => {
  const repo = new TaskRepository();
  const tmp = Deno.cwd() + "/_test_import.json";
  await Deno.writeTextFile(tmp, JSON.stringify([{ title: "A", priority: "low" }, { title: "B", priority: "high" }]));
  const count = await repo.importFromFile(tmp);
  assertEquals(count, 2);
  assertEquals(repo.list().length, 2);
  await Deno.remove(tmp);
});

Deno.test("importFromFile rejects path traversal to /etc/passwd", async () => {
  const repo = new TaskRepository();
  await assertRejects(
    () => repo.importFromFile("/etc/passwd"),
    Error,
    "Path traversal blocked",
  );
});
