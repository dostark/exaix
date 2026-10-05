# Evaluation history and calibration

`@exaix/eval-history` owns evaluation history schemas, the SQLite history store,
and pure judge-calibration computations. The CLI and scenario runner compose these
APIs; the package does not start model providers or subprocesses.

## History boundary

- `EvalHistoryEntrySchema` and `StepResultSchema` validate evaluation history.
- `EvalSqliteStore` writes and queries history, outcome channels, and summaries.
- `IEvalOutcomeReader` provides read-only lookups for telemetry enrichment.
- `resolveEvalDbPath` resolves the evaluation database location.

History records and calibration datasets have separate purposes. A historical
score does not establish frozen calibration lineage or a reference label.

## Pure calibration APIs

Import individual calibration modules when SQLite initialization is unnecessary:

- `src/calibration/metrics.ts`: align exact item IDs and compute exact agreement,
  Cohen's kappa, and interval Krippendorff's alpha. Undefined coefficients carry a
  reason and cannot establish a baseline.
- `src/calibration/identity.ts`: canonical JSON, SHA256, and
  `buildContextAssemblyIdentity`. Undefined fields and nonfinite numbers reject.
  Assembly identity hashes the supplied source bytes, explicitly resolved dynamic
  assets, and effective nonsecret configuration. Artifact and judge assemblies
  have separate version constants; per-item prompt hashes remain separate.
- `src/calibration/schema.ts`: strict **version 1** record and option schemas.
  These schemas do not implement the planned version 2 frozen lifecycle.
- `src/calibration/constants.ts`: registered sample-count default/minimum **20**,
  maximum **100**, and the item-byte default. Effective configuration consumption
  across the complete lifecycle remains pending.

The identity builder validates an input map. It does not discover dependency
closures or prove that an artifact producer used that map. AgentRunner/native
context lineage and its propagation into frozen records remain pending.

## Selected judge profile

The scenario runner and `exactl eval run` accept `--judge-profile <profile-file>`;
`eval calibration generate` forwards the same option. The pure renderer and
validator are in `packages/core/src/evaluation/judge_profile.ts`.

Selected mode loads bounded profile assets, uses one fenced instruction payload
per asset, and renders JSON-encoded request/artifact evidence. It requires all
five criterion scores and recomputes the weighted aggregate, threshold label,
and criterion flags. Duplicate keys, unsupported fields, missing scores, and
insufficient-evidence error responses reject. Ambient methodology and scored
examples are not appended. Unselected judging retains its existing behavior.

**Activation is incomplete.** Selected live judge calls reject with
`judge-profile-isolated-provider-required`; selected capture into the legacy
format rejects with `judge-profile-frozen-capture-required`. Mock handling has no
numeric calibration score. Deterministic provider fixtures verify prompt/scoring
contracts, not model quality or baseline eligibility.

## Commands and compatibility

Existing `eval calibration generate` captures legacy scenario evidence. The
current `eval calibration score --capture-dir` bridge performs paired diagnostic
scoring; it is not target-only frozen replay. Provider calls are sequential.

Phase 146 Step 1 still must implement this migration:

| Command               | Planned behavior                                                   |
| --------------------- | ------------------------------------------------------------------ |
| `generate`            | Capture real artifacts with verified assembly lineage              |
| `reference`           | Stage the independent Codex CLI reference track                    |
| `finalize`            | Validate and atomically publish an immutable version 2 set         |
| `score --dataset`     | Replay only the Claude CLI target against frozen labels            |
| `probe --capture-dir` | Explicit paired diagnostics, always baseline-ineligible            |
| `drift`               | Target-only replay and comparison with compatible trusted identity |

Reference/finalize/probe registration, version 2 readers/writers, frozen score
migration, and drift are pending. Do not treat their descriptions as available
commands. Legacy records remain inspectable; they cannot be promoted by assuming
missing lineage. Synthetic fixtures, mocks, and probes do not count toward the
20 unique real artifacts or a published baseline. CLI isolation, private atomic
storage, producer lineage, prespecified coverage, both reference labels, and
defined agreement metrics remain prerequisites for live acceptance.
