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
version: "1.0"
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
- [LLM_GUIDE.md](../../../LLM_GUIDE.md) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- CODE_STYLE.md         — authoritative naming, type, import, and constants rules
```

## Examples

- `#refactor Extract IEventLogger interface from EventLogger class`
- `#refactor Replace module-level DatabaseService singleton with constructor DI`
- `#refactor Move hardcoded 30000 timeout to DEFAULT_TIMEOUT_MS constant`
