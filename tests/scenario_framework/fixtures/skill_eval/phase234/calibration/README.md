# Phase 234 semantic calibration reference set

**Status: prepared, not reviewed.** These artifacts are candidate labels taken
from the existing case fixtures. They are not independently approved labels and
they are not calibration evidence. The [approved review process](../../../../../../exaix-dev-docs/planning/phase-234-semantic-evaluation-review.md)
still requires a designated independent reviewer, frozen labels, a calibration
run, and an approved agreement threshold.

## Files

- `reference_set.json` — complete artifacts plus their candidate labels and
  SHA-256 hashes.
- `reference_set_manifest.json` — case count, control map, rubric and process
  hashes, and the proposed (not approved) calibration policy.
- `reference_set_review.md` — independent-review packet with a verdict column
  for every entry.

## Coverage

- 30 cases, one positive and one negative candidate per case.
- 20 equivalent-wording positives for the diagnosis and verification cases.
- Two-turn initial and answered artifacts for `p234-s5-c2`.
- 82 entries total: 31 positive, 31 negative, 20 equivalent.

The negative entry for each case names the case's known-bad control. Every
artifact is separate from the retained live sandboxes and contains no absolute
home path or sandbox identifier.

## Review requirements

1. An independent reviewer approves or replaces every candidate label.
1. The reviewer records their identity, date, reviewed set hash, and any
   disagreement.
1. The proposed policy in the manifest is not approved. Set a real minimum
   positive, negative, and equivalent count plus an agreement threshold before a
   calibration run.
1. Run the evaluator on this set without revealing the labels, compare the
   results, and record the disagreement analysis.
1. A changed rubric, evaluator, or set requires fresh calibration.

## Validation

```bash
deno test --allow-all tests/scenario_framework/tests/unit/calibration_reference_set_test.ts
```

The test checks case coverage, control presence, artifact hashes, separation
from live artifacts, and agreement with the existing case oracles. Oracle
agreement is a consistency check, not semantic calibration.
