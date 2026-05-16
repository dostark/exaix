---
agent: general
tools:
  - run_command
  - read_file
  - patch_file
  - write_file
  - search_files
scope: dev
title: "Reduce Code Duplication (#duplication)"
description: Find and eliminate structural code duplication to bring jscpd score below the 2% threshold
short_summary: "Reduce structural code duplication below 2% using the measure_duplication script and targeted refactoring."
version: "1.0"
topics: ["duplication", "jscpd", "refactoring", "code-quality"]
qwen_skill: duplication
---

```text
Key points
- Threshold: < 2% structural duplication (enforced by CI via measure_duplication.ts)
- Only extract identical *behavior* — don't abstract merely similar-looking code
- Run the full test suite after any extraction to prove no behavior change
- See .copilot/guidelines/jscpd-guide.md for detailed jscpd configuration and clone report interpretation

Canonical prompt (short):
"Reduce code duplication below 2% threshold.
Run measure_duplication.ts, identify top clones, extract shared utilities, verify tests pass."

Exact commands
  # Measure current duplication level
  deno run --allow-run --allow-read --allow-write scripts/measure_duplication.ts --threshold 2.0

  # Generate detailed JSON clone report for analysis
  npx jscpd src/ tests/ --reporters json --output ./jscpd-report

  # Quick scan (no report file)
  npx jscpd src/ tests/

Workflow
  1. Run measure_duplication.ts — note current % and top clone pairs
  2. Open jscpd-report/jscpd.json (or stdout) and sort by clone size
  3. For each significant clone:
     a. Confirm it is truly identical behavior (not just similar structure)
     b. Extract shared utility into the appropriate location:
          Shared src logic   →  src/shared/<feature>.ts  or  src/utils/<feature>.ts
          Shared test logic  →  tests/helpers/<feature>.ts
     c. Replace both clone sites with the new utility
     d. Run deno test --allow-all <affected-test-files> — must still pass
  4. Re-run measure_duplication.ts — confirm reduction
  5. Run deno task check:style to ensure no new style violations from extraction
  6. Run deno run -A scripts/ci.ts scenarios --profile ci-smoke for high-level sanity

Do / Don't
- ✅ Do run tests before AND after extraction (baseline GREEN, then GREEN again)
- ✅ Do place extracted utilities at the right layer (src/shared/ vs tests/helpers/)
- ✅ Do use IFoo interface naming if extracted utility is a service
- ❌ Don't extract code that merely looks similar but has different semantics
- ❌ Don't over-abstract — a shared 3-line helper can be worse than two copies
- ❌ Don't reduce duplication % by deleting tests

Related
- .copilot/guidelines/jscpd-guide.md  — detailed jscpd configuration and threshold management
- #refactor               — general refactoring patterns (IFoo, DI, constants)
- #clean-codebase          — full CI sweep including duplication check
- CODE_STYLE.md            — authoritative naming, type, import, and constants rules
```

## Examples

- `#duplication src/ tests/ — find and eliminate top clones above 5 tokens`
- `#duplication Extract shared assertion helper found in 3 test files`
- `#duplication Reduce jscpd score from 3.1% to below 2%`
