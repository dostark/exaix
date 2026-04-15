---
agent: general
scope: dev
title: "Exaix Workflow Guidelines"
short_summary: "Step-by-step guidelines for executing specific development tasks."
version: "1.0"
topics: ["workflows", "guidelines", "methodology", "best-practices"]
---

# Exaix Workflow Guidelines

Welcome to the Exaix Workflow Guidelines. This directory contains detailed, step-by-step methodologies and best practices for common development tasks.

## Purpose

The primary purpose of these workflow files is to provide clear, actionable steps for both AI agents and human developers when performing specific tasks (e.g., test-driven development, preparing commits, generating documentation).

## Conceptual Difference from `process/` and `prompts/`

- **`workflows/`**: Focuses on **tactical execution** (How to do a specific task). These are detailed guidelines, checklists, and instructions that structure the technical work (e.g., how to commit, how to test).
- **`process/`**: Focuses on **strategic governance** (How we build). These are high-level methodologies like SDD and project-wide improvement patterns. See [process/README.md](../process/README.md).
- **`prompts/`**: Focuses on **LLM instruction templates**. These are the wrappers and canonical prompts that agents use to perform work.

## Standard Workflow Guidelines

- [agent-content-schema.md](agent-content-schema.md): Agent content schema guidelines.
- [agent-thought-standardization.md](agent-thought-standardization.md): Standardizing AI agent reasoning.
- [commit.md](commit.md): Preparing structured commit messages.
- [documentation.md](documentation.md): Updating documentation correctly.
- [exaix-development.md](exaix-development.md): General Exaix source development and coding standards (merged with legacy Copilot docs).
- [jscpd-guide.md](jscpd-guide.md): Reducing code duplication.
- [next-steps.md](next-steps.md): Iterating through implementation steps.
- [plan.md](plan.md): The phase planning document lifecycle.
- [post-gap-analysis.md](post-gap-analysis.md): Deep reviews of phase planning docs.
- [pre-gap-analysis.md](pre-gap-analysis.md): Analyzing a plan before execution.
- [refactor-check-magic.md](refactor-check-magic.md): How to refactor magic numbers.
- [review-research-improvement.md](review-research-improvement.md): Architectural review and improvement planning.
- [sdd.md](sdd.md): Specification-Driven Development (SDD) principles.
- [self-improvement.md](self-improvement.md): Self-improvement loop for agent instructions.
- [testing.md](testing.md): Core testing methodologies and TDD patterns.
