---
agent: general
scope: dev
title: ".copilot/process/ — Project Governance & Methodology"
short_summary: "Strategic guidelines for SDD, project lifecycle, and systemic improvement patterns."
version: "1.0"
---

# Exaix Process Guidelines

This directory contains high-level governance rules, systemic methodologies, and project-wide patterns that define **how** Exaix is built and improved.

## Purpose

While `workflows/` focus on tactical execution (how to do a task), `process/` focuses on **strategic governance**. These documents ensure that agents and humans follow consistent architectural patterns and quality loops throughout the repository's lifecycle.

## Governance Guidelines

- **[specification-driven-development.md](specification-driven-development.md)**: The core SDD pipeline. Ensures work is defined by a structured specification before code generation begins.
- **[review-research-improvement.md](review-research-improvement.md)**: A systematic pattern for evaluating subsystems and planning architectural upgrades.
- **[self-improvement.md](self-improvement.md)**: The loop for detecting and patching instruction gaps in `.copilot/` itself.

## When to use `process/` vs `workflows/`

| Scenario                          | Location                                      | Reasoning                                  |
| --------------------------------- | --------------------------------------------- | ------------------------------------------ |
| Preparing a commit                | `workflows/commit.md`                         | Tactical operation task.                   |
| Reviewing a module's architecture | `process/review-research-improvement.md`      | Systemic analysis and improvement pattern. |
| Refining a request with Q&A       | `process/specification-driven-development.md` | High-level methodology for goal alignment. |
| Implementing next plan step       | `workflows/next-steps.md`                     | Tactical execution step.                   |
| Noticing a doc is out of date     | `process/self-improvement.md`                 | Feedback loop for instructions.            |

## Documentation Boundaries

- **Methodology (Process)**: Defines the rules of engagement.
- **Task (Workflow)**: Defines the steps of execution.
- **Prompt (Prompt)**: Defines the exact instructions send to the model.
