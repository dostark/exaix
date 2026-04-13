---
description: Create a structured commit message for current changes following Exaix conventions
---

# Commit current changes

Thin slash-command wrapper for the canonical commit workflow.

## Canonical source of truth

- `.copilot/prompts/commit-message.md`
- `Blueprints/Skills/commit-message.skill.md`

## Use this command to

1. Inspect current repository changes with `git status`, `git diff --staged`, and `git diff`.
1. Follow the exact structured commit format and commit-scope rules defined in `.copilot/prompts/commit-message.md`.
1. Run the required linting, tests, and other pre-commit checks relevant to the touched files. For test validation use `deno task test_parallel`.
1. Split the changes into logically related commit batches unless the prompt explicitly requires a single combined commit.
1. Output the full commit message and the final `git add` and `git commit` commands for each batch.

## Execution requirements

1. Assume `.copilot/prompts/commit-message.md` is authoritative if this wrapper conflicts with it.
1. Do not duplicate or invent a different commit schema here.
1. Require the mandatory fields `what:`, `rationale:`, `tests:`, `who:`, and `impact:`.
1. Reference `ARCHITECTURE.md` for valid `impact:` component grounding.
1. Do not use `--no-verify`.
1. Unless the prompt explicitly narrows scope, treat both staged and unstaged task changes as part of the commit workflow.
1. If multiple logical batches are needed, provide one structured commit message and one exact commit command per batch.
1. If required checks fail or were not run, report that as a blocking issue and do not present the commit as ready.
1. **Branch safety**: Direct commits on `main` are blocked by a pre-commit hook (Gate 0). Always work on a feature branch. For CI hotfixes, create a `hotfix/<name>` branch.
1. **Git state check**: Before committing, verify `git status --porcelain` and `git rev-parse --abbrev-ref HEAD` show expected state.

## Output format

1. Short summary of current changes and the proposed logical batch split.
1. Summary of the required pre-commit checks that were run, including failures or skipped checks.
1. Full proposed structured commit message for each batch.
1. Exact `git add` and `git commit` command to run for each batch.
1. Any blocking validation issue that must be fixed before commit.
