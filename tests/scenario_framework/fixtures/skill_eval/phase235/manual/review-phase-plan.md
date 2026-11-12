# Phase 235 Step 4 — review-phase-plan skill manual review

- Reviewer: DeepSeek V4.1 Flash 1017 (opencode-go)
- Date: 2026-11-12
- Skill: `.copilot/skills/review-phase-plan`
- Method: document review of the edited guidance. No live model run.
- `SKILL.md` sha256: `9cb647842c72a83b28e0f3d1ced368dc7a4200bf2562053e01d5692907473045`
- `exaix.yaml` sha256: `7a2315b2a5dcd7c8292ffbcf0072d02d5f0201f00535b5b961c3bfbf13b1e78b`

## Limitation

This record shows that the guidance covers each case. It does not measure model behavior,
review quality, or value. A live run is still required before any behavioural claim.

## Cases

| Case | Input | Expected | Observed rule | Outcome |
| --- | --- | --- | --- | --- |
| `p235-s4-c1` | A layer-by-layer feature plan using migration terminology | Migration form rejected; vertical slices required | Phase 2D step 2: "expands/migrate/contract belongs to a broad migration with mixed callers. Reject it for ordinary feature work" | pass (document review) |
| `p235-s4-c2` | A migrate batch that depends on an unlisted batch | Blocking dependency-edge finding | Phase 2D step 2: "A migrate batch that depends on an unlisted batch is a blocker" | pass (document review) |
| `p235-s4-c3` | Contracting while an old caller remains | Contraction blocked | Phase 2D step 2: "Contracting while an old caller remains is a blocker" | pass (document review) |
| `p235-s4-c4` | A complete plan whose code is pending | Ready to implement; runtime criteria stay open | Phase 2D step 3: "Pending code alone is not a planning defect; plan readiness is not runtime completion" | pass (document review) |
| `p235-s4-c5` | A preference without a violated requirement | Suggestion, not a blocker; a missing contract is a cited blocker | Phase 2D step 4: "An unsupported design preference is a suggestion, not a blocker. A missing contract is a cited blocker" | pass (document review) |

## Exclusions checked

- Reversible label choices need no ADR.
- Plan readiness is not runtime completion.
- No trigger, tool, id, or quality-weight change.
