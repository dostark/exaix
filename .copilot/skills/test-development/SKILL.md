---
name: test-development
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: test
title: "Test Development Skill (#test-development)"
description: Write tests following Exaix conventions — helpers, placement, patterns, CI
short_summary: "Write tests for Exaix using the right helpers, placement rules, and patterns."
version: "1.1.0"
topics: ["testing", "tdd", "coverage", "test-helpers"]
qwen_skill: test-development
---

```text
Key points
- Happy-path-only tests miss integration bypasses, partial-failure states,
  and malformed-input crashes — cover the 6 edge case dimensions (§Edge case
  coverage requirements) for every feature that takes input, crosses subsystem
  boundaries, or composes multiple operations.

See also
  Test directory structure   →  [tests/README.md](../../tests/README.md)
  Shared test helpers        →  [packages/testing/README.md](../../packages/testing/README.md)
  Integration test framework →  [tests/integration/README.md](../../tests/integration/README.md)
  Scenario / eval framework  →  [tests/scenario_framework/README.md](../../tests/scenario_framework/README.md)
  Coding style rules         →  [CODE_STYLE.md](../../../CODE_STYLE.md)

Unified test helpers (prefer these over bespoke setup):
  - initTestDbService()      — DatabaseService + tempdir setup
  - createCliTestContext()   — CLI test with DB + tempdir, call cleanup() in afterEach
  - withEnv()                — Temporary env var changes
  - TestEnvironment.create() — Full workspace/DB/git scaffold for integration tests
  - MockLLMProvider          — Deterministic LLM responses (avoid real API calls)

Mocking: use MockLLMProvider for deterministic agent testing. Avoid real API calls.
Integration: use TestEnvironment.create() to scaffold full workspace/DB structures.
Leases: file locking integration tests live in tests/execution_loop_test.ts.
Database: use initTestDbService() for DatabaseService tests. Prefer
  initActivityTableSchema() for reconnection tests. No raw SQL CREATE TABLE in tests.
CLI tests: use createCliTestContext(), call cleanup() in afterEach.

Canonical prompt (short):
"Write tests for {feature}. Use initTestDbService() or createCliTestContext()
where appropriate. Follow the test target map below for file placement."

Test target map (deterministic source-to-test)

  packages/<name>/src/...  →  packages/<name>/tests/...
  apps/<name>/src/...      →  apps/<name>/tests/... or tests/integration/...
  scripts/...              →  tests/scripts/...
  Cross-package integration  →  tests/integration/...
  Scenario / evaluation    →  tests/scenario_framework/...

  Enforced by deno task check:test-placement — treat violations as blocking.

Mandatory placement rules
  - All new *test.ts files must live under tests/ or packages/<name>/tests/
  - Never add *test.ts under scripts/, docs/, or other non-tests/ roots
  - Service tests live under tests/services/<domain>/, not directly under tests/services/
  - Before creating a new test, search for existing domain folder and place there

Coverage-Driven TDD
  Target ≥70% branch coverage on new features. Run deno task test:coverage.

Edge case coverage requirements — mandatory test dimensions

  Every feature that accepts user input, crosses subsystem boundaries, or
  composes multiple operations MUST include tests for each applicable dimension
  below. A plan step whose Planned Tests cover only the happy path is
  incomplete — missing edge case dimensions are 🟠 Testing gaps.

  1. **Invalid / malformed input**
     Test every CLI argument, config value, and data field with values at the
     boundary of its type: NaN and negative numbers for numeric fields, empty
     strings for text fields, out-of-bounds values for constrained fields,
     missing required fields. Assert the error is surfaced clearly, not as a
     silent NaN or confusing internal message.

  2. **Integration paths (features A + B together)**
     When two features interact (e.g. key locking + profile-scoped keys, or
     integrity checksum + rollback), write at least one test that exercises
     the combined path. A test that proves each feature works in isolation
     does NOT prove they work together — the integration surface is where
     bypasses and data-flow gaps hide.

  3. **Partial-failure / mid-operation failure**
     For multi-step operations (e.g. config edit applies N lines, batch
     import, staged apply), test the case where step K of N fails. Assert
     that preceding steps are either rolled back or clearly reported to the
     user, and that no silent partial state remains.

  4. **Round-trip fidelity**
     For any serialisation path (config value → rendered string → parsed
     value, or object → JSON → deserialised), test that a value survives
     a full round-trip unchanged. Special attention to types that lose
     fidelity on serialisation (numbers vs strings, null vs undefined, JSON
     strings with embedded quotes).

  5. **Idempotency / stability**
     For operations that should be stable or idempotent (checksum computation,
     sorting, diff generation), assert that repeated calls with identical
     input produce identical output. A test that only checks "changed when
     input changed" misses the "unchanged when input unchanged" guarantee.

  6. **Resource cleanup**
     For any operation that creates temporary files, subprocesses, or DB
     transactions, verify cleanup on both success and failure paths (including
     exceptions). Use `try/finally` or `using` — a missing cleanup is a
     resource leak regardless of whether the happy path test passes.

Live-daemon subprocess teardown — mandatory precautions

  Any test that boots a real `apps/daemon/main.ts` subprocess (directly via
  `Deno.Command`, via `bootRealDaemon()`, or indirectly via `exactl daemon
  start`/`restart`) MUST guarantee the daemon process is dead before the test
  function returns — on every exit path, not just the happy path. Two
  independent orphan-daemon bugs were found and fixed by this exact failure
  mode (2026-07-21, `scripts/test_parallel.ts` and
  `tests/integration/cli_commands_test.ts`); both looked identical at the
  process-list level: a daemon subprocess still running with its own tempDir
  already deleted (confirmed via `readlink /proc/<pid>/cwd` showing
  `(deleted)`) — proof the test's `finally` ran and tore down the filesystem
  state but never touched the daemon process itself.

  - **Every `daemon start`/`restart` call needs a matching `daemon stop`.**
    `restart` intentionally leaves a daemon running — that's its whole
    contract. A test that calls `start`/`restart` and then ends (even via a
    generic `finally { await env.cleanup() }`) leaks a daemon, because
    `TestEnvironment.cleanup()`/`initTestDbService()`'s cleanup only close
    the DB and remove the tempDir — neither has any awareness of a process
    the test itself spawned via the CLI. Add the final stop explicitly:
    `finally { await runExactl(["daemon", "stop"], env.tempDir).catch(() => {}); await env.cleanup(); }`

  - **A direct `Deno.Command` daemon spawn needs `try/finally` with both a
    kill AND an awaited status**, not just a kill. Pattern:
    `const proc = new Deno.Command(...).spawn(); try { /* test body */ }
    finally { try { Deno.kill(proc.pid, "SIGTERM"); } catch {} try { await
    proc.status; } catch {} }`
    Sending the signal without awaiting `proc.status` risks the test
    function returning (and the next test starting) before the daemon has
    actually exited — prefer `bootRealDaemon()`
    (`tests/integration/helpers/daemon_config.ts`) for this pattern; it
    already implements it correctly.

  - **A timer-based kill (`setTimeout(() => proc.kill(...), ms)`) racing
    `await proc.output()`/`proc.status` is not a teardown guarantee.** If the
    awaited promise resolves for any reason other than "the process actually
    exited" (e.g. its stdio streams closed early), the function can return
    while the daemon subprocess is still alive with nothing left tracking
    it. Await the process's own exit status directly, not a proxy for it.

  - **A daemon-booting test's own subprocess tree is not proof against a
    hostile top-level kill.** On Linux, killing a process does NOT cascade
    to that process's own children — so a daemon booted by a `deno test`
    file, which is itself a child of a test-runner script (`test_parallel.ts`
    → `deno test` batch → daemon subprocess), survives if something kills
    the runner script from outside (Ctrl-C, a CI/harness timeout) even
    though the individual test's own `try/finally` is written correctly.
    This class of gap is fixed once at the runner level, not per-test: see
    `scripts/test_parallel.ts`'s `detached: true` spawn + `killActiveChildGroups()`
    (group-wide `SIGTERM` via `Deno.kill(-pid, ...)`) for the pattern, and
    only replicate it if you're writing a new test-runner/orchestration
    script, not in individual test files.

  - **Verify with the real diagnostic, not just "tests passed."** A green
    test run proves nothing about daemon leaks — check directly:
    `pgrep -af "apps/daemon/main.ts"` before and immediately after the run
    (a clean baseline first is required, or a pre-existing leak gets
    misattributed to the run under test). If a daemon survives, confirm
    it's really orphaned (not mid-teardown) via
    `readlink /proc/<pid>/cwd` (shows `(deleted)` once its tempDir is gone)
    and `ps -o pid,ppid,pgid,etime -p <pid>` (`PPID 1` or `PPID` matching
    the OS init process means it was already reparented — a real orphan,
    not a race).

Advanced testing patterns
  - Refactoring & Duplication: use npx jscpd packages apps tests to find duplicated
    test setup code. Extract helpers (GitTestHelper, ToolRegistryTestHelper).
  - Paranoid Security Testing: write tests for path traversal, command injection,
    symlink escapes. Whitelists beat blacklists.
  - Performance Testing: don't guess — measure. Write benchmarks or load tests.

Security Tests as First-Class Citizens
  Every security boundary needs explicit tests. Label with [security].
  Cover path traversal, shell injection, network exfiltration, env leakage.
  Run: deno task test:security.

Test Organization (root tests/)
  tests/cli/         CLI command tests
  tests/services/    Service unit tests
  tests/integration/ End-to-end workflows
  tests/helpers/     Shared test utilities

Deduplication checklist
  1. Search for similar test file names
  2. Compare test case names for duplicates
  3. Merge unique cases into canonical location
  4. Delete duplicate files

Test environment variables (EXA_TEST_* prefix)

  EXA_TEST_MODE             Test environment indicator
  EXA_TEST_CLI_MODE         CLI test mode indicator
  EXA_TEST_ENABLE_PAID_LLM  Opt-in for paid API tests in CI
  EXA_TEST_ENABLE_OLLAMA    Enable Ollama integration tests
  EXA_TEST_ENABLE_LLAMA     Enable Llama provider tests
  EXA_TEST_LLM_MODEL        Override model for tests
  EXA_TEST_OPENAI_API_KEY   OpenAI API key for integration tests

  Use helpers from @exaix/core/config/env_schema.ts:

  import { isTestMode, isCIMode } from "@exaix/core/config/env_schema.ts";
  if (isTestMode()) { /* skip timers */ }
  if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) { /* skip paid */ }

  Best practices:
  - Use isTestMode() instead of DENO_TEST or EXA_TEST_MODE directly
  - Use isCIMode() instead of CI or EXA_CI_MODE directly
  - Never use legacy env vars (DENO_TEST, EXACTL_TEST_MODE) in new code

CI pitfalls
  - Treat CI as truthy (CI=true on GitHub Actions), not strictly "1"
  - Paid LLM providers disabled unless EXA_TEST_ENABLE_PAID_LLM=1
  - Avoid compiled binaries. Prefer:
    new Deno.Command(Deno.execPath(), { args: ["run", "--allow-all", ...] })

Output format
  1. Target file(s) — test files created or modified
  2. Helpers used — initTestDbService, createCliTestContext, etc.
  3. Test command — how to run
  4. Coverage check — deno task test:coverage result

Examples
  #test-development Add unit tests for PlanWriter error handling
  #test-development Write security tests for file path validation
  #test-development Create integration test for workspace bootstrap flow
```

```
---
exaix:
  skill_id: test-development
  triggers:
    keywords: [test, testing, coverage, tdd, unit-test, integration-test]
    task_types: [testing]
    tags: [testing]
  constraints:
    - "Use shared helpers (initTestDbService, createCliTestContext)"
    - "Place tests per package/app/root boundary"
    - "Label security tests [security]"
    - "Use EXA_TEST_* env vars"
    - "No raw SQL table creation in tests"
  output_requirements:
    - "Target test files created or modified"
    - "Helpers and patterns used"
    - "Test command and coverage check results"
  quality_criteria:
    - name: placement_compliance
      description: Test placement follows boundaries
      weight: 25
    - name: helper_usage
      description: Shared helpers used instead of bespoke setup
      weight: 20
    - name: coverage_target
      description: Coverage met or verified
      weight: 20
    - name: edge_case_coverage
      description: Edge case dimensions (invalid input, integration paths,
        partial failure, round-trip, idempotency, cleanup) tested per
        mandatory dimensions section
      weight: 35
---
```
