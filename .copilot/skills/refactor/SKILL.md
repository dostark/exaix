---
name: refactor
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Refactoring Skill (#refactor)"
description: Systematically refactor code for clarity, performance, or maintainability without changing behavior
short_summary: "Refactor Exaix code using IFoo interfaces, constructor DI, constants extraction, and zero behavior change."
version: "1.0.0"
topics: ["refactoring", "code-quality", "maintenance"]
qwen_skill: refactor
---

```text
Key points
- No behavior change: tests must pass before AND after (run them both times)
- For magic-value refactoring specifically, use #refactor-check-magic instead
- Follow Interface-first + constructor DI: every class Foo → export interface IFoo;
  consumers depend on IFoo, never on Foo
- Extract numeric/string literals to named constants in the right location:
    Production code → @exaix/core/config
    Test code       → tests/config/constants.ts (TEST_ prefix)
- PathResolver must wrap all file path operations — never raw string concatenation

Canonical prompt (short):
"Refactor {component} for {goal: clarity | performance | DI compliance | interface extraction}.
No behavior change. Tests must pass before and after."

Exaix refactoring patterns
  1. Interface extraction
     Before: export class FooService { ... }
     After:  export interface IFooService { methodA(): Promise<void>; }
             export class FooService implements IFooService { ... }

  2. Constructor injection (replace module-level singletons)
     Before: const db = DatabaseService.getInstance();
     After:  constructor(private db: IDatabaseService) {}

  3. Constants extraction
     Before: const timeout = 30000;
     After:  import { DEFAULT_TIMEOUT_MS } from "@exaix/core/config/constants.ts";
             const timeout = DEFAULT_TIMEOUT_MS;

  4. Test constant extraction
     Before: const prompt = "test prompt";
     After:  import * as C from "../config/constants.ts";
             const prompt = C.TEST_PROMPT;

  5. PathResolver for file paths
     Before: const p = `${base}/${userInput}`;
     After:  const p = await PathSecurity.resolveAndValidate(userInput, [base]);

  6. God object decomposition — facade extraction
     When a class has > 500 lines, > 10 deps, or mixed concerns, decompose by
     extracting cohesive sub-domains into their own services:

     a. **Detect** — run `deno task check:god-objects` to score candidates
        on 6 metrics: line count, method count, constructor params, max
        method length, import count, field count.

     b. **Analyze boundaries** — group the class's fields and methods by
        concern. Each group that reads/writes its own subset of fields and
        forms a coherent responsibility is an extraction candidate.

     c. **Parameter object (safe first step)** — replace N-positional
        constructor params with a single deps interface. This satisfies
        style gates without architectural change:
        Before: constructor(a: A, b: B, c: C, d: D, e: E, f: F) {}
        After:  constructor(deps: IFooDeps) {}
        interface IFooDeps { a: A; b: B; c: C; d: D; e: E; f: F; }

     d. **Extract service** — move one cohesive group to a new class.
        The new class owns its fields and behavior; the original class
        delegates to it:
        Before: class Foo {
                  private x: X;
                  private y: Y;
                  doThing() { /* uses x and y */ }
                }
        After:  class Foo { private barService: BarService; }
                class BarService { private x: X; private y: Y; doThing(): void; }

     e. **Composition root** — the original class's constructor becomes
        the single place where all services are wired. Each injected
        service declares its own deps, not the orchestrator's:
        interface IFooDeps {
          barService?: BarService;  // defaults created if omitted
          bazService?: BazService;
        }

     f. **Interface decoupling** — if the original class implements an
        interface consumed by another class, extract an adapter that
        composes the services instead:
        Before: class Foo implements IFoo { /* 10 methods */ }
        After:  class Foo { private adapter: FooAdapter; }
                class FooAdapter implements IFoo { /* composes services */ }

     Example: AgentExecutor was decomposed from ~1750 lines / 16 deps
     to ~950 lines / 11 deps by extracting 7 services (ExecutionContext,
     Blueprint, PromptBuilder, GitAudit, OutputParser, HistoryManager,
     ReActLoopAdapter). Each extraction was done with TDD, removing
     100-250 lines at a time over a single weekend session.

Security check (apply when the refactor touches portal code or any boundary:
  input parsing, file paths, SQL queries, subprocesses, HTTP handlers, auth, secrets)
  - Before restructuring, verify the existing control routes through the canonical
    primitive (PathSecurity.resolveWithinRoots, parameterized queries, argument
    arrays). Refactoring must not silently downgrade a boundary — e.g. inlining a
    path check as a string comparison instead of keeping PathResolver.
  - If the refactor changes error messages, confirm access-denied messages remain
    generic (no host paths echoed to callers).
  - Consult Blueprints/Skills/security-first.skill.md for the full checklist when
    the refactor's scope covers input, path, injection, or auth surfaces.

Validation
  deno test --allow-all <test-file>     # before refactor (baseline GREEN)
  # ... apply refactor ...
  deno test --allow-all <test-file>     # after refactor (still GREEN)
  deno lint <files>
  deno task check:style
  deno task check:arch
  deno fmt <files>

Do / Don't
- ✅ Do run tests before AND after refactor to prove zero behavior change
- ✅ Do use IFoo naming for all extracted interfaces
- ✅ Do place constants in the correct file (prod vs. test)
- ❌ Don't use `as any` to resolve type errors introduced by the refactor
- ❌ Don't refactor and add new features in the same commit
- ❌ Don't skip #refactor-check-magic when magic violations are the primary goal

Related
- #refactor-check-magic — targeted magic-value reduction workflow
- #clean-codebase       — full CI-green sweep including style + arch
- #tdd-workflow         — when refactor requires adding tests first
- #security             — full security audit when refactor exposes 3+ control gaps
- [Blueprints/Skills/security-first.skill.md](../../../Blueprints/Skills/security-first.skill.md) — secure coding checklist for portal code; consult when refactor touches input, path, injection, or auth boundaries
- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- CODE_STYLE.md         — authoritative naming, type, import, and constants rules
```

## Output Format

1. **Refactoring type** — interface extraction / DI injection / constants extraction / path hardening.
1. **Files changed** — list of source files modified.
1. **Baseline evidence** — tests pass before refactor.
1. **Verification evidence** — tests pass after refactor (same count).
1. **CI gate results** — lint, type-check, style, arch, fmt.
1. **Commit payload** — use `#commit` for the structured commit message.

## Examples

- `#refactor Extract IEventLogger interface from EventLogger class`
- `#refactor Replace module-level DatabaseService singleton with constructor DI`
- `#refactor Move hardcoded 30000 timeout to DEFAULT_TIMEOUT_MS constant`

## See also

- [test-development](../test-development/SKILL.md) — test patterns, helpers, coverage verification
- [exaix-development](../exaix-development/SKILL.md) — required patterns, prohibited anti-patterns

---
exaix:
  skill_id: refactor
  related_skills: [test-development, exaix-development]
  triggers:
    keywords: [refactor, restructure, rename, extract, interface, di]
    task_types: [refactor]
    tags: [refactoring]
  constraints:
    - "Do not change behaviour — tests must pass before and after"
    - "Do not mix refactoring with new features in the same commit"
    - "Use IFoo naming for extracted interfaces"
    - "Place constants in the correct file (prod vs. test)"
    - "Do not use as any to resolve type errors introduced by refactor"
  output_requirements:
    - "Baseline evidence: tests pass before refactor"
    - "Verification evidence: tests pass after refactor (same count)"
    - "CI gates clean (lint, type-check, style, arch, fmt)"
    - "Structured commit with refactoring type and files changed"
  quality_criteria:
    - name: behavior_preservation
      description: Test count and results identical before and after
      weight: 40
    - name: interface_quality
      description: Extracted interfaces follow IFoo naming convention
      weight: 30
    - name: ci_gate_compliance
      description: All CI gates pass before commit
      weight: 30
---
