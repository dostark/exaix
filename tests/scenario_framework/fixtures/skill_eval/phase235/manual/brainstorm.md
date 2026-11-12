# Phase 235 Step 7 — brainstorm skill manual review

- Reviewer: DeepSeek V4.1 Flash 1017 (opencode-go)
- Date: 2026-11-12
- Skill: `.copilot/skills/brainstorm`
- Method: document review of the edited guidance. No live model run.
- `SKILL.md` sha256: `848547b7e5f3d7fa907a6903d45b7a79ffba1e3d3c1cf189751c503af0fd0b24`
- `exaix.yaml` sha256: `dd535af6cf53f333e4c1bbec4e34b7f9ec0d1ab573dce94fd887422bef56a409`

## Limitation

This record shows that the guidance covers each case. It does not measure model behavior,
decision quality, or value. A live run is still required before any behavioural claim.

## Cases

| Case | Input | Expected | Observed rule | Outcome |
| --- | --- | --- | --- | --- |
| `p235-s7-c1` | A one-way-door decision | Framed as irreversible with owner, deadline, cost of delay, blast radius | Step 1: "Classify it: reversible (two-way door) or irreversible (one-way door)" plus owner, deadline, cost of delay, blast radius | pass (document review) |
| `p235-s7-c2` | A request for "the best option" | At least three options including do-nothing, grouped by axis | Step 3: "Generate at least three options, including do-nothing, before judging any"; "Group options by the axis each group decides" | pass (document review) |
| `p235-s7-c3` | Facts available in the repository | Read and cited before any question | Step 2: read patterns, invariants, decisions, limits; "Never ask the user for a fact you can read" | pass (document review) |
| `p235-s7-c4` | Competing options | Criteria and weights named before scores | Step 4: "Name three to five criteria with weights"; quality gate: "Criteria and weights named before any score" | pass (document review) |
| `p235-s7-c5` | Any recommendation | Failure mode, blast radius, reversal cost per option | Step 5 option table and quality gate require all three per option | pass (document review) |
| `p235-s7-c6` | A confident assumption | Assumption ledger with cheapest falsifying test | Step 6: statement, confidence, cheapest falsifying test, owner; a stated reason when no test applies | pass (document review) |
| `p235-s7-c7` | A reversible choice | Decision record, no ADR; ADR only for a hard-to-reverse tradeoff | Step 8: record fields; "Propose an ADR only for a consequential, hard-to-reverse tradeoff with non-obvious rationale" | pass (document review) |
| `p235-s7-c8` | A settled decision | Not reopened without new evidence; no edits before confirmation | Step 9 and Step 10; quality gate: "No settled decision is reopened without new evidence" | pass (document review) |

## Boundary check

The description and triggers separate this skill from `requirements-analysis`, `plan`, and
`requirements-interview`. The body names all three boundaries and states that `brainstorm` is the
development-root identifier.

## Discovery check

The generated prompt, the `qwen_skill` declaration, and the `.qwen/settings.json` entry resolve
`.copilot/skills/brainstorm/SKILL.md`. `check:qwen-skills-sync` passes.
