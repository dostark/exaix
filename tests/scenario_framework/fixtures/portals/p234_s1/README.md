# Phase 234 Step 1 diagnosis portal

A small Deno project with three defects used by the `fix-bug` behavioral cases.

- `src/duplicate_write.ts` writes each value twice and parses a null config.
- `src/race_writer.ts` lets two callers insert the same row.
- `src/perf_bench.ts` measures latency for a worker count.
- `scripts/race.ts` runs the two-caller race for N attempts.
- `scripts/bench.ts` runs the latency workload for N workers.
- `scripts/check.sh` exits zero without asserting the duplicate count.

The reproduction script `scripts/repro.sh` is intentionally absent for `p234-s1-c3`.
