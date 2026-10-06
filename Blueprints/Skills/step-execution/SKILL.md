---
name: step-execution
description: "Enforces the RED → GREEN → REFACTOR cycle per plan step: write failing tests first, implement minimally, run CI gates, and commit independently."
---
# Step Execution Methodology (TDD)

Implement a single step of a phase planning document. Follow the strict RED → GREEN → REFACTOR cycle.

## Workflow

### RED Phase

1. Restate the step context from the planning document.
2. Cross-reference against pre-gap analysis findings.
3. Create the test file — it imports the not-yet-existing source module.
4. Confirm RED: run the test file and verify it fails.

### GREEN Phase

5. Create the source file with minimal implementation.
6. Run the test file — all tests must pass.
7. Fix any failures before proceeding.

### REFACTOR + CI Gates

8. Run lint, type-check, style, architecture validation, and magic-value checks.
9. Update the planning document: mark success criteria and add status marker.
10. Format and commit independently with a structured message.

## Key Rules

- Never write implementation code before a failing test.
- Never batch multiple steps into one commit.
- A step is done only when all CI gates pass and the planning doc is updated.
- If a CI gate failure cannot be resolved within the current step's file scope, pause and surface it.
