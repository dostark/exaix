---
name: implementation-plan
description: Create or revise a grounded implementation plan for a bounded feature, fix, or migration from agreed requirements. Produce the plan without implementing it.
---

# Implementation Planning

Give an implementer enough detail to execute the work without making unresolved product or architecture decisions.
Reuse an existing plan when it already meets the task's requirements.
Use the project's required output format and approval process.

## Establish scope and evidence

Read the supplied request, specification, and accessible linked decisions.
Use conversation context when no separate specification exists. Identify any missing source or material uncertainty.
Inspect existing terminology, accepted decisions, applicable standards, and the affected code.
Preserve settled choices. Ask only about material choices that available evidence cannot resolve.
Keep affected criteria pending until answered. Revise dependent assumptions when a decision changes.

State the goal, exclusions, current behavior, and required behavior with concrete examples.
Verify existing paths, symbols, signatures, and call sites before relying on them.
Mark proposed files and symbols as new. Do not present invented components as existing code.

## Choose the smallest workable design

Compare custom implementation with available configuration, existing tools, and simpler changes when the choice materially affects cost or risk.
Record the chosen approach, its rationale, and what the simpler alternative gives up.
Reuse settled cost decisions. Explain changed evidence before reopening an affected decision.

Trace changed inputs and outputs through their production consumers.
Specify contract values, error behavior, compatibility, and relevant security boundaries.
Identify required configuration, persistence, and documentation changes when applicable.
Avoid speculative abstractions and unrequested capabilities.
Plan targeted edits that preserve unrelated work. Avoid replacing large files for small changes.
Keep ordinary choices in the plan. Propose an ADR only for a consequential, hard-to-reverse tradeoff with non-obvious rationale.
Include meaningful alternatives and consequences when a proposal qualifies.

## Order bounded checkpoints

Start with the smallest complete production path before adding breadth.
Give each checkpoint one verifiable outcome, concrete deliverables, exclusions, and actual blocking dependencies.
Split work whose implementation and validation cannot fit a bounded checkpoint.
Do not create dependencies merely to force an arbitrary sequence.

For each behavior, identify its production entry point, changed contracts, affected consumers, and required wiring.
Specify focused tests at the boundary where the behavior is observable.
Use an independent expected result. Name the regression failure before the fix when behavior changes.
Retain contract-relevant interaction checks when retries, ordering, or authorization are the behavior.
A unit test alone cannot establish production wiring. Name an integration check through the real entry point.
If a prerequisite cannot be connected immediately, identify the concrete later wiring checkpoint and its acceptance test.
Do not declare the feature complete while required consumers remain unconnected.

## Handle broad mechanical migrations

Use expand, migrate, and contract only when independent end-to-end slices cannot land safely.
Explain the blocking compatibility constraint.
Expand with compatible old and new contracts. Move callers in bounded batches with focused checks.
Keep both contracts until every caller has moved. Verify the combined production path before removing the old contract.
Give each stage compatibility checks, rollback conditions, and actual dependency edges.
After contract, restoring an old caller may require restoring the compatible API first.
Do not use this exception to postpone new-feature wiring.

## Present and review the plan

Organize changes by behavior and dependency flow rather than an arbitrary file list.
Describe important file, type, and signature changes without writing the implementation diff.
Use examples, diagrams, or tables when they clarify a contract, transition, or tradeoff.
Include testable acceptance criteria, focused validation commands, failure cases, and relevant operational checks.
Record assumptions, unresolved decisions, risks, rollback conditions, and required documentation.
Scale detail to the change. Explain when automated tests do not apply and specify an observable manual check.

Review requirements coverage and scope, architecture and compatibility, then standards, tests, and operational risks.
Record independent review evidence when available, or state that independent review has not occurred.
Do not treat implementation that has not started as a defect in an otherwise sufficient plan.
Return the reviewable plan. Planning alone does not authorize implementation, publication, or changes to external systems.
