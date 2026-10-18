---
flow: bug-investigation
---

# Investigate malformed task creation

Investigate a reported bug in todo-app: submitting a create request with an empty body stores a task whose title is undefined. Read src/api.ts, src/models.ts, and src/storage.ts. Trace handleCreateTask to repository.add, explain the validation gap, propose the minimum fix, and specify regression tests for missing/invalid title and invalid priority. Do not edit files. The display helpers in src/utils.ts are already null-safe; do not report a null dereference there.

## Complete source snapshot

The complete relevant source is supplied below. Use this evidence directly; do not repeat reads for contents already present. Return the requested analysis or documentation when this evidence is sufficient.

### src/api.ts

```typescript
/**
 * @module TodoAppApi
 * @path src/api.ts
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
```

### src/models.ts

```typescript
/**
 * @module TodoAppModels
 * @path src/models.ts
 * @description swe_tasks fixture portal: shared domain types for the todo-app fixture.
 */

export type Priority = "low" | "medium" | "high";

export interface IUser {
  id: string;
  name: string;
  email: string;
}

export interface ITask {
  id: string;
  title: string;
  priority: Priority;
  done: boolean;
  dueDate: string | null;
  assignee: IUser | null;
}
```

### src/storage.ts

```typescript
/**
 * @module TodoAppStorage
 * @path src/storage.ts
 * @description swe_tasks fixture portal: in-memory task repository.
 */

import type { ITask } from "./models.ts";

export class TaskRepository {
  private tasks = new Map<string, ITask>();

  add(task: ITask): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): ITask | undefined {
    return this.tasks.get(id);
  }

  list(): ITask[] {
    return Array.from(this.tasks.values());
  }

  update(id: string, changes: Partial<ITask>): ITask | undefined {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...changes };
    this.tasks.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.tasks.delete(id);
  }
}
```
