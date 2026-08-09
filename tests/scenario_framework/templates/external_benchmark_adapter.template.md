# Template: External Benchmark Adapter

```yaml
template_id: external-benchmark-adapter
scope: tests/scenario_framework
introduced_by: phase-160-external-benchmark-harness-sota-hardening.md
depends_on: phase-144-external-benchmark-interop.md (IExternalBenchmarkAdapter contract, Step 1)
status: design-template # no code exists yet; this documents the target shape for implementers
```

## Overview

This template is for adding a **new external SWE-like benchmark adapter** (Terminal-Bench,
SWE-bench, or any future public benchmark) to Exaix's evaluation harness — _without_ writing a
new bespoke ingest script and a new hand-written scenario-template sibling function each time.

Before Phase 160 Step 1 lands, Exaix has exactly one external adapter design (Terminal-Bench,
`phase-144-external-benchmark-interop.md`) and each new benchmark would otherwise mean:
hand-writing `scripts/ingest_<benchmark>.ts`, hand-writing a new sibling function in
`tests/scenario_framework/runner/scenario_templates.ts`, and hand-writing the container-launch
mechanics again. This template describes the `IExternalBenchmarkAdapter` contract every
adapter implements instead, so adding benchmark #3 is a registration, not a rewrite.

## When to Use

- You are adding support for a **new public SWE-like benchmark** (e.g. LiveCodeBench,
  SWE-bench Pro, a future Terminal-Bench release with a different task shape) to Exaix's
  external-benchmark-comparability pipeline.
- You are **not** adding another internal `swe_tasks` corpus task — use
  `tests/scenario_framework/AUTHORING.md` for that (no code changes needed, content-only).
- You are **not** changing scoring, reporting, or the dogfood loop itself — an adapter only
  answers "how does this benchmark's task become a Phase 141 task-contract directory, and how
  does its environment get bind-mounted for execution?"

## Instructions

1. **Confirm the contract exists.** This template targets `IExternalBenchmarkAdapter`
   (Phase 160 Step 1). If that interface hasn't landed yet, follow
   `phase-144-external-benchmark-interop.md`'s Terminal-Bench-specific pattern directly instead
   — do not invent a third shape.
1. **Implement the three adapter methods** against the benchmark's real task format (read the
   benchmark's own docs first; do not assume Terminal-Bench's shape generalizes without
   verification):
   - `ingest(pinnedRelease)` — pin the release (version + content hash), vendor license notice,
     map the benchmark's instruction/environment/tests/oracle onto the Phase 141 contract
     (`TASK.md` / `task.json` / `reference.patch`), sanitize the upstream task-id via
     `PathSecurity.normalizePath` before using it as a directory segment.
   - `classify(task)` — conservative supported/unsupported split; ambiguous tasks are
     `unsupported` with a machine-readable reason, never silently included.
   - `buildEnvironmentBracket(task)` — return an `IContainerLaunchSpec` via the shared,
     exported `buildJailLaunch`-derived builder (Phase 160 Step 1) — do not hand-roll a new
     `docker run`/`docker exec` invocation per adapter.
1. **Register the adapter** in the shared adapter registry (one entry, not per-scenario
   hardcoding).
1. **Author the near-miss control** (Phase 160 Step 3) alongside the reference patch for every
   vendored exemplar — a plausible-but-wrong patch that must fail `scoped_test_cmd`.
1. **Set the freshness field** (Phase 160 Step 2) — `source.published_at` from the upstream
   release's own metadata, so the ingest-time freshness gate has something to check.
1. **Validate**: run the shared adapter-contract test suite against your new adapter (it must
   pass the same fixture-shaped assertions every other adapter passes), then the corpus lint
   (`task_contract_schema_test.ts`) against the vendored output.

## Output Format

Every adapter produces, per ingested task, the same Phase 141-shaped directory:

```text
tests/scenario_framework/fixtures/external/<benchmark-id>/<task-id>/
├── TASK.md               # verbatim upstream instruction — no Exaix-side enrichment
├── task.json              # { base_ref, scoped_test_cmd, family, difficulty,
│                            #   source: { benchmark, version, task_id, published_at } }
├── reference.patch        # oracle solution, diff against the synthetic base_ref commit
└── near_miss.patch        # plausible-but-wrong patch; MUST fail scoped_test_cmd
```

Plus one manifest row in `fixtures/external/<benchmark-id>/manifest.json`
(`{id, class: "supported"|"unsupported", reason?, controls_status}`) and, for supported tasks,
one generated scenario YAML tagged `bench:<benchmark-id>`, `docker`, `provider-live`.

## Complete Worked Example — Terminal-Bench (reference implementation)

This is the concrete shape Phase 144 designs and Phase 160 Step 1 generalizes into the contract
above. Use it as the model when implementing a second adapter.

```typescript
// tests/scenario_framework/runner/external_benchmark_adapters/terminal_bench_adapter.ts
// (illustrative — the real file lands with Phase 160 Step 1 / Phase 144 Step 1)

export const terminalBenchAdapter: IExternalBenchmarkAdapter = {
  id: "terminal-bench",

  async ingest(pinnedRelease) {
    // 1. Pin version + content hash → PINNED.json; vendor upstream license notice.
    // 2. Sanitize task-id: PathSecurity.normalizePath(task.id) before any path join.
    // 3. Map instruction → TASK.md verbatim (brief-parity: no Exaix-side enrichment).
    // 4. git-init the environment working dir; commit as synthetic base_ref.
    // 5. Derive reference.patch from the oracle solution.
    // 6. Populate task.json.source = { benchmark: "terminal-bench", version, task_id,
    //    published_at: pinnedRelease.publishedAt }.
    // ...
  },

  classify(task) {
    // Conservative: file-oriented tasks (edit/create files, tests read resulting state) →
    // "supported". Interactive tasks (services, TUIs, long-lived processes) → "unsupported"
    // with a recorded reason. Ambiguous → "unsupported" (never silently included).
  },

  buildEnvironmentBracket(task) {
    // Delegates to the shared, exported buildJailLaunch-derived builder — parametrized with
    // this task's vendored image/mount, not a new hand-rolled `docker run` invocation.
  },
};
```

## Customization Points

| Point                     | Terminal-Bench (reference)                                                                     | What a new adapter customizes                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Task discovery            | Pinned Terminal-Bench release manifest                                                         | The new benchmark's own release/index format                                                                                        |
| Environment definition    | Single Docker image per task                                                                   | May be multi-container (compose) if the benchmark genuinely requires it — new, separately-justified mechanics, not a default        |
| Verification command      | `scoped_test_cmd` wraps the benchmark's executable test script via `docker exec`               | The new benchmark's own test-invocation convention                                                                                  |
| Freshness source          | Terminal-Bench release date                                                                    | Whatever the new benchmark publishes as a per-task or per-release date; if none exists, the freshness gate flags rather than blocks |
| Near-miss patch authoring | Hand-authored per vendored exemplar during ingest                                              | Same discipline — never auto-generated without human review                                                                         |
| License handling          | Vendored notice + allowlist check (Phase 144 Step 1 unresolved item — see that phase's GAP-10) | Same mechanism once it exists; do not invent a second one                                                                           |

## Notes

- This template documents a **target design**, not shipped code — `IExternalBenchmarkAdapter`
  is introduced by Phase 160 Step 1, itself building on Phase 144 (still 🚧 Planning as of this
  writing). Implementers should re-check both phases' current `Status` before using this file
  as a literal API reference.
- Do not duplicate `buildJailLaunch`'s container-launch logic per adapter — export and
  parametrize the one shared builder (Phase 160 Step 1's explicit fix for Phase 144's
  originally-unexported, todo-app-hardcoded helper).
