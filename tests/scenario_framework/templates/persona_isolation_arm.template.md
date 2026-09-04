# Template: Persona-Isolation Value Arm

```yaml
template_id: persona-isolation-arm
scope: tests/scenario_framework
introduced_by: phase-161-identity-persona-value-isolation.md
depends_on: phase-158-artefact-value-evaluation.md (ArmKind, computePairedComparison, agent-role-config overlay)
status: design-template # no code exists yet; this documents the target shape for implementers
```

## Overview

Phase 158 built ablation arms for skills (`skill-ablation`, `skill-version`), whole agent roles
(`agent-role-swap`), agent-role configuration (`agent-role-config`), and flows (`flow-ablation`,
`flow-swap`) — but no arm ever held an agent role's `model_size`/`capabilities`/`default_skills`/
`permitted_tools` constant while varying **only** the persona/voice prose body. That is exactly
the gap `phase-161-identity-persona-value-isolation.md` closes: a `persona-isolation` arm that
answers "does this agent role's persona text specifically earn its place, independent of the
skills/tools/model-size bundle it ships with?"

## When to Use

- You want to know whether an agent role's persona/voice prose (the markdown body after the
  frontmatter) contributes measurable value, isolated from its `default_skills`,
  `permitted_tools`, and `model_size`.
- You are **not** trying to compare two different agent roles against each other — use
  `agent-role-swap` for that (it deliberately varies the whole bundle).
- You are **not** trying to test whether a specific skill in `default_skills` matters — use
  `skill-ablation`/`agent-role-config` for that (they hold the persona body constant).

## Instructions

1. **Confirm the mechanism exists.** This template targets `ArmKind.PERSONA_ISOLATION`
   (Phase 161 Step 1). If it hasn't landed yet, this arm cannot be authored — do not fall back
   to `agent-role-config` and call it a persona test; that arm never touches the persona body.
1. **Author the three variant bodies** for the agent role under test:
   - **Shipped** — the real, unmodified markdown body from `Blueprints/Agents/<id>.md`.
   - **Generic control** — a fixed, agent-role-neutral stand-in: `"You are a helpful assistant.
     Follow your skills for methodology and output format."` (the same string for every
     agent role under test — it must not itself carry role-specific content, or the comparison
     stops being a persona-vs-no-persona test).
   - **Empty control** — no system-prompt body at all.
1. **Overlay, don't edit.** Use the `agent-role-config` overlay mechanism
   (`EXA_EVAL_AGENT_ROLE_OVERLAY_DIR`, `packages/request/src/blueprint_resolver.ts`) to swap only
   the markdown body while leaving the frontmatter (`model_size`, `capabilities`,
   `default_skills`, `permitted_tools`) byte-identical across all three variants. Never edit the
   shipped `Blueprints/Agents/<id>.md` file itself.
1. **Pre-register** the comparison (arm id, `ArmKind.PERSONA_ISOLATION`, the three variant
   descriptions, the task set, `n=3` trial count, and the one metric) before any trial runs —
   `validatePreregistration` rejects anything outside the declared set, per the house discipline
   `tests/scenario_framework/README.md`'s "Value Evaluation — Arm Authoring" section already
   establishes for every other arm kind.
1. **Run mechanics evidence + a placebo arm alongside it** — a value result with neither is
   inadmissible (`tests/scenario_framework/runner/validity_gate.ts`), the same rule every other Phase 158 arm follows.
1. **Report via the shared script**, never by hand-transcribing numbers:
   `deno run -A scripts/run_value_comparison_report.ts <collected-run-data>.json`.

## Output Format

A `persona-isolation` arm produces the same paired-comparison shape every other Phase 158 arm
does — mean Δ, stdev, `noEffect` verdict, task count, basis run ids — but with **two** deltas per
agent role instead of one:

```json
{
  "armId": "persona-isolation-senior-coder",
  "kind": "persona-isolation",
  "agentRole": "senior-coder",
  "variants": {
    "shippedVsGeneric": { "meanDelta": 0.00, "stdevDelta": 0.01, "noEffect": true, "n": 3 },
    "shippedVsEmpty": { "meanDelta": 0.01, "stdevDelta": 0.02, "noEffect": true, "n": 3 }
  },
  "taskCount": 2,
  "basisRunIds": ["run-a1", "run-b2", "run-c3"]
}
```

## Complete Worked Example — `senior-coder`

This is the concrete shape Phase 161 Step 2 runs first, since `senior-coder` is the agent role
Phase 158's own `agent-role-swap` arm already measured (against `test-engineer`) — reusing the
same corpus task (`write-tests-uncovered`) lets the persona-isolation result sit next to the
already-published agent-role-swap number for comparison.

```yaml
# tests/scenario_framework/scenarios/swe_tasks/write-tests-uncovered-persona-generic.yaml
# (illustrative — lands with Phase 161 Step 2)
steps:
  - id: control-arm
    type: submit-request
    env:
      EXA_EVAL_AGENT_ROLE_OVERLAY_DIR: "fixtures/agent_role_overlays/senior-coder-generic-persona/"
      # overlay dir contains ONLY a persona-body override; model_size/capabilities/
      # default_skills/permitted_tools inherit from the shipped senior-coder.md frontmatter
```

```typescript
// Illustrative arm registration (Phase 161 Step 1 lands the real ArmKind + builder)
const armSpec: IArmComparisonSpec = {
  armId: "persona-isolation-senior-coder",
  kind: ArmKind.PERSONA_ISOLATION,
  control: { description: "generic persona, senior-coder skills/tools/model_size" },
  treatment: { description: "shipped senior-coder persona, same skills/tools/model_size" },
  taskIds: ["write-tests-uncovered", "fix-bug-null-guard"],
  trials: 3,
};
```

## Customization Points

| Point                     | `senior-coder` (worked example)                                                                                                                                                                                                                                                 | What a new persona-isolation run customizes                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Generic-control body      | `"You are a helpful assistant. Follow your skills for methodology and output format."`                                                                                                                                                                                          | Keep this string **identical across every agent role under test** — varying it defeats the isolation   |
| Task selection            | `write-tests-uncovered`, `fix-bug-null-guard` (reuses Phase 158's agent-role-swap task for direct comparability)                                                                                                                                                                | Any `swe_tasks` corpus task whose `family` plausibly routes to the agent role's `capabilities`         |
| Trial count               | `n=3` (matches the skill-value tier's full-trial count)                                                                                                                                                                                                                         | Raise for agent roles where a screening pass suggests a borderline effect worth confirming at higher n |
| Empty-control feasibility | Some agent roles may have a `response-contract` skill that itself assumes a persona-set role voice — if the empty variant breaks the output contract structurally, that's itself a finding (the "skills" layer implicitly depends on persona framing), not a bug to work around |                                                                                                        |

## Notes

- This template documents a **target design**, not shipped code — `ArmKind.PERSONA_ISOLATION` is
  introduced by Phase 161 Step 1 (🚧 Planning as of this writing, itself building on Phase 158,
  ✅ Phase Closed). Re-check Phase 161's current `Status` before treating this as a literal API
  reference.
- Do not conflate this arm with `agent-role-swap` (compares two agent roles, whole bundle
  confounded) or `agent-role-config` (varies `default_skills` only, never the persona body) — see
  `tests/scenario_framework/README.md`'s "Value Evaluation — Arm Authoring & Pre-Registration"
  section for the full arm-kind table.
