## Step 1 — Pre-gap analysis

```yaml
# step-manifest
step: 1
title: Pre-gap analysis
agent_role: code-analyst
depends_on: []
acceptance:
  tests:
    - "verifies readiness for implementation"
  outcomes:
    - "gap analysis output ready"
```

Analyze the codebase for any gaps.

---

## Step 2 — Implement feature

```yaml
# step-manifest
step: 2
title: Implement the feature
agent_role: dogfood-coder
depends_on: [1]
acceptance:
  tests:
    - "feature works correctly"
  outcomes:
    - "feature is implemented"
```

Build the feature described in the requirements.

---

## Step 3 — Post-gap review

```yaml
# step-manifest
step: 3
title: Post-gap review
agent_role: code-reviewer
depends_on: [2]
acceptance:
  tests:
    - "review passes"
  outcomes:
    - "review output ready"
```

Review the implementation for correctness.
