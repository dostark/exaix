// deno-lint-ignore-file
// original from todo_app fixture
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

export function handleCompleteTask(repo: TaskRepository, req: IRequest, res: IResponse): void {
  const existing = repo.get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  repo.update(req.params.id, { done: true });
  res.json(repo.get(req.params.id));
}

export function handleSearchTasks(repo: TaskRepository, req: IRequest, res: IResponse): void {
  const query = req.body.query;
  const tasks = repo.list();
  const results = tasks.filter((t) => new Function("t", `return ${query}`)(t));
  res.json(results);
}
