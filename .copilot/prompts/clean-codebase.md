---
agent: general
scope: dev
title: "Clean Codebase Template (#clean-codebase)"
short_summary: "Template for removing all errors, warnings, and style violations from the repository."
version: "0.1"
topics: ["cleanup", "validation", "linting", "style", "qa"]
---

```text
Key points
- Target complete repository cleanliness for build, lint, and style checks
- Fix code, import boundaries, and style violations with minimal changes
- Validate with the exact commands required by the project
- No errors, no warnings, no violations accepted

Canonical prompt:
"Clean the codebase so that `deno check .`, `deno lint .`, `deno fmt .`, and `deno run -A scripts/check_code_style.ts` all pass with zero errors, warnings, or violations."

Examples
- Example prompt: "Remove the remaining package entrypoint style violations and make the repo pass all Deno checks cleanly."
- Example prompt: "Fix the project so `deno check .`, `deno lint .`, `deno fmt .`, and the custom style checker all succeed without reporting any problems."

Do / Don't
- ✅ Do run the exact validation commands listed by the repository
- ✅ Do make targeted fixes for errors, warnings, and style violations
- ✅ Do verify clean results after every change
- ❌ Don't leave any warnings or violations in the final state
- ❌ Don't change behavior unless necessary for cleanup
- ❌ Don't skip root-level validation commands
```

## Purpose

Ensure a specific repository cleanup task is handled systematically and completely. Use this template when the objective is to remove all current compile, lint, and style checker issues.

## Instructions for Agent

- Restate the cleanup goal and the exact validation commands.
- Inspect current failures first, then fix the root cause.
- Limit changes to the smallest safe set that removes the reported problems.
- Validate against:
  - `deno check .`
  - `deno lint .`
  - `deno fmt .`
  - `deno run -A scripts/check_code_style.ts`
- Do not return until all four commands report zero issues.

## Base Test

Make clean results - no errors, no warnings, no violations, for:

- `deno check .`
- `deno lint .`
- `deno fmt .`
- `deno run -A scripts/check_code_style.ts`

## Validation Criteria

- `deno check .` passes
- `deno lint .` passes without warnings or errors
- `deno fmt .` passes without formatting violations
- `deno run -A scripts/check_code_style.ts` passes with no reported violations
- No new regressions introduced by the cleanup
