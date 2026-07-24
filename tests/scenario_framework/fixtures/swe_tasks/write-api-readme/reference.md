# API Module

The `src/api.ts` module provides HTTP-style handler functions that operate
on a `TaskRepository` instance.

## Interfaces

### `IRequest`

- `body: any` — Request payload
- `params: Record<string, string>` — URL parameters

### `IResponse`

- `json(body: any): void` — Send JSON response
- `status(code: number): IResponse` — Set HTTP status code

## Handlers

### `handleGetTask(repo, req, res)`

Returns a single task by ID. Responds with 404 if not found.

### `handleListTasks(repo, req, res)`

Returns all tasks as an array.

### `handleCreateTask(repo, req, res)`

Creates a new task from request body. Returns 201.

## Usage Example

```typescript
const repo = new TaskRepository();
handleCreateTask(repo, { body: { title: "Buy milk" }, params: {} }, res);
// res.statusCode === 201
// repo.list().length === 1
```
