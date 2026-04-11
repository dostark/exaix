# Phase 42: Automated Architecture Validation [COMPLETED]

## Status: COMPLETED (2026-02-17)

Automate the enforcement of architectural grounding and module header standards to prevent documentation rot and ensure all code remains discoverable via `ARCHITECTURE.md`.

## Executive Summary

## Problem:

## Solution:

1. **Header Check**: Scans every `.ts` file in `src/` to ensure it starts with a standardized `@module` JSDoc header.

   - It is explicitly listed in `ARCHITECTURE.md`.
   - OR it is listed as a `@related-file` or `@dependency` in the header of a file that is already grounded.
1.

---

## Goals

- [x] Create `scripts/validate_architecture.ts` with comprehensive validation logic.
- [x] Implement `@module` header parsing and validation.
- [x] Implement `ARCHITECTURE.md` parsing for file path extraction.
- [x] Implement transitive grounding validation (Linked List/Graph traversal).
- [x] Add `check:arch` task to `deno.json`.
- [x] Integrate `deno task check:arch` into `.github/workflows/code-quality.yml`.

---

## Proposed Changes

### [NEW] [validate*architecture.ts](file://$HOME/git/Exaix/scripts/validate*architecture.ts)

The script will use the following logic:

1. Identify all source files in `src/**/*.ts`.

1.
   - Verify standardized JSDoc header exists (`@module`, `@path`, `@description`, `@architectural-layer`).
   - Extract `@related-files` and `@dependencies`.
1.
   - Root set = Files explicitly in `ARCHITECTURE.md`.
   - Traverse links (related-files, dependencies) to find all reachable files.
   - Flag any file in `src/` that is NOT reachable from the root set.

### [MODIFY] [deno.json](file://$HOME/git/Exaix/deno.json)

```json
"tasks": {
  "check:arch": "deno run --allow-read scripts/validate_architecture.ts"
}
```

### [MODIFY] [.github/workflows/code-quality.yml](file://$HOME/git/Exaix/.github/workflows/code-quality.yml)

Add a step to run the architecture validation.

---

## Verification Plan

### Automated Tests

- Run `deno task check:arch` and expect it to FAIL initially (since only 5 files have headers).
- Add headers to all core files and re-run until it passes.

### Manual Verification

- Move a file and verify the script detects the broken link in `ARCHITECTURE.md` or headers.
- Remove a header from a file and verify it's flagged.
