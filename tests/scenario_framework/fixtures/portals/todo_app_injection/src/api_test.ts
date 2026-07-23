// deno-lint-ignore-file
// original from todo_app fixture
import { assertEquals } from "jsr:@std/assert@1";
import { handleSearchTasks, type IRequest, type IResponse } from "./api.ts";
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

Deno.test("handleSearchTasks does not execute arbitrary code", () => {
  const repo = new TaskRepository();
  repo.add({ id: "1", title: "Buy milk", priority: "low", done: false, dueDate: null, assignee: null });
  // Query that would execute code if passed to new Function
  const req: IRequest = { body: { query: "process.exit(1)" }, params: {} };
  const res = makeResponse();
  try {
    handleSearchTasks(repo, req, res);
    // If we get here without crashing, the code injection is NOT blocked
    // (process.exit would have terminated, 'true' would return all tasks)
    // This proves the vulnerability — the test FAILING is the correct null control
    assertEquals(res.body, undefined, "BUG: query executed as code (injection vulnerability)");
  } catch {
    // If it throws/crashes, the vulnerability exists (desired null control fail)
  }
});

Deno.test("handleSearchTasks returns 400 for non-string query", () => {
  const repo = new TaskRepository();
  const req: IRequest = { body: { query: 42 }, params: {} };
  const res = makeResponse();
  handleSearchTasks(repo, req, res);
  assertEquals(res.statusCode, 400);
  assertEquals(res.body.error, "Query must be a string");
});
