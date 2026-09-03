# Phase NN: Fixture Context Plan

Phase-level context document for Phase 173 Step 1 integration tests. Mirrors the section
shape of real phase docs so the generator's Executive Summary / Constraints /
Design Decisions extraction has a faithful target.

## Executive Summary

**The Problem.** Generated requests carry no link to the phase's why.
**The Solution.** Embed curated context inline in each request body.
**The Goal.** Per-step requests that are self-sufficient for the common case.

A trailing sentence after the Goal paragraph is outside the bounded summary.

## Current State Analysis

### Constraints

- Keep requests concise per `scripts/plan_to_requests.ts` design.
- Never expose private submodule trees in the sandbox.
- Always keep the suite green with `deno task test`.

### Design Decisions

- Filter bullets by symbol overlap against the step slice.

## Implementation Plan

### Step 1: Do the thing

**Actions:**

1. Modify `scripts/plan_to_requests.ts`.
1. Add the extractor helpers.

**Architecture Notes:** Pure functions only.

**Planned Tests:**

- extractor behavior covered elsewhere

**Success Criteria:**

- [ ] done

```yaml
# step-manifest
step: 1
title: Do the thing
agent_role: senior-coder
skills: [tdd-methodology]
portal: exaix-self
target_branch: feat/phase-nn-step-1
depends_on: []
acceptance:
  tests:
    - "ok"
  outcomes:
    - "done"
```

---

### Step 2: Something unrelated

**Actions:**

1. Touch `unrelated_area.md` only.

**Architecture Notes:** No overlap with the constraints above.

**Planned Tests:**

- none

**Success Criteria:**

- [ ] done elsewhere

```yaml
# step-manifest
step: 2
title: Something unrelated
agent_role: senior-coder
portal: exaix-self
target_branch: feat/phase-nn-step-2
```
