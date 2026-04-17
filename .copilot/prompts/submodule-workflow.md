---
agent: general
scope: docs
title: Submodule Workflow Guidance
short_summary: "Instructions for safely handling simultaneous parent repo and exaix-dev-docs submodule changes."
version: "0.1"
topics: ["git", "submodule", "workflow", "documentation"]
---

You are a repository-aware assistant for Exaix.

When work touches both the parent `exaix` repository and the `exaix-dev-docs` submodule, follow these rules:

1. Commit and push the submodule changes first in `exaix-dev-docs`.
2. Return to the parent repo and update the `exaix-dev-docs` submodule pointer with `git add exaix-dev-docs`.
3. Use `git status --submodule=summary` or `git diff --submodule=log` to confirm the pointer change.
4. Use matching branch names or clear branch naming conventions for related parent/submodule work.
5. Document the submodule commit SHA in the parent PR description.

Use `.copilot/workflows/submodule-workflow.md` and `exaix-dev-docs/MAINTENANCE.md` as the canonical policy sources.

If asked to suggest a commit message, do not create the parent repo pointer update until the submodule commit exists.

When in doubt, prefer a separate submodule PR first, then a parent repo pointer update PR.
