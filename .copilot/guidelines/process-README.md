---
agent: general
scope: dev
title: "Project Governance & Methodology"
short_summary: "Strategic guidelines for SDD, project lifecycle, and systemic improvement patterns."
version: "1.1"
topics: ["governance", "methodology", "sdd", "self-improvement"]
---

This document covers high-level governance rules, systemic methodologies, and project-wide patterns that define **how** Exaix is built and improved.

## Purpose

While `commands/` and `skills/` focus on tactical execution (how to do a task), these governance guidelines focus on **strategic quality**. They ensure that agents and humans follow consistent architectural patterns and quality loops throughout the repository's lifecycle.

## Governance Guidelines

- **[specification-driven-development.md](specification-driven-development.md)**: The core SDD pipeline. Ensures work is defined by a structured specification before code generation begins.
- **[review-research-improvement.md](review-research-improvement.md)**: A systematic pattern for evaluating subsystems and planning architectural upgrades.
- **[self-improvement.md](self-improvement.md)**: The loop for detecting and patching instruction gaps in `.copilot/` itself.

## When to use which

| Scenario                          | Location                                         | Reasoning                                  |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Preparing a commit                | `skills/commit/SKILL.md`                         | Tactical skill.                            |
| Reviewing a module's architecture | `guidelines/review-research-improvement.md`      | Systemic analysis and improvement pattern. |
| Refining a request with Q&A       | `guidelines/specification-driven-development.md` | High-level methodology for goal alignment. |
| Implementing next plan step       | `skills/next-steps/SKILL.md`                     | Tactical execution skill.                  |
| Noticing a doc is out of date     | `guidelines/self-improvement.md`                 | Feedback loop for instructions.            |

## Documentation Boundaries

- **Governance (here)**: Defines the rules of engagement and quality standards.
- **Skills** (`../skills/`): Defines multi-step autonomous workflows.
- **Commands** (`../commands/`): Defines short slash-command invocation prompts.
