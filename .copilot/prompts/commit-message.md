---
agent: general
scope: dev
title: "Detailed Commit Message Prompt (#commit)"
short_summary: "Enforces structured, informative commit messages for agents and human developers."
version: "0.3"
topics: ["git", "commit", "documentation", "best-practices", "structured-logging"]
---

```text
Key points
- Review changes with `git status` and `git diff` before committing.
- Unless the prompt explicitly says otherwise, include ALL current repository changes in the commit workflow: both already-staged changes and any unstaged changes you created or modified while doing the task.
- If the work contains more than one logically distinct change, split it into separate commits by logical batch unless the prompt explicitly requires a single combined commit.
- Run the required pre-commit validation for the affected changes before proposing the final commit command.
- Use conventional commit format for the subject line: `<type>(<scope>): <summary>`.
- ALL commits (non-auto) MUST follow the Exaix structured format in the body.
- Wrap all body text at 72 chars.

Default commit scope and batching
- Start by reviewing both staged and unstaged changes with `git status`, `git diff --staged`, and `git diff`.
- If no narrower scope is stated in the prompt, assume the goal is to commit all relevant current changes rather than only the staged subset.
- Stage files intentionally. If the changes represent multiple unrelated or loosely related concerns, group files into logically coherent batches and create one structured commit per batch.
- Only keep changes out of the commit when the prompt explicitly excludes them or the user has clearly indicated they are unrelated and should remain separate.
- When splitting into batches, each batch must still satisfy the full structured commit schema below.

Required validation before commit
- Run the relevant quality gates for the touched changes before finalizing a commit proposal.
- At minimum, include applicable formatting, linting, type-checking, and tests required by the repository or touched area.
- For Exaix, prefer the repository-standard checks when they are relevant to the change, such as `deno fmt --check`, `deno lint`, `deno task test_parallel` (two-batch parallel+sequential runner), and any task-specific checks implicated by the modified files.
- The pre-commit hook auto-regenerates and stages `.copilot/manifest.json` whenever `.copilot/` sources are staged — you do NOT need to run `build_agents_index.ts` manually.
- If a required check was not run, say so explicitly in `tests:` and treat that as a blocking issue before an actual commit.
- Do not present the final `git commit` command as ready to run if known required checks are failing.

Mandatory Schema:
[type]: [subject]

what: <detailed explanation on what this commit is about>
rationale: <why this change was made>
tests: <which tests were used for validation and their summary status>
who: <agent name (e.g., Antigravity)>
impact: <component from ARCHITECTURE.md>: <details of impact>

Optional Fields:
conversation_id: <originating session ID>
links: <links to plan or issue>
prompt: <summary of the prompt(s) used>
tool_audit: <list of key tools used (e.g., run_command, replace_file_content)>
model: <YOUR actual model name and version>

⚠️ CRITICAL: Identity Accuracy
- DO NOT hallucinate your model name or agent name.
- Identify yourself as "Antigravity".
- Use the actual underlying model name (e.g., "Gemini") for the model field.

⚠️ CRITICAL: Impact Field Traps (common validator failures)
- The **component word(s) before `:` in `impact:`** must appear **verbatim (case-insensitive)** in `what:`. The validator enforces this. Strategy: draft `what:` first using real ARCHITECTURE.md component names; then mirror that exact word in `impact:`. Do NOT choose a generic category label (e.g., `Documentation`, `Planning`, `Schemas`) unless that exact word already appeared in your `what:` text.
- **Semicolons in `impact:` separate multiple `Component: detail` entries only.** Appending plain English clauses after a semicolon (e.g., `; no runtime changes.` or `; doc-only change.`) causes the validator to misread the clause as a spurious component name. Put such notes inside the `detail` part (e.g., `CompA: added X, no runtime changes`).

Canonical prompt (short):
"You've completed [work]. Create a MANDATORY structured commit message.
Review all staged and unstaged changes first, split them into logical commit batches unless the prompt says otherwise, run the required pre-commit checks, then follow the schema: subject line, then what:, rationale:, tests:, who:, and impact: (grounded in ARCHITECTURE.md).
Ensure you identify your actual model correctly (e.g., Gemini) to prevent hallucinations."

Examples:
- "feat(scripts): add commit validator (Step 1)

  what: Implemented validator script...
  rationale: To enforce rules...
  tests: 10/10 tests passed...
  who: Antigravity
  impact: scripts: added validation logic
  model: Gemini"

Do / Don't:
- ✅ Do use a blank line after the subject line.
- ✅ Do treat both staged and unstaged task changes as in scope by default.
- ✅ Do split unrelated or weakly related changes into separate structured commits.
- ✅ Do run the required linting, tests, and other pre-commit checks before proposing the final commit command.
- ✅ Do reference specific components from ARCHITECTURE.md in the impact field.
- ✅ Do list actual tool usage in tool_audit.
- ✅ Do include your real identity.
- ✅ Do ensure the component word(s) before `:` in `impact:` appear verbatim (case-insensitive) in `what:`. Write the `what:` first, pick a component name that already appears there, then write `impact:`.
- ✅ Do use semicolons in `impact:` only to separate multiple `Component: details` entries (e.g., `CompA: detail; CompB: detail`). Never append plain English clauses after a semicolon (e.g., `; no runtime changes.`) — write them inside the `details` position instead.
- ❌ Don't use a single paragraph for everything.
- ❌ Don't ignore unstaged task changes just because they are not staged yet, unless the prompt narrows scope.
- ❌ Don't bundle unrelated changes into one commit when they can be separated cleanly.
- ❌ Don't present an actual commit as ready if required checks are failing or were skipped without being called out.
- ❌ Don't skip mandatory fields like rationale or tests.
- ❌ Don't use --no-verify.
- ❌ Don't hallucinate model versions.

Expected Response Pattern:
1. Review and summarize both staged and unstaged changes, then decide whether one commit or multiple logical batches are required.
2. Run and summarize the relevant pre-commit checks, or clearly identify what still must be run.
3. Show `git add` commands for the full intended scope, or one `git add` sequence per logical batch.
4. Show the corresponding structured `git commit` command for each batch using heredoc or multiple `-m` flags to ensure the full structured body is included.
5. Verify all mandatory headers are present and correctly filled for every proposed commit, and list any blocking validation issue.
```
