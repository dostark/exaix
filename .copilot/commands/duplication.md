---
agent: general
scope: dev
title: "Reduce Code Duplication (#duplication)"
description: Find and eliminate structural code duplication to bring jscpd score below the 2% threshold
short_summary: "Template for reducing structural code duplication below the 2% threshold."
version: "0.1"
topics: ["duplication", "jscpd", "refactoring", "code-quality"]
---

**Purpose:** Reduce code duplication in the project to maintain a healthy codebase and pass CI duplication checks (threshold < 2%).

---

## Instructions for Agent

- Analyze the duplication report by running `deno task measure:duplication --threshold 2.0`.
- Identify structural duplicates in `src/` and `tests/`.
- Refactor duplicate code by extracting common logic into utility functions, base classes, or shared components.
- Ensure duplication level is below **2%** as measured by `deno task measure:duplication`.
- Run full test suite with `deno test --allow-all` and fix any failing tests to ensure refactoring didn't break functionality.
- Run scenario tests using `deno run -A scripts/ci.ts scenarios --profile ci-smoke` to verify high-level workflows.
- Maintain existing functionality and update tests if necessary.
- Run `deno task measure:duplication` again to verify improvements.

---

## Template

**Duplication Reduction Goal:**
{RAW_PROMPT}

**Identified Clones:**

- [File A, lines X-Y] <-> [File B, lines Z-W]
- ...

**Refactoring Strategy:**

- ...

**Validation:**

- `deno task measure:duplication` reports < 2% duplication.
- All tests pass (`deno test --allow-all`).
- Scenario tests pass (`deno run -A scripts/ci.ts scenarios --profile ci-smoke`).
- Linting is clean (`deno task check:style`).

**Notes:**

- Focus on the most significant or structural duplicates first.
- Avoid over-abstraction; prioritize readability and maintainability.
