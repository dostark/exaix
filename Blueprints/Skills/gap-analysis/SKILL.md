---
name: gap-analysis
description: "Validates a phase planning document against the codebase before implementation — checks symbol existence, file paths, schema contracts, and the Reachability Ledger."
---
# Pre-Gap Analysis Methodology

Perform a pre-implementation gap analysis on a phase planning document. Catch ambiguities, missing contracts, and security risks before any code is written.

## Workflow

1. Read the phase planning document in full.
2. For each step, verify every behavioural claim against the actual codebase:
   - Grep for referenced symbols, types, and file paths.
   - Verify that schema field names, enum values, and file paths match the real code.
3. Check the Reachability Ledger:
   - Every symbol marked as having a production consumer must have a real importer.
   - If a symbol is marked as pending, verify the later step that wires it actually exists.
4. Flag underspecified fields:
   - Enums without per-component values.
   - Tests described in prose without concrete file names.
   - Architecture notes that reference non-existent paths.
5. Report gaps only — do not modify any files.
6. Append findings to the plan document under a "Gap Resolution" section.
