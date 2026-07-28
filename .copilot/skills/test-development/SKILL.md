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
version: "1.2.0"
topics: ["testing", "tdd", "coverage", "test-helpers", "assertion-sensitivity"]
qwen_skill: test-development
---

```text
Key points
- A test that cannot fail is worse than no test — it certifies the subsystem as
  covered and stops anyone looking again. Canary every test you write or edit:
  break the thing it names, confirm it goes red, restore (§Assertion
  sensitivity).
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

Assertion sensitivity — a test that cannot fail is worse than no test

  A tautological test is one whose assertion holds no matter what the code it
  names does. It is worse than missing coverage: absent coverage is visible in
  a coverage report and in review, whereas a green tautology certifies the
  subsystem as tested and stops anyone looking again. Every dimension in the
  next section is worthless if its assertions are insensitive.

  THE CANARY RULE — mandatory for every new or edited test

    Before you call a test done, break the thing it names and watch it go red.
    Delete the line, invert the condition, or drop the flag; re-run; restore.
    If the test stayed green, it is not testing what its name claims — fix the
    test, not the canary.

    This is not ceremony. In this repo the canary has repeatedly caught tests
    written by someone who had just finished reasoning carefully about the
    behaviour: a `git worktree add --detach` test passed with `--detach`
    deleted from the handler, because `git worktree add <path> <sha>` detaches
    on its own for a raw commit — the test re-asserted a git default and was
    blind to the flag it existed to pin. Rewriting it to pin through a BRANCH
    ref made the flag load-bearing and the canary red.

    Record the canary in the commit body or the test's docstring when the
    sensitivity is subtle (as above). The next reader cannot re-derive it.

  RED FROM TS2307 IS NOT ASSERTION EVIDENCE

    #tdd-workflow's RED phase accepts "module not found" as RED for a new
    source file. That proves the import path is wired — it says nothing about
    whether your assertions discriminate, because they never ran. Once the
    module exists, you still owe the canary: make the implementation wrong and
    confirm the assertion (not the import) fails.

    The same gap opens when adding tests to code that already works: there is
    no natural RED at all, so the canary is the ONLY evidence you will get.

  ANTI-PATTERN CATALOGUE — all seven have shipped in this repo

    1. Restating a constant against itself
       `assertEquals(ToolErrorCode.NOT_FOUND, "NOT_FOUND")` — an enum compared
       to its own member name. Passes whether or not any producer ever emits
       the value, and silently omits members added later. Assert that the
       value is PRODUCED and OBSERVED by real code, not that it is spelled the
       way it is spelled.

    2. Deriving the expectation from the input
       A parity gate that builds its expected list from the same ids it is
       checking changes both sides at once, so it can never fail. One such gate
       concealed thirteen wrong entity ids (underscores where the real flow ids
       use hyphens) for an entire phase. Read one side from disk (the shipped
       catalog, the real schema) and the other from the artefact under test.

    3. Asserting the test's own scaffolding
       A test that writes its own `try/finally` and then asserts the `finally`
       block ran has tested JavaScript, not this codebase. Same for asserting a
       fixture you just constructed has the fields you just set. Drive the
       production entry point and assert on ITS observable effect.

    4. Testing the runtime, the stdlib, or a third-party binary
       If the file imports nothing from `@exaix/*` (or a relative source
       module), ask what it is actually pinning. A "worktree lifecycle" test
       that shells out to raw `git` verifies that git works — meanwhile the
       handler that implements worktrees had zero coverage. Untested OUR code
       hides behind tested THEIR code.

    5. Assertions that are true by construction
       `assertEquals(Array.isArray(responses), true)` on a value declared as an
       array; `assert(typeof e === "string" || arr.length > 0)`, a disjunction
       satisfied by either branch; `assert(result !== undefined)` on a
       non-optional return. These read as diligence and assert nothing. Prefer
       one exact assertion over three vague ones.

    6. A name or docstring that outruns the body
       A module header claiming the file "validates that FlowRunner uses
       ModelResolver" in a file that imports no FlowRunner; a test named
       "malformed JSON produces parse error" that sends WELL-FORMED JSON and
       asserts it succeeds. Reviewers and later agents trust the name and never
       read the body, so the named branch stays untested indefinitely. The name
       is a claim — make the body honour it, or rename it.

    7. Zero-test files and assertion-free bodies
       A `*_test.ts` that registers no `Deno.test`, or a test body that is one
       comment ("no root-level exports to assert yet"). Both inflate the test
       count and pass forever. Delete them.

  SWEEPING AN EXISTING SUITE

    Run these over a test directory before trusting its coverage. Every hit is
    a CANDIDATE, not a verdict — verify each by reading it (helpers that assert
    internally, generic type parameters like `assertEquals<ModelSize>(...)`,
    and tests that legitimately spawn real processes all show up as noise):

      # files that register no test at all. Match BDD too — root tests/ uses
      # `describe`/`it` from @std/testing/bdd far more than Deno.test, so a
      # Deno.test-only grep reports ~15 false positives there. Project wrappers
      # (parallelSafeTest, cliTest) still need reading by eye.
      for f in $(rg -l "" -g "*_test.ts" <dir>); do \
        rg -q "Deno\.test|^\s*(it|test)\(" "$f" || echo "NO TESTS: $f"; done
      # test files importing nothing from our source
      rg -L --files-without-match "@exaix|from \"\.\./" -g "*_test.ts" <dir>
      # assertion-free bodies and always-true shapes
      rg -n "Array\.isArray\(|!== undefined\)|typeof .* === \"string\" \|\|" -g "*_test.ts" <dir>
      # a constant compared to its own name — needs grep -P; rg's Rust regex
      # engine has NO backreferences and errors out on \2
      grep -rPn --include="*_test.ts" 'assertEquals\(\s*(\w+)\.(\w+),\s*"\2"' <dir>

    Note that a file containing a raw NUL byte classifies as binary and is
    SKIPPED by rg/grep entirely — it will look like a zero-test file while
    holding many. Write `\0` as an escape, never as a literal byte.

    Run the whole set, not your favourite one. Each pattern above was added
    after an earlier sweep using the others missed a live instance: the
    constant-restatement grep alone found a SECOND copy of an already-deleted
    `ToolErrorCode` enum tautology in another file, invisible to the four
    detectors that had just been run over the same directories.

  WHEN YOU FIND ONE

    Do not delete on sight. A tautology is often the visible end of dead
    production code, and deleting it buries the real defect. Removing the
    `ToolErrorCode` enum test above exposed that the base class took the code
    as `_code` and never read it — roughly twenty handlers computed a
    classification that reached neither the response nor the journal.

    In order: (a) find what the test CLAIMS to cover; (b) check whether that
    production path is reachable and consumed at all; (c) if it is, write the
    sensitive test and canary it; (d) if it is not, fix or remove the dead path
    under #tdd-workflow (failing test first); (e) only then delete the
    tautology, and say in the commit what replaced it and where.

    When you delete a test file, grep for it — planning docs cite test paths as
    evidence for ✅ success criteria, and a deleted file leaves those claims
    dangling.

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
    keywords: [test, testing, coverage, tdd, unit-test, integration-test, tautology, flaky-assertion]
    task_types: [testing]
    tags: [testing]
  constraints:
    - "Use shared helpers (initTestDbService, createCliTestContext)"
    - "Place tests per package/app/root boundary"
    - "Label security tests [security]"
    - "Use EXA_TEST_* env vars"
    - "No raw SQL table creation in tests"
    - "Canary every new or edited test — break what it names, confirm red, restore"
    - "No tautologies: never restate a constant, derive the expectation from the input, assert the test's own scaffolding, or test the runtime instead of our code"
  output_requirements:
    - "Target test files created or modified"
    - "Helpers and patterns used"
    - "Test command and coverage check results"
    - "Canary evidence for each new assertion — what was broken and that it went red"
  quality_criteria:
    - name: placement_compliance
      description: Test placement follows boundaries
      weight: 20
    - name: helper_usage
      description: Shared helpers used instead of bespoke setup
      weight: 15
    - name: coverage_target
      description: Coverage met or verified
      weight: 15
    - name: edge_case_coverage
      description: Edge case dimensions (invalid input, integration paths,
        partial failure, round-trip, idempotency, cleanup) tested per
        mandatory dimensions section
      weight: 25
    - name: assertion_sensitivity
      description: Each assertion discriminates — canaried against a break in the
        code it names, no constant restatement, input-derived expectation,
        scaffolding assertion, or runtime/third-party testing, and no
        name/docstring claiming more than the body verifies
      weight: 25
---
```
