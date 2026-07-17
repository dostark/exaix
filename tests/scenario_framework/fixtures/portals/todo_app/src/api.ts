/**
 * @module TodoAppApi
 * @path tests/scenario_framework/fixtures/portals/todo_app/src/api.ts
 * @description swe_tasks fixture portal: HTTP-style handlers over TaskRepository.
 *   There is no way to mark a task complete — the swe-add-feature-endpoint
 *   scenario's target is adding a PATCH /tasks/:id/complete handler.
 */

// deno-lint-ignore-file no-explicit-any
import type { ITask } from "./models.ts";
import { TaskRepository } from "./storage.ts";

export interface IRequest {
  body: any;
  params: Record<string, string>;
}

export interface IResponse {
  json(body: any): void;
  status(code: number): IResponse;
}

export function handleGetTask(repo: TaskRepository, req: IRequest, res: IResponse): void {
  const task = repo.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
}

export function handleListTasks(repo: TaskRepository, _req: IRequest, res: IResponse): void {
  res.json(repo.list());
}

export function handleCreateTask(repo: TaskRepository, req: IRequest, res: IResponse): void {
  const task: ITask = {
    id: crypto.randomUUID(),
    title: req.body.title,
    priority: req.body.priority ?? "medium",
    done: false,
    dueDate: req.body.dueDate ?? null,
    assignee: req.body.assignee ?? null,
  };
  repo.add(task);
  res.status(201).json(task);
}

// No handler exists yet for marking a task complete (PATCH /tasks/:id/complete).
