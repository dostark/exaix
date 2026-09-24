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

- No behavior change: tests pass BEFORE and AFTER (run both).
- Magic-value refactoring specifically → use #refactor-check-magic.
- Interface-first + constructor DI: every class Foo → export interface IFoo; consumers
  depend on IFoo, never Foo.
- Extract numeric/string literals to named constants in the right location:
    Production code → @exaix/core/config
    Test code       → tests/config/constants.ts (TEST_ prefix)
- PathResolver wraps all file path operations — never raw string concatenation.

Canonical prompt (short):
"Refactor {component} for {goal: clarity | performance | DI compliance | interface extraction}.
No behavior change. Tests must pass before and after."

Patterns
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

  6. God-object decomposition — facade extraction
     Class > 500 lines, > 10 deps, or mixed concerns: extract cohesive sub-domains.

     a. **Detect** — `deno task check:god-objects` scores on 6 metrics: line count,
        method count, constructor params, max method length, import count, field count.
     b. **Analyze boundaries** — group fields/methods by concern. A group that owns its
        own field subset and forms a coherent responsibility is an extraction candidate.
     c. **Parameter object (safe first step)** — replace N positional constructor params
        with one deps interface. Satisfies style gates with no architectural change:
        Before: constructor(a: A, b: B, c: C, d: D, e: E, f: F) {}
        After:  constructor(deps: IFooDeps) {}
        interface IFooDeps { a: A; b: B; c: C; d: D; e: E; f: F; }
     d. **Extract service** — move one cohesive group to a new class that owns its
        fields/behavior; the original delegates:
        Before: class Foo { private x: X; private y: Y; doThing() { /* uses x and y */ } }
        After:  class Foo { private barService: BarService; }
                class BarService { private x: X; private y: Y; doThing(): void; }
     e. **Composition root** — the original constructor becomes the single wiring spot.
        Each service declares its own deps, not the orchestrator's:
        interface IFooDeps {
          barService?: BarService;  // defaults created if omitted
          bazService?: BazService;
        }
     f. **Interface decoupling** — an interface another class consumes? Extract an adapter
        that composes the services:
        Before: class Foo implements IFoo { /* 10 methods */ }
        After:  class Foo { private adapter: FooAdapter; }
                class FooAdapter implements IFoo { /* composes services */ }

     Example: AgentExecutor went from ~1750 lines / 16 deps to ~950 lines / 11 deps by
     extracting 7 services (ExecutionContext, Blueprint, PromptBuilder, GitAudit,
     OutputParser, HistoryManager, ReActLoopAdapter), each with TDD, 100-250 lines at a time.

Security check (refactor touching portal code or any boundary: input parsing, file paths,
SQL queries, subprocesses, HTTP handlers, auth, secrets)
  - Before restructuring, verify control routes through the canonical primitive
    (PathSecurity.resolveWithinRoots, parameterized queries, argument arrays). Never
    silently downgrade a boundary — e.g. inlining a path check as a string comparison
    instead of keeping PathResolver.
  - Error messages changed? Keep access-denied messages generic (no host paths echoed).
  - Full checklist: Blueprints/Skills/security-first.skill.md when scope covers input,
    path, injection, or auth surfaces.

Validation
  deno test --allow-all <test-file>     # before (baseline GREEN)
  # ... apply refactor ...
  deno test --allow-all <test-file>     # after (still GREEN)
  deno lint <files>
  deno task check:style
  deno task check:arch
  deno fmt <files>

Do / Don't
- ✅ Run tests before AND after — proves zero behavior change.
- ✅ Use IFoo naming for extracted interfaces.
- ✅ Place constants in the correct file (prod vs. test).
- ❌ Use `as any` to resolve refactor-introduced type errors.
- ❌ Fix layer-violating constant imports by duplicating the constant locally. Inject the
  service interface that owns it — the consumer calls a method, never imports the
  constant. Local duplication diverges (`[layer-constant-leak]`).
- ❌ Fix them by inlining the raw value. The value IS the constant; inlining loses the
  name and creates the same divergence. Inject the owning service's interface instead.
- ❌ Refactor and add features in the same commit.
- ❌ Skip #refactor-check-magic when magic violations are the primary goal.

Related
- #refactor-check-magic — targeted magic-value reduction
- #clean-codebase — full CI-green sweep
- #tdd-workflow — when the refactor needs tests first
- #security — full audit when refactor exposes 3+ control gaps
- Blueprints/Skills/security-first.skill.md — portal code checklist (input/path/injection/auth)
- AGENTS.md#behavioral-guidelines — think before coding, simplicity, surgical changes
- CODE_STYLE.md — naming, type, import, constants rules
```

## Output Format

1. **Refactoring type** — interface extraction / DI / constants / path hardening.
1. **Files changed** — source files modified.
1. **Baseline evidence** — tests pass before.
1. **Verification evidence** — tests pass after (same count).
1. **CI gate results** — lint, type-check, style, arch, fmt.
1. **Commit payload** — use `#commit`.

## Examples

- `#refactor Extract IEventLogger interface from EventLogger class`
- `#refactor Replace module-level DatabaseService singleton with constructor DI`
- `#refactor Move hardcoded 30000 timeout to DEFAULT_TIMEOUT_MS constant`

## See also

- [test-development](../test-development/SKILL.md) — test patterns, helpers, coverage
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
