# Phase 234 runtime diagnosis portal

A small shell project used by the runtime `fix-bug` behavioral cases.

- `count.sh` prints each input row twice.
- `run-tests.sh` asserts that one input row produces one output row.
- `race.sh` runs two callers against `count.sh`.
- `missing-runner.sh` calls the absent `mytool` runner.
- `bench.sh` measures a loop for one iteration count.

The project test command is `./run-tests.sh`. The runtime skill must not use Deno
commands or Exaix-internal helpers here.
