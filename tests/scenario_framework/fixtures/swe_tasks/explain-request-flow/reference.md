# Request Processing Flow

## Entry Point

Requests enter the system through handler functions in `src/api.ts`. Each
handler receives an `IRequest` object containing `body` (the payload) and
`params` (URL parameters), plus an `IResponse` object used to send back
results.

```typescript
export interface IRequest {
  body: any;
  params: Record<string, string>;
}

export interface IResponse {
  json(body: any): void;
  status(code: number): IResponse;
}
```

## Processing Layer

`TaskRepository` in `src/storage.ts` provides in-memory storage with
CRUD operations. It stores tasks as `Map<string, ITask>` internally.

```typescript
export class TaskRepository {
  add(task: ITask): void { ... }
  get(id: string): ITask | undefined { ... }
  list(): ITask[] { ... }
  update(id: string, changes: Partial<ITask>): ITask | undefined { ... }
  remove(id: string): boolean { ... }
}
```

## Response Cycle

A complete request flow:

1. Handler receives `IRequest` with task data in `body`
2. Handler creates or updates a task via `TaskRepository`
3. Handler uses `IResponse` to send back status code and JSON body

```typescript
export function handleCreateTask(repo, req, res) {
  const task = { id: crypto.randomUUID(), ...req.body };
  repo.add(task);
  res.status(201).json(task);
}
```
