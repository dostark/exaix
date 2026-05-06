---
agent: general
scope: dev
title: "Linting/Formatting Skill (#lint)"
description: Fix all lint and formatting issues in touched files and verify zero errors
short_summary: "Fix lint, formatting, and style violations in touched files using exact Exaix check commands."
version: "1.0"
topics: ["linting", "formatting", "code-quality", "style"]
qwen_skill: lint
---

```text
Key points
- Run checks in order: lint → fmt → style → arch (each gate blocks the next)
- Default to file-scoped commands; only run repo-wide when all files are affected
- For a full repo-wide CI-green sweep use #clean-codebase instead
- Never suppress lint rules without a documented inline comment explaining why

Canonical prompt (short):
"Fix all lint, formatting, and style violations in {files}."

Exact commands
  # Lint a specific file (fast feedback)
  deno lint <src-file> <test-file>

  # Lint the whole repo
  deno lint

  # Format (auto-fix)
  deno fmt <src-file> <test-file>

  # Check formatting without modifying (CI-safe)
  deno fmt --check

  # Style checker: interface naming (IFoo), no magic unions, module boundaries
  deno task check:style

  # Architecture groundedness: all files need @module JSDoc header
  deno task check:arch

Scope guidance
- Touched files only: `deno lint <file1> <file2>` + `deno fmt <file1> <file2>`
- Whole repo: `deno lint` + `deno fmt --check` (use for pre-commit or full sweep)
- Style + arch always run repo-wide (no file-scope flag available)

Do / Don't
- ✅ Do run deno fmt (auto-fix) before git add
- ✅ Do fix root cause of lint rules rather than adding suppressions
- ✅ Do run deno task check:style after any interface or type changes
- ✅ Use `// deno-lint-ignore <rule>` only when suppression is the only option,
     and add an inline comment explaining why
- ❌ Don't mark complete until deno lint and deno fmt --check both report zero issues
- ❌ Don't use repo-wide commands for a single-file change (slow, noisy)

Related
- #clean-codebase — full repo sweep: type errors → lint → fmt → style → arch → magic → tests
- #refactor-check-magic — when magic violations are non-trivial after style check
- CODE_STYLE.md — authoritative naming, type, import, and constants rules
```

## Examples

- `#lint src/services/plan_service.ts tests/services/plan_service_test.ts`
- `#lint` — full repo sweep before a PR
- `#lint src/ai/openai_provider.ts` — fix lint in a single changed file
