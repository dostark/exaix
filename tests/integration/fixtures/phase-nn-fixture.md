# Phase NN: Fixture Plan

## Step 1

```yaml
# step-manifest
step: 1
title: Setup project structure
agent_role: senior-coder
skills: [exaix-conventions]
portal: exaix-self
target_branch: feat/phase-nn-step-1
depends_on: []
acceptance:
  tests:
    - "project structure exists"
    - "config files valid"
  outcomes:
    - "all tests pass"
```

**Actions:**

- Create project skeleton

**Architecture Notes:**

- Simple setup

**Planned Tests:**

- Test 1

**Success Criteria:**

- [x] Project structure ready

## Step 2

```yaml
# step-manifest
step: 2
title: Add core feature
agent_role: senior-coder
skills: [tdd-methodology]
portal: exaix-self
target_branch: feat/phase-nn-step-2
depends_on: [1]
acceptance:
  tests:
    - "feature works"
  outcomes:
    - "all tests pass"
```

**Actions:**

- Implement feature

**Architecture Notes:**

- Core logic

**Planned Tests:**

- Test 2

**Success Criteria:**

- [x] Feature implemented

## Step 3

```yaml
# step-manifest
step: 3
title: Wire integration
depends_on: [1]
acceptance:
  tests:
    - "integration works"
```

**Actions:**

- Wire everything together

**Architecture Notes:**

- Integration

**Planned Tests:**

- Test 3

**Success Criteria:**

- [x] Integration complete
