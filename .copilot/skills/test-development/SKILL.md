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
version: "1.0.0"
topics: ["testing", "tdd", "coverage", "test-helpers"]
qwen_skill: test-development
---

```text
Key points

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
      weight: 40
    - name: helper_usage
      description: Shared helpers used instead of bespoke setup
      weight: 30
    - name: coverage_target
      description: Coverage met or verified
      weight: 30
---
```
