# @exaix/testing

Reusable testing helpers, fixtures, and mocks for Exaix package development.

## Role

`@exaix/testing` is the **shared testing surface** for all Exaix workspace members. It owns
helpers that are genuinely cross-cutting (used by multiple packages or apps) rather than
belonging to a single package's test support.

## Usage

Import shared helpers from `@exaix/testing`:

```ts
import { createStubContext, createStubDb, initTestDbService } from "@exaix/testing";
```

Or from subpaths:

```ts
import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";
```

## What it provides

| Export                | Description                         |
| --------------------- | ----------------------------------- |
| `createStubContext()` | Minimal `IApplicationContext` stub  |
| `createStubDb()`      | Minimal `IDatabaseService` stub     |
| `initTestDbService()` | Real SQLite test database + cleanup |
| Stub factories        | `createStubConfig`, etc.            |
| Test constants        | Shared test constants               |
| Env helpers           | `isCIMode`, `isTestMode` wrappers   |

## Consolidation target

As root `tests/` shrinks from ~267 files to ~70, remaining helpers from `tests/helpers/`
(and `tests/services/helpers/`) are being migrated into `@exaix/testing`:

- `tests/helpers/config.ts` → `@exaix/testing`
- `tests/helpers/mock_provider.ts` → `@exaix/testing`
- `tests/helpers/test_helpers.ts` → `@exaix/testing`
- `tests/services/helpers/` → `@exaix/testing`

This avoids deep imports from root `tests/` into package-local tests.

## When NOT to use this package

- If a helper is specific to one package's tests, keep it in `packages/<name>/tests/helpers/`.
- If a helper must be imported by external consumers, expose it via `@exaix/<package>/testing`
  (e.g., `@exaix/git/testing`, `@exaix/mcp/testing`, `@exaix/memory/testing`).
- Package-owned testing subpaths may depend on the owning package API plus
  `@exaix/testing` for shared helpers, but should not depend on unrelated runtime packages.
