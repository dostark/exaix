# Phase 235 Step 2 — refactor skill manual review

- Reviewer: DeepSeek V4.1 Flash 1017 (opencode-go)
- Date: 2026-11-12
- Skill: `.copilot/skills/refactor`
- Method: document review of the edited guidance. No live model run.
- `SKILL.md` sha256: `13a04b7ea0bc527b2e328df50cb5619552210d7df164acd638befb8fe4eb9a80`
- `exaix.yaml` sha256: `0cf44a7aa5fe1ab0f2c00772f5d674139a52010ff252af8b196b9402bde8257a`

## Limitation

This record shows that the guidance covers each case. It does not measure model behavior,
task outcomes, or value. A live run is still required before any behavioural claim.

## Cases

| Case | Input | Expected | Observed rule | Outcome |
| --- | --- | --- | --- | --- |
| `p235-s2-c1` | A facade that forwards every method | Reconsidered; not accepted for being smaller | `Depth and locality`: "A pass-through wrapper that adds a concept and hides nothing is not an improvement"; `Do / Don't`: "Extract an interface only because it is smaller" | pass (document review) |
| `p235-s2-c2` | A cohesive extraction that centralises knowledge | Accepted, behavior unchanged | `Locality` and `Caller cost` questions; `Key points`: "No behavior change: tests pass BEFORE and AFTER" | pass (document review) |
| `p235-s2-c3` | A thin governance adapter | Retained as a boundary | `Boundaries stay`: "never remove a permission or governance adapter for being thin" | pass (document review) |
| `p235-s2-c4` | A material interface extraction | Baseline plus two alternatives, each with caller, failure, invariants, errors, dependency strategy, test boundary, and a reasoned recommendation | `Material interface change` paragraph lists all seven items and requires a recommendation | pass (document review) |
| `p235-s2-c5` | A behavior-preserving redesign | Permission adapters and existing tests retained | `Boundaries stay`: "never delete required tests because a deeper interface is proposed; keep constructor DI" | pass (document review) |

## Exclusions checked

- Routine mechanical refactors are exempt from the comparison record.
- No trigger, tool, id, or quality-weight change.
- No rule forbids an existing required interface.
