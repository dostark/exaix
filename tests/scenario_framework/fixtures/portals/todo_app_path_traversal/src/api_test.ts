// deno-lint-ignore-file
// original from todo_app fixture
/**
 * @module TodoAppApiTest
 * @path src/api_test.ts
 * @description swe_tasks fixture portal: baseline coverage for the existing API handlers.
 *   The swe-add-feature-endpoint scenario adds a new handler alongside these — must not
 *   break them.
 */

// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "jsr:@std/assert@1";
import { handleCreateTask, handleGetTask, handleListTasks, type IRequest, type IResponse } from "./api.ts";
import { TaskRepository } from "./storage.ts";

function makeResponse(): IResponse & { statusCode: number; body: any } {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
    },
  };
  return res;
}

Deno.test("handleCreateTask stores and returns a 201 with the new task", () => {
  const repo = new TaskRepository();
  const req: IRequest = { body: { title: "Buy milk", priority: "high" }, params: {} };
  const res = makeResponse();

  handleCreateTask(repo, req, res);

  assertEquals(res.statusCode, 201);
  assertEquals(res.body.title, "Buy milk");
  assertEquals(repo.list().length, 1);
});

Deno.test("handleGetTask returns 404 for a missing task", () => {
  const repo = new TaskRepository();
  const req: IRequest = { body: {}, params: { id: "missing" } };
  const res = makeResponse();

  handleGetTask(repo, req, res);

  assertEquals(res.statusCode, 404);
});

Deno.test("handleListTasks returns every stored task", () => {
  const repo = new TaskRepository();
  repo.add({ id: "1", title: "A", priority: "low", done: false, dueDate: null, assignee: null });
  repo.add({ id: "2", title: "B", priority: "low", done: false, dueDate: null, assignee: null });
  const req: IRequest = { body: {}, params: {} };
  const res = makeResponse();

  handleListTasks(repo, req, res);

  assertEquals(res.body.length, 2);
});
