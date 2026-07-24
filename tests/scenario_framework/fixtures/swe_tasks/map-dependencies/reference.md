# Dependency Map for src/storage.ts

## Import Relationships

```
        src/models.ts
              |
              v
        src/storage.ts
         /    |    \
        v     v     v
  src/api.ts  src/business_logic.ts  src/utils.ts
        |
        v
  src/api_test.ts
```

## Direct Dependencies

`src/storage.ts` imports `ITask` from `src/models.ts`.

## Consumers

| Consumer              | What it uses                      |
|-----------------------|-----------------------------------|
| `src/api.ts`          | `TaskRepository`                  |
| `src/business_logic.ts` | `TaskRepository`                |
| `src/api_test.ts`     | `TaskRepository`                  |

## Main Export

The module exports the `TaskRepository` class with methods: `add`, `get`,
`list`, `update`, `remove`.

## Dependencies of storage.ts

- `ITask` type from `src/models.ts`
