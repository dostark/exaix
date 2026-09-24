---
name: commit
agent: general
tools:
  - git_status
  - git_commit
  - search_files
  - run_command
scope: dev
title: "Commit Skill (#commit)"
description: Create a structured commit message for current changes following Exaix conventions
short_summary: "Enforces structured, informative commit messages for agents and human developers."
version: "1.0.2"
topics: ["git", "commit", "documentation", "best-practices", "structured-logging"]
qwen_skill: commit
---

````text
Key points
- Review changes with `git status` and `git diff` before committing.
- Unless the prompt explicitly says otherwise, include ALL current repository changes in the commit workflow: both already-staged changes and any unstaged changes you created or modified while doing the task.
- If the work contains more than one logically distinct change, split it into separate commits by logical batch unless the prompt explicitly requires a single combined commit.
- Ensure the series of commits covers all current staged and unstaged changes in the repository.
- Run the required pre-commit validation for the affected changes before proposing the final commit command.
- Use conventional commit format for the subject line: `<type>(<scope>): <summary>`.
- ALL commits (non-auto) MUST follow the Exaix structured format in the body.
- Wrap all body text at 72 chars.

Default commit scope and batching
- Start by reviewing both staged and unstaged changes with `git status`, `git diff --staged`, and `git diff`.
- If no narrower scope is stated in the prompt, assume the goal is to commit all current staged and unstaged changes in one or more logically bundled batches rather than only the staged subset.
- Stage files intentionally. If the changes represent multiple unrelated or loosely related concerns, group files into logically coherent batches and create one structured commit per batch.
- Only keep changes out of the commit when the prompt explicitly excludes them or the user has clearly indicated they are unrelated and should remain separate.
- When splitting into batches, each batch must still satisfy the full structured commit schema below.

⚠️ Branch safety
- Direct commits on `main` are blocked by a pre-commit hook (Gate 0).
- Always work on a feature branch: `git checkout -b <branch> main`.
- For CI hotfixes, create a `hotfix/<name>` branch from main, fix, PR, and merge.
- Only bypass the guard when main is already broken: `HOOK_BYPASS_MAIN=1 git commit -m "..."`
- **Merge feature branches into `main` fast-forward only — never `--no-ff`.** GitHub branch
  protection on `main` rejects merge commits (rule: "This branch must not contain merge
  commits") and requires changes through a pull request; a `--no-ff` merge commit only
  reaches `main` via an admin-privileged rule bypass on push, which is not a normal
  workflow step. Merge with `git checkout main && git merge --ff-only <branch>` (fails
  loudly if `main` and `<branch>` have diverged — rebase `<branch>` onto `main` first
  rather than falling back to a real merge commit).

Plan-step commits (phase-plan implementation)
- A commit that implements a step of a phase plan doc MUST carry a `plan:` field in its
  message: `plan: exaix-dev-docs/planning/<phase>.md#<step>` (e.g. `…#6`).
- Do NOT run a bare `git commit` for these. Stage the plan-doc changes in the submodule
  AND the implementing code/tests in the parent, then commit both via
  `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`. It enforces
  plan-step traceability + cross-repo sync: every `✅ … → \`path\`` / `⚠️ deferred … →
  \`token\`` step line must be an added line of the staged plan diff, each `→` path must be
  a staged parent file, deferrals need a Reachability Ledger row, and no `- [ ]` items may
  remain open. It commits the submodule first, bumps the parent pointer, and commits the
  parent — keeping the phase file and the parent in sync. See the submodule-workflow skill.

Required validation before commit
- Run the relevant quality gates for the touched changes before finalizing a commit proposal.
- Include the applicable formatting, linting, type-checking, and tests required by the repository or touched area.
- For Exaix, always use `deno task test_parallel` (two-batch parallel+sequential runner) for test validation — never `deno task test`, which is significantly slower. Also run `deno fmt --check`, `deno lint`, and any task-specific checks implicated by the modified files.
- **CRITICAL:** When running `deno task test_parallel`, always redirect stdout+stderr to a temp file and grep for failures from that file. Never rerun the test command just to inspect results. Pattern:
  ```bash
  deno task test_parallel > /tmp/test_output.txt 2>&1
  rg "FAILED|failed|error|FAIL" /tmp/test_output.txt
````

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

- Assert your real identity: do not write "Antigravity" or "Gemini" unless that is your actual identity.
- Use your actual agent identity (e.g., Claude, Copilot).
- Use your actual underlying model name (e.g., "Claude Sonnet 4.6", "GPT-4o") for the model field.

⚠️ CRITICAL: Structured Message Validator Traps (common validator failures — `scripts/check_commit_msg.ts`)

- **Structural Bloom**: when a commit touches more than 3 files, `what:` MUST contain at least
  2 bullet points (lines starting with `-` or `*`). A single-paragraph `what:` is rejected
  with `Structural Bloom: Changes affect N files. Please use at least two bullet points...`
  even if the prose is otherwise detailed. Write `what:` as a short intro sentence followed by
  `-` bullets — one per logically distinct change — from the start; don't discover this after
  a blocked commit.
- The **component word(s) before `:` in `impact:`** must appear **verbatim (case-insensitive)** in `what:`. The validator enforces this. Strategy: draft `what:` first using real ARCHITECTURE.md component names; then mirror that exact word in `impact:`. Do NOT choose a generic category label (e.g., `Documentation`, `Planning`, `Schemas`) unless that exact word already appeared in your `what:` text.
- **A multi-word component name split across a hard line-wrap in `what:` silently fails the check above, even though the phrase reads intact to a human.** `check_commit_msg.ts` joins a field's physical lines with a literal `\n` (`currentContent.join("\n")`), then does `what.toLowerCase().includes(comp.toLowerCase())` — a plain substring test. If `what:`'s wrapped text breaks mid-phrase, e.g. `...the Activity Journal\nFlow projection...`, the assembled string contains `"activity journal\nflow"`, which does **not** contain `"activity journal flow"` as a substring, so the check fails with the same "missing from the what: explanation" error as if the phrase were absent entirely — this recurred three times in one session (Phase 177 Steps 2, 3, and its post-gap-analysis pointer-bump commit) before being traced to the hidden line break. Fix: keep the entire multi-word component phrase on one physical line of `what:`, even if that line runs long — do not let your editor or a manual wrap split it.
- **Semicolons in `impact:` separate multiple `Component: detail` entries only.** Appending plain English clauses after a semicolon (e.g., `; no runtime changes.` or `; doc-only change.`) causes the validator to misread the clause as a spurious component name. Put such notes inside the `detail` part (e.g., `CompA: added X, no runtime changes`).
- **The `impact:` field's parsed text is everything from `impact:` to end-of-message, not just its own paragraph.** `check_commit_msg.ts`'s per-line parser only starts a new field on a line beginning with a name from `KNOWN_COMMIT_FIELDS` (`what`, `rationale`, `tests`, `who`, `impact`, `model`, `plan`, …) — any line after `impact:` that doesn't match one of those, including a blank-line-separated trailing summary paragraph (e.g. a `CI gates: ...` block appended at the end of the message), is folded into the SAME `impact` field body and then split on `;` for Component Traceability exactly like the `impact:` line itself. A trailing paragraph such as `CI gates: check:duplication (source 1.59%/2%, ...); full deno task test_parallel: 10392 passed...` produces spurious components (`"full deno task test_parallel"`) that fail the check even though the author intended it as an unrelated CI-status footer, not more `impact:` content. Put CI/test-run status inside `tests:` instead of a new trailing block, or if a trailing block is truly needed, keep every sentence in it colon-free.
- **Plan-step `→ path` lines: exactly ONE backtick-wrapped path after the arrow, nothing else.** `validatePlanStepDiff`'s `extractArrowPaths()` (invoked by `commit_plan_step.ts`) treats **every** backtick-wrapped token after `→` on a `- ✅ …`/`- ⚠️ deferred …` line as a required staged file path — not just the first one. A line like `→` `server.ts` `(uses` `Deno.serve()` `+` `StreamableHTTPClientTransport)` — i.e. code mentions placed AFTER the arrow — makes the gate also demand `Deno.serve()` and `StreamableHTTPClientTransport` be staged parent files, and it blocks with a confusing "not among this commit's changed files" error. Put any incidental backtick-wrapped code/type mentions in the sentence BEFORE the arrow; only the real path(s) go after it (multiple real paths: two backtick spans separated by a comma, e.g. `a.ts` then `b.ts`).
- **`extractArrowPaths()` anchors on the FIRST `→` in the whole joined bullet, not your completion arrow.** It does `line.indexOf("→")` then scans everything after that position for backtick spans. Phase-plan prose routinely narrates a pipeline with the same glyph (e.g. "capture → extract → approve → retrieve → reflect chain") — if that phrasing appears anywhere in a criterion's own text, that EARLIER arrow is what the parser anchors on, not the real completion arrow near the end. Every backtick-wrapped span between that first prose arrow and end-of-line — including ones on later wrapped physical lines, like an evidence-log path cited mid-sentence — gets swept in as a required staged path and fails with "is not among this commit's changed files" even though it sits BEFORE your actual `→ \`path\``. Fix: a criterion/test bullet that narrates a pipeline with`→` must contain NO other backtick-wrapped text anywhere in its body — move any such reference (an evidence-file path, a secondary code mention) out of the bullet into the step's Architecture Notes/Actions prose instead.
- **Plan-step diff check requires every PHYSICAL line of a multi-line bullet to be an added diff line — git's minimal diff can silently violate this.** `validatePlanStepDiff` collects each wrapped physical line of a completed criterion/test (not just the joined text) and requires each to appear as a `+` line of the staged plan-doc diff. If you complete a criterion by only changing its first physical line (`- [ ]` → `- ✅`) and its last (appending `→ \`path\``) while a middle wrapped line's text is untouched, git's diff algorithm may render that middle line as unchanged context rather than a delete+add — even though the criterion as a whole just became newly-completed — and the gate blocks with "is not an added line in the plan doc's diff for this commit." Fix: reword something in every physical line of the bullet (not just the endpoints) so git's diff can't collapse any line to unchanged context; verify with`git diff --cached -U1 -- <plan-doc>`before running`commit_plan_step.ts`that the full bullet span shows as`+` lines.
- **Fast-fail before the full gate.** For a plan-step message, validate the draft with `deno run --allow-read --allow-run=git scripts/check_commit_msg.ts <msg-file>` (~0.2s) BEFORE running `commit_plan_step.ts --commit`, which re-runs the entire ~15-task pre-commit gate suite (~10-15s) on every retry. Catches Structural Bloom / Component Traceability / arrow-path issues in under a second instead of paying the full gate cost per fix-retry cycle.
- **Adding one new bullet to an already-completed step is not a plan-step commit.** A `plan:` field
  makes `check_commit_msg.ts` require the changed file of EVERY `✅` item in that step, not just the
  bullet you added, so a docs-only addition (for example a live-run result appended to a finished step)
  fails with "…not among this commit's changed files" for the step's older items. Commit such an
  addition as an ordinary docs commit without a `plan:` field (submodule first, then the pointer bump).
- **Fast-fail false negative: gitlink-only arrow paths.** The fast standalone
  `check_commit_msg.ts` pre-check reads currently-staged files in the **parent repo only**.
  When a plan-step's _only_ `→` path is the submodule self-reference
  `→ \`exaix-dev-docs\``(the convention for a criterion/test whose module IS the plan doc
  itself — see #remediate-code-gaps' Phase 4 step 2), that pre-check will always report`"exaix-dev-docs" is not among this commit's changed files`, because`commit_plan_step.ts`only stages the`exaix-dev-docs`pointer bump **after** committing
  the submodule, partway through its own orchestration — after the fast pre-check has
  already run and failed. This is a false negative, not a real problem: skip the fast
  pre-check for a step whose criteria cite only the gitlink, and go straight to`commit_plan_step.ts --commit`, which stages the pointer at the right point in its own
  flow before the real gate runs.

Canonical prompt (short):
"You've completed [work]. Create a MANDATORY structured commit message.
Review all staged and unstaged changes first, split them into logical commit batches unless the prompt says otherwise, commit the full current scope in those batches, run the required pre-commit checks, then follow the schema: subject line, then what:, rationale:, tests:, who:, and impact: (grounded in ARCHITECTURE.md).
Identify yourself accurately — do not write 'Antigravity' or 'Gemini' unless that is your actual identity."

Examples:

- "feat(scripts): add commit validator (Step 1)

  what: Implemented validator script...
  rationale: To enforce rules...
  tests: 10/10 tests passed...
  who: Claude
  impact: scripts: added validation logic
  model: Claude Sonnet 4.6"

Do / Don't:

- ✅ Do use a blank line after the subject line.
- ✅ Do treat both staged and unstaged task changes as in scope by default.
- ✅ Do split unrelated or weakly related changes into separate structured commits.
- ✅ Do run the required linting, tests, and other pre-commit checks before proposing the final commit command.
- ✅ If the pre-commit hook fails (e.g., `fmt:check` or `lint`), fix the issue, re-stage the affected files, and retry `git commit` — never bypass with `--no-verify`.
- ✅ Do use `deno task test_parallel` for test validation — `deno task test` is too slow and should be avoided.
- ✅ Do redirect `deno task test_parallel` output to a temp file and grep for failures. Never rerun the command just to inspect results.
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
- ❌ Don't hallucinate model versions or agent names (do not write "Antigravity" or "Gemini"
  unless you are genuinely those agents — use your real provider/model identity).

Related skills:

- #next-steps — TDD step execution that ends with a commit
- #post-gap-analysis — Post-implementation review that ends with remediation commits
- #refactor-check-magic — Magic-value refactor that ends with a commit

Workflow chain (typical):
#plan → #pre-gap-analysis → #next-steps → #post-gap-analysis → **#commit**

Expected Response Pattern:

1. Review and summarize both staged and unstaged changes, then decide whether one commit or multiple logical batches are required.
1. Run and summarize the relevant pre-commit checks, or clearly identify what still must be run.
1. Show `git add` commands for the full intended scope, or one `git add` sequence per logical batch.
1. Show the corresponding structured `git commit` command for each batch using heredoc or multiple `-m` flags to ensure the full structured body is included.
1. Verify all mandatory headers are present and correctly filled for every proposed commit, and list any blocking validation issue.

```
## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules


## See also

- [next-steps](../next-steps/SKILL.md) — step-based workflow that commits per step
- [exaix-development](../exaix-development/SKILL.md) — CI gate conventions, branch rules
---
exaix:
  skill_id: commit
  related_skills: [exaix-development]
  triggers:
    keywords: [commit, git, stage, message]
    task_types: [feature, bugfix, refactor, docs, chore]
    tags: [commit, git]
  constraints:
    - "Review all staged and unstaged changes before committing"
    - "Split into logical batches when changes are unrelated"
    - "Run pre-commit validation before committing"
    - "Use conventional commit format for subject line"
    - "Include mandatory fields: what, rationale, tests, who, impact"
  output_requirements:
    - "Structured commit message with subject + body"
    - "Subject in conventional commit format"
    - "Body includes what, rationale, tests, who, impact"
    - "CI gates passing per commit batch"
  quality_criteria:
    - name: format_compliance
      description: Subject follows conventional commit format
      weight: 40
    - name: structural_completeness
      description: Body includes all mandatory fields
      weight: 30
    - name: ci_gate_compliance
      description: Pre-commit checks pass
      weight: 30
---
```
