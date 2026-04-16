---
agent: agent
description: "Review and apply the submodule workflow policy for concurrent parent repo and exaix-dev-docs changes."
tools:
  - search_files
  - git_status
  - run_command
---

# Submodule Workflow Guidance

Thin slash-command wrapper for the canonical submodule workflow guidance.

Canonical source of truth:

- `../../.copilot/prompts/submodule-workflow.md`
- `.copilot/workflows/submodule-workflow.md`
- `exaix-dev-docs/MAINTENANCE.md`

Use this command to:

1. Confirm whether a change spans the parent repo and the `exaix-dev-docs` submodule.
2. Ensure submodule edits are committed first, then update the parent repo pointer.
3. Verify the submodule pointer using `git status --submodule=summary`.
4. Suggest correct branch and PR naming for cross-repo work.
