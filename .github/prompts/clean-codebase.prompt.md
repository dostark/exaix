---
agent: agent
description: "Clean the repository so `deno check .`, `deno lint .`, `deno fmt .`, `deno run --allow-read scripts/validate_architecture.ts`, and `deno run -A scripts/check_code_style.ts` all pass with no errors, warnings, or violations."
tools:
  - git_status
  - search_files
  - patch_file
  - run_command
---

# Clean Codebase

Thin slash-command wrapper for the canonical cleanup workflow.

Canonical source of truth:

- `../../.copilot/prompts/clean-codebase.md`

Use this command to:

1. Run the repository cleanup workflow for build, lint, format, and style validation.
1. Follow the guidance defined in the canonical `.copilot` prompt.
1. Report only the minimal fixes needed to achieve clean validation.

Execution requirements:

1. Treat `../../.copilot/prompts/clean-codebase.md` as authoritative.
1. Do not introduce broad suppression or workaround changes unless explicitly justified.
1. Keep edits minimal and behavior-preserving.
1. Include architecture header validation via `deno run --allow-read scripts/validate_architecture.ts` as part of the cleanup verification.

Output format:

1. Summary of current failures.
2. Files changed and reasoning.
3. Validation result for `deno check .`, `deno lint .`, `deno fmt .`, and `deno run -A scripts/check_code_style.ts`.
