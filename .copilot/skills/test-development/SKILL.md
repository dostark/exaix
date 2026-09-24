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
version: "1.3.0"
topics: ["testing", "tdd", "coverage", "test-helpers", "assertion-sensitivity"]
qwen_skill: test-development
---

```text
Key points

- A test that cannot fail is worse than no test — it certifies the subsystem as covered
  and stops anyone looking again. Canary every test: break what it names, confirm red,
  restore (§Assertion sensitivity).
- Happy-path-only tests miss integration bypasses, partial-failure states, and
  malformed-input crashes — cover the 6 edge case dimensions (§Edge case coverage).

See also
  Test directory → [tests/README.md](../../tests/README.md)
  Helpers       → [packages/testing/README.md](../../packages/testing/README.md)
  Integration   → [tests/integration/README.md](../../tests/integration/README.md)
  Scenario/eval → [tests/scenario_framework/README.md](../../tests/scenario_framework/README.md)
  Style         → [CODE_STYLE.md](../../../CODE_STYLE.md)

Unified helpers (prefer over bespoke setup):
  - initTestDbService()      — DatabaseService + tempdir
  - createCliTestContext()   — CLI test with DB + tempdir; call cleanup() in afterEach
  - withEnv()                — temporary env changes
  - TestEnvironment.create() — full workspace/DB/git scaffold for integration
  - MockLLMProvider          — deterministic LLM responses (no real API calls)

Mocking: MockLLMProvider for deterministic agent tests. Integration:
TestEnvironment.create(). DB: initTestDbService(); prefer initActivityTableSchema() for
reconnection tests — no raw SQL CREATE TABLE in tests.

Canonical prompt (short):
"Write tests for {feature}. Use initTestDbService() or createCliTestContext()
where appropriate. Follow the test target map below for file placement."

Test target map (deterministic source-to-test)

  packages/<name>/src/... → packages/<name>/tests/...
  apps/<name>/src/...     → apps/<name>/tests/... or tests/integration/...
  scripts/...             → tests/scripts/...
  Cross-package           → tests/integration/...
  Scenario / evaluation   → tests/scenario_framework/...

  Enforced by `deno task check:test-placement` — violations are blocking.

Mandatory placement
  - All *_test.ts live under tests/ or packages/<name>/tests/.
  - Never under scripts/, docs/, or other non-tests/ roots.
  - Service tests: tests/services/<domain>/, not directly under tests/services/.
  - Search for an existing domain folder before creating a new one.

Coverage-driven TDD: target ≥70% branch on new features. Run `deno task test:coverage`.

Assertion sensitivity — a test that cannot fail is worse than no test

  A tautology's assertion holds whatever the named code does. It is worse than missing
  coverage: absent coverage is visible, a green tautology certifies the subsystem and
  stops anyone looking. THE CANARY RULE — mandatory for every new or edited test: before
  calling it done, break what it names (delete the line, invert the condition, drop the
  flag), re-run, confirm red, restore. Stayed green? It tests nothing the name claims —
  fix the test. Record subtle canaries in the commit body/docstring.

  RED FROM TS2307 IS NOT ASSERTION EVIDENCE. #tdd-workflow's RED accepts "module not
  found" for a new file — that proves the import path is wired, not that assertions
  discriminate (they never ran). Once the module exists you still owe the canary:
  make the implementation wrong, confirm the ASSERTION fails. Same for adding tests to
  already-working code — no natural RED, so the canary is the only evidence.

  ANTI-PATTERN CATALOGUE — all shipped in this repo:
    1. **Restating a constant against itself** — `assertEquals(ToolErrorCode.NOT_FOUND,
       "NOT_FOUND")`. Passes whether a producer ever emits it. Assert the value is
       PRODUCED and OBSERVED, not spelled as it is.
    2. **Deriving the expectation from the input** — a parity gate building its expected
       list from the same ids it checks can never fail (one concealed thirteen wrong ids
       for a phase). Read one side from disk (catalog/schema), the other from the artefact
       under test.
    3. **Asserting the test's own scaffolding** — asserting a `finally` you wrote ran, or
       a fixture you just built has the fields you just set. Drive the production entry
       point and assert ITS observable effect.
    4. **Testing the runtime/stdlib/third-party binary** — a file importing nothing from
       `@exaix/*` is pinning git/stdlib, not your handler. Untested OUR code hides behind
       tested THEIR code.
    5. **Assertions true by construction** — `Array.isArray` on a declared array, a
       disjunction satisfied by either branch, `!== undefined` on a non-optional return.
       One exact assertion over three vague ones.
    6. **A name/docstring that outruns the body** — a header claiming coverage of
       FlowRunner in a file importing none. The name is a claim; honour it or rename.
    7. **A proxy assertion that passes while the claimed property is violated** — ORDER,
       BYTE-IDENTITY, or STRICT REDUCTION claims must assert exactly that property, not a
       surrogate (a character multiset survives order changes; a non-zero drop count
       survives non-final drops). Use exact equality / strict `<`. Also: **zero-test files
       and assertion-free bodies** (`*_test.ts` with no `Deno.test`, or a body that is one
       comment) — delete them.

  SWEEPING AN EXISTING SUITE — run over a directory before trusting coverage. Every hit is
  a CANDIDATE, verify by reading (internal-assert helpers, generic type params like
  `assertEquals<ModelSize>`, and legit real-process tests are noise):

      # files registering no test at all (match BDD too — root tests/ uses describe/it)
      for f in $(rg -l "" -g "*_test.ts" <dir>); do \
        rg -q "Deno\.test|^\s*(it|test)\(" "$f" || echo "NO TESTS: $f"; done
      # test files importing nothing from our source
      rg -L --files-without-match "@exaix|from \"\.\./" -g "*_test.ts" <dir>
      # assertion-free bodies and always-true shapes
      rg -n "Array\.isArray\(|!== undefined\)|typeof .* === \"string\" \|\|" -g "*_test.ts" <dir>
      # a constant compared to its own name — needs grep -P (rg has no backreferences)
      grep -rPn --include="*_test.ts" 'assertEquals\(\s*(\w+)\.(\w+),\s*"\2"' <dir>

  A file with a raw NUL byte classifies binary and is SKIPPED by rg/grep — it looks like a
  zero-test file while holding many. Write `\0` as an escape, never a literal byte. Run the
  WHOLE set — each pattern caught a live instance the others missed.

  WHEN YOU FIND ONE — do not delete on sight. A tautology is often the visible end of dead
  production code (the deleted enum test exposed a base class that never read its code:
  twenty handlers computed a classification that reached neither response nor journal). In
  order: (a) find what it CLAIMS to cover; (b) check the path is reachable and consumed;
  (c) if so, write the sensitive test and canary it; (d) if not, fix/remove the dead path
  under #tdd-workflow (failing test first); (e) only then delete, saying what replaced it.
  When deleting a test file, grep for it — planning docs cite test paths as ✅ evidence.

  TEST-RUN EVIDENCE — a command exit code is not proof the intended tests ran. Retain
  output naming a non-zero selected-test count and pass/fail counts. Multi-name filters use
  `--filter '/a|b/'`; a plain `--filter 'a|b'` can select zero tests and exit cleanly —
  zero selected tests is a failed verification. Evidence cited by a phase claim must
  survive restarts: copy decisive logs to a durable phase-named output dir, not only /tmp.

Edge case coverage — mandatory test dimensions

  Every feature that takes input, crosses subsystem boundaries, or composes operations
  MUST test each applicable dimension. Happy-path-only Planned Tests are incomplete —
  missing dimensions are 🟠 Testing gaps.
  1. **Invalid/malformed input** — every CLI arg, config value, data field at its type
     boundary: NaN/negative, empty strings, out-of-bounds, missing required. Assert a clear
     error, never silent NaN.
  2. **Integration paths** — two features together (locking + profile keys; checksum +
     rollback). Isolation tests do NOT prove the combined path — that is where bypasses
     hide.
  3. **Partial/mid-operation failure** — step K of N fails; preceding steps roll back or
     are reported; no silent partial state.
  4. **Round-trip fidelity** — serialisation paths (config → string → parsed; object →
     JSON → object) survive a full round-trip; watch lossy types.
  5. **Idempotency/stability** — repeated identical input yields identical output; also
     test "unchanged when input unchanged".
  6. **Resource cleanup** — temp files, subprocesses, DB transactions cleaned on success
     AND failure via try/finally or `using`.

Live-daemon subprocess teardown — mandatory precautions

  Any test booting a real `apps/daemon/main.ts` subprocess (direct Deno.Command,
  bootRealDaemon(), or `exactl daemon start`/`restart`) MUST guarantee the daemon is dead
  before the test returns — every exit path. Two orphan-daemon bugs looked identical: a
  subprocess still running with its tempDir deleted (`readlink /proc/<pid>/cwd` →
  `(deleted)`) — the `finally` tore down filesystem but never the process.
  - **Every `daemon start`/`restart` needs a matching `daemon stop`** — `restart` leaves a
    daemon by contract; env.cleanup() only closes the DB + tempDir. Add the explicit stop:
    `finally { await runExactl(["daemon", "stop"], env.tempDir).catch(() => {}); await env.cleanup(); }`
  - **A direct Deno.Command spawn needs try/finally with both a kill AND an awaited
    status**: `const proc = new Deno.Command(...).spawn(); try { /* body */ } finally {
    try { Deno.kill(proc.pid, "SIGTERM"); } catch {} try { await proc.status; } catch {} }`
    Signal-without-status risks returning before exit. Prefer `bootRealDaemon()`
    (tests/integration/helpers/daemon_config.ts).
  - **A timer-based kill racing `await proc.output()`/`status` is not a guarantee** — the
    function can return while the process lives. Await the process's own exit status.
  - **Not proof against a hostile top-level kill**: killing the runner does NOT cascade.
    Fixed at the runner level (`scripts/test_parallel.ts`'s `detached: true` +
    killActiveChildGroups()); replicate only in new orchestration scripts.
  - **Verify with the real diagnostic**, not "tests passed": `pgrep -af
    "apps/daemon/main.ts"` before + after (clean baseline first); a survivor is orphaned if
    `readlink /proc/<pid>/cwd` is `(deleted)` and `ps -o pid,ppid,pgid -p <pid>` shows PPID 1.

Advanced patterns
  - Refactoring/duplication: `npx jscpd packages apps tests`; extract helpers.
  - Paranoid security: path traversal, command injection, symlink escapes. Whitelists beat
    blacklists.
  - Performance: measure — write benchmarks/load tests.
  - Check-then-act races: a `get`(miss) → async-create → `set` pattern is racy under two
    concurrent callers of the SAME never-seen key (both pass the miss check). Prove with
    `await Promise.all([subject.resolve(k), subject.resolve(k)])` against a counting fake —
    call count 1 = in-flight cache, 2 = race (Phase 194 GAP-7). For eviction-vs-in-flight:
    a manually-releasable gate (hold one call behind an unresolved Promise the test
    controls), start without awaiting, poll until the fake records reach, drive the
    pressure, assert the fake's calls, release, then await the original (see
    `packages/flow/tests/flow_worktree_coordinator_test.ts`'s `FakeGitService.addWorktreeGate`).

Security tests as first-class citizens: label with [security]; cover traversal, injection,
exfiltration, env leakage. Run `deno task test:security`.

Organization (root tests/): tests/cli/ (CLI), tests/services/ (services),
tests/integration/ (e2e), tests/helpers/ (shared utils).

Deduplication: search similar names, compare case names, merge unique into canonical,
delete duplicates.

Env vars (EXA_TEST_*): EXA_TEST_MODE, EXA_TEST_CLI_MODE, EXA_TEST_ENABLE_PAID_LLM,
EXA_TEST_ENABLE_OLLAMA, EXA_TEST_ENABLE_LLAMA, EXA_TEST_LLM_MODEL,
EXA_TEST_OPENAI_API_KEY. Use `isTestMode()` / `isCIMode()` from
`@exaix/core/config/env_schema.ts` — never legacy DENO_TEST/EXACTL_TEST_MODE.

CI pitfalls
  - Treat CI as truthy (CI=true), not strictly "1".
  - Paid LLM disabled unless EXA_TEST_ENABLE_PAID_LLM=1.
  - Avoid compiled binaries; prefer `new Deno.Command(Deno.execPath(), { args: ["run",
    "--allow-all", ...] })`.

Permissions: some npm packages read env at module-init (`typescript` reads
`TSC_WATCHFILE`), so a bare `deno test <file>` can fail NotCapable — run standalone script
tests with `deno test --allow-all <file>`.

Output format
  1. Target test files created/modified.
  1. Helpers used.
  1. Test command.
  1. Coverage check result.

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
      description: Edge case dimensions tested per mandatory dimensions section
      weight: 25
    - name: assertion_sensitivity
      description: Each assertion discriminates — canaried against a break in the code it names
      weight: 25
---
```
