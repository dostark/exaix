# @exaix/testing

Reusable testing helpers, fixtures, and mocks for Exaix package development.

## Usage

Import shared helpers from `@exaix/testing` or subpaths such as:

```ts
import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";
```

This package is intended for helper utilities needed by package-local tests without importing root test fixtures or helpers from `tests/`.
