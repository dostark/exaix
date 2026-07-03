# Integration Tests — `tests/integration/`

Integration tests exercise multiple Exaix packages with real wiring. They live
under `tests/integration/` and **must** use the shared `TestEnvironment` helper
at `tests/integration/helpers/test_environment.ts`.

## File Naming Convention

Test file names follow this structure:

```text
{domain}_{feature}_{type}_test.ts
```

- **domain** — the system or area under test (e.g. `dogfood`, `delegation`, `portal`, `daemon`, `quality_gate`)
- **feature** — the specific scenario or capability (e.g. `smoke`, `e2e`, `crash_recovery`, `net_policy_enforcement`)
- **type** (optional) — distinguishes files that would otherwise collide (e.g. `e2e`, `smoke`, `regression`)

**Rules:**

1. **No number prefixes.** The deprecated `NN_description_test.ts` pattern (`01_happy_path_test.ts`) is replaced by descriptive names. Number prefixes do not indicate ordering or priority; use the name itself to convey purpose.
2. **Domain first, then specificity.** Start with the broad area, narrow down. This groups related files together alphabetically.
3. **Lowercase with underscores** (`_`). No hyphens, no mixed case.

**Examples:**

| ✅ Good                                   | ❌ Bad                               |
| ----------------------------------------- | ------------------------------------ |
| `dogfood_smoke_test.ts`                   | `01_happy_path_test.ts`              |
| `portal_multilang_extraction_e2e_test.ts` | `NN_description_test.ts`             |
| `quality_gate_e2e_test.ts`                | `description_without_domain_test.ts` |
| `daemon_net_policy_enforcement_test.ts`   | `misc_test.ts`                       |

All existing files have been renamed to follow this convention. New tests **must not** use number prefixes.

## Mandatory Rule: Use `TestEnvironment`

Every integration test **must** scaffold its workspace through
`TestEnvironment.create()`. This single method provides:

| Resource       | What it gives you                                   |
| -------------- | --------------------------------------------------- |
| `env.tempDir`  | Isolated temp directory (auto‑cleaned on cleanup)   |
| `env.config`   | Typed `Config` object with mock provider            |
| `env.db`       | Running `DatabaseService` (SQLite, journal enabled) |
| Git repo       | Initialized git repo with `.gitignore`              |
| Directory tree | `Workspace/Requests`, `Workspace/Plans`, `Memory/`  |
| TOML config    | `exa.config.toml` on disk for CLI / daemon use      |

**Always use `TestEnvironment.create()`.** Do not call `Deno.makeTempDir`,
`initTestDbService`, or write TOML config strings manually in integration
tests — the helper already does all of this.

```typescript
// ✅ CORRECT — always use TestEnvironment
const env = await TestEnvironment.create();
try {
  // test code
} finally {
  await env.cleanup();
}
```

## Available Methods

All methods are documented with JSDoc in `test_environment.ts`. Quick reference:

### Setup & Teardown

| Method                     | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `TestEnvironment.create()` | Create a fresh workspace + DB                 |
| `env.cleanup()`            | Close DB, remove temp dir (call in `finally`) |

### Workspace I/O

Use these instead of `Deno.readDir`, `Deno.readTextFile`, etc. They correctly
resolve paths relative to `env.tempDir`.

| Method                                    | Replaces                             |
| ----------------------------------------- | ------------------------------------ |
| `env.fileExists("Workspace/Plans/...")`   | `Deno.stat(join(env.tempDir, ...))`  |
| `env.readFile("Workspace/Plans/...")`     | `Deno.readTextFile(join(...))`       |
| `env.writeFile("Workspace/...", content)` | `Deno.writeTextFile(join(...))`      |
| `env.listFiles("Workspace/Plans")`        | `for await (e of Deno.readDir(...))` |

### Blueprints & Requests

| Method                                        | Purpose                            |
| --------------------------------------------- | ---------------------------------- |
| `env.createBlueprint("senior-coder")`         | Write identity blueprint to disk   |
| `env.createRequest("description", opts)`      | Write request `.md` to `Requests/` |
| `env.createFlowRequest("desc", flowId, opts)` | Write flow request `.md`           |

`createRequest` returns `{ filePath, traceId }` — use `traceId` later to
correlate plans.

### Request Processing

| Method                                     | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| `env.createRequestProcessor()`             | Build `MockLLMProvider` + `RequestProcessor` |
| `env.createMockProvider(mode, recordings)` | Standalone `MockLLMProvider`                 |
| `processor.process(requestPath)`           | Returns plan path or `null`                  |

Configurable via `createRequestProcessor({ providerMode, recordings, includeReasoning })`.

### Plan & Activity

| Method                               | Purpose                               |
| ------------------------------------ | ------------------------------------- |
| `env.createPlan(traceId, requestId)` | Simulate plan file creation           |
| `env.approvePlan(planPath)`          | Move plan to `Workspace/Active/`      |
| `env.rejectPlan(planPath, reason)`   | Move plan to `Workspace/Rejected/`    |
| `env.getPlanByTraceId(traceId)`      | Find plan by trace_id in frontmatter  |
| `env.getActivityLog(traceId)`        | Query journal entries for a trace     |
| `env.injectFailureMarker(planPath)`  | Insert "Intentionally fail" into plan |

### Polling & Wait

| Method                                          | Purpose                            |
| ----------------------------------------------- | ---------------------------------- |
| `env.waitFor(condition, { timeout, interval })` | Poll async condition up to timeout |

```typescript
const found = await env.waitFor(
  async () => {
    const files = await env.listFiles("Workspace/Plans");
    return files.some((f) => f.endsWith("_plan.md"));
  },
  { timeout: 30_000, interval: 1_000 },
);
```

### Execution Loop

| Method                                | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `env.createExecutionLoop(identityId)` | Build `ExecutionLoop` for tests |

### Portal

| Method                            | Purpose                     |
| --------------------------------- | --------------------------- |
| `env.setupPortal({ alias, ... })` | Create test portal with git |

## Standard Patterns

### Request → Plan (in-process, no daemon)

```typescript
Deno.test("my feature: request generates plan", async (t) => {
  const env = await TestEnvironment.create();
  try {
    await env.createBlueprint("senior-coder");
    const { processor } = env.createRequestProcessor();

    const { filePath, traceId } = await env.createRequest(
      "Add a health endpoint",
      { identityId: "senior-coder", priority: 5 },
    );

    const planPath = await processor.process(filePath);
    assertExists(planPath, "Plan should be generated");

    const content = await Deno.readTextFile(planPath);
    assertStringIncludes(content, traceId);
  } finally {
    await env.cleanup();
  }
});
```

### Polling for Plans (daemon subprocess)

When testing the daemon as a subprocess, use `env.waitFor` to poll for plan
appearance rather than looping with `Deno.readDir`:

```typescript
let planPath: string | undefined;
const found = await env.waitFor(
  async () => {
    const files = await env.listFiles("Workspace/Plans");
    for (const f of files) {
      if (!f.endsWith("_plan.md")) continue;
      const content = await env.readFile(`Workspace/Plans/${f}`);
      if (content.includes(traceId)) {
        planPath = join(env.tempDir, "Workspace", "Plans", f);
        return true;
      }
    }
    return false;
  },
  { timeout: 30_000, interval: 1_000 },
);
```

### Daemon Subprocess (when needed)

Only start a daemon subprocess when the test specifically needs
`FileWatcher`-driven request processing. Prefer the in-process
`processor.process()` pattern above whenever possible.

```typescript
const proc = new Deno.Command("deno", {
  args: ["run", "--allow-all", "apps/daemon/main.ts"],
  stdin: "null",
  stdout: "null", // must be null — piped stdout blocks the daemon
  stderr: "null", // must be null — piped stderr blocks the daemon
  env: {
    EXA_CONFIG_PATH: configPath,
    EXA_TEST_MODE: "1",
  },
}).spawn();
```

## Forbidden Patterns

| ❌ Don't do this                                         | ✅ Do this instead                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `Deno.makeTempDir()` + manual cleanup                    | `TestEnvironment.create()` + cleanup                                  |
| `initTestDbService()` (for integration tests)            | `TestEnvironment.create()`                                            |
| `Deno.readDir(join(env.tempDir, "Workspace", "Plans"))`  | `env.listFiles("Workspace/Plans")`                                    |
| `Deno.readTextFile(join(env.tempDir, "Workspace", ...))` | `env.readFile("Workspace/...")`                                       |
| `Deno.Command` with piped stdout/stderr for subprocess   | `stdout: "null", stderr: "null"`                                      |
| Hand‑written TOML config strings in test files           | Use existing `test_environment.ts` config or write only the overrides |
| `crypto.randomUUID()` for trace IDs                      | `env.createRequest()` returns traceId                                 |
| Manual polling loops with `Deno.readDir`                 | `env.waitFor()`                                                       |
| Skipping `env.cleanup()` in `finally`                    | Always call `env.cleanup()`                                           |

## What the TestEnvironment Configures

`TestEnvironment.create()` sets:

- **Provider:** `mock` (`gpt-5.2-pro`) — no real LLM calls
- **Quality gate:** `enabled = false` — avoids spurious rejections
- **Watcher:** `debounce_ms = 200`, `stability_check = true` (override via configOverrides for faster tests)
- **Portals:** a default workspace portal for portal‑aware tests
- **Paths:** all standard workspace subdirectories

If your test needs different settings, pass `configOverrides` to `create()`:

```typescript
const env = await TestEnvironment.create({
  configOverrides: { watcher: { debounce_ms: 50, stability_check: false } },
});
```

## Daemon‑Specific Config Sections

If you must overwrite the TOML config on disk (e.g. for daemon subprocess
tests), write a complete config file using `writeDaemonConfig` or similar.
Do NOT append to the existing config — TOML parsers may reject duplicate
tables.

## See Also

- `tests/integration/helpers/test_environment.ts` — full implementation
- `tests/integration/dogfood_smoke_test.ts` — example: in-process request→plan
- `tests/integration/dogfood_e2e_test.ts` — example: daemon subprocess→plan
- `tests/README.md` — overall test structure and placement rules
- `.copilot/docs/testing.md` — agent‑facing test patterns
