---
id: "550e8400-e29b-41d4-a716-446655440011"
created_at: "2026-06-20T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "step-execution"
name: "Step Execution Methodology (TDD)"
version: "1.0.0"
description: "Enforces the RED → GREEN → REFACTOR cycle per plan step: write failing tests first, implement minimally, run CI gates, and commit independently."

triggers:
  tags:
    - step-execution
    - next-steps

constraints:
  - "Write tests first (RED) before implementation (GREEN)"
  - "Run the relevant test file — new tests must fail before implementation"
  - "Implement the minimal code to make tests pass"
  - "Refactor only after all tests pass (GREEN)"
  - "Run deno task check clean before committing"
  - "Commit each step independently with a structured message"

output_requirements:
  - "Each step has its own commit"
  - "Commit message includes what, rationale, tests, CI results"

quality_criteria:
  - name: "TDD Compliance"
    description: "Tests were written before implementation for every behaviour change"
    weight: 40
  - name: "CI Gate Compliance"
    description: "All CI gates pass before each commit (lint, type-check, style, arch, magic)"
    weight: 30
  - name: "Commit Structure"
    description: "Each commit message follows the structured format with what, rationale, tests, CI gates"
    weight: 30

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Step Execution Methodology (TDD)

You are implementing a single step of a phase planning document. Follow the strict RED → GREEN → REFACTOR cycle.

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
