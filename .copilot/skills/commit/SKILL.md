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
- Unless the prompt excludes them, include ALL current changes: staged and unstaged.
- Split logically distinct changes into separate commits.
- Ensure the commits cover all current staged and unstaged changes.
- Run the pre-commit validation for the affected changes before proposing the command.
- Subject line: conventional format `<type>(<scope>): <summary>`.
- Body: every non-auto commit follows the Exaix structured format. Wrap body at 72 chars.

Default scope and batching

- Start by reviewing `git status`, `git diff --staged`, and `git diff`.
- No narrower scope named? Assume every current change is in scope, bundled logically.
- Stage intentionally: group loosely related changes, commit one batch each.
- Keep a change out of a commit only when the prompt or user excludes it.
- Every batch must still satisfy the full structured schema.

⚠️ Branch safety

- Direct commits on `main` are blocked by a pre-commit hook (Gate 0).
- Work on a feature branch: `git checkout -b <branch> main`.
- CI hotfixes: create `hotfix/<name>`, fix, PR, merge.
- Bypass only when main is already broken: `HOOK_BYPASS_MAIN=1 git commit -m "..."`.
- Merge feature branches into `main` **fast-forward only, never `--no-ff`**: branch
  protection rejects merge commits. Use `git checkout main && git merge --ff-only
  <branch>`; if diverged, rebase `<branch>` onto `main` first.

Plan-step commits (phase-plan implementation)

- A plan-step commit MUST carry `plan: exaix-dev-docs/planning/<phase>.md#<step>`.
- Do NOT run a bare `git commit`. Stage the plan-doc changes in the submodule AND the
  code/tests in the parent, then commit both via
  `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`.
  It enforces traceability + cross-repo sync: every `✅ … → \`path\`` / `⚠️ deferred … →
  \`token\`` line is an added staged-plan line; each `→` path is a staged parent file;
  deferrals have a Reachability Ledger row; no `- [ ]` stays open. It commits the
  submodule first, bumps the parent pointer, then commits the parent.

Required validation before commit

- Run the applicable quality gates for the touched changes.
- Include formatting, linting, type-checking, and tests required by the touched area.
- Test validation: always `deno task test_parallel` (two-batch parallel+sequential) —
  never `deno task test`. Also run `deno fmt --check`, `deno lint`, and task-specific
  checks.
- **CRITICAL:** redirect `deno task test_parallel` to a temp file and grep failures.
  Never rerun the command just to inspect results:
  ```bash
  deno task test_parallel > /tmp/test_output.txt 2>&1
  rg "FAILED|failed|error|FAIL" /tmp/test_output.txt
  ```
- The pre-commit hook regenerates and stages `.copilot/manifest.json` when `.copilot/`
  sources are staged — do not run `build_agents_index.ts` manually.
- A required check you did not run: state it in `tests:` and treat it as blocking.
- Do not present a `git commit` as ready while known checks fail.

Mandatory schema:

[type]: [subject]

what: <what this commit is about>
rationale: <why>
tests: <tests and summary status>
who: <agent name>
impact: <ARCHITECTURE.md component>: <detail>

Optional fields: conversation_id, links, prompt, tool_audit, model.

⚠️ Identity accuracy

- Assert your real identity and model. Never write "Antigravity" or "Gemini" unless it is
  genuinely yours.

⚠️ Validator traps (scripts/check_commit_msg.ts)

- **Structural Bloom**: >3 files changed makes `what:` require at least 2 bullet points.
  Write `what:` as an intro sentence plus one bullet per logical change. A single
  paragraph is rejected.
- **Component traceability**: the word(s) before `:` in `impact:` must appear verbatim in
  `what:` (case-insensitive). Draft `what:` first with real component names, then mirror
  them in `impact:`. Do not pick a generic label absent from `what:`.
- **Multi-word wrap trap**: the check joins `what:`'s physical lines with `\n` and does a
  plain substring test. A multi-word component phrase split across a line wrap fails
  (e.g. `Activity Journal\nFlow` ≠ "activity journal flow"). Keep the whole phrase on one
  physical line.
- **Semicolons in `impact:`** separate `Component: detail` entries only. Appending a plain
  clause after `;` (e.g. `; no runtime changes.`) misreads it as a component. Put such
  notes inside the detail.
- **`impact:` swallows trailing text**: the field runs to end-of-message. A trailing
  `CI gates: …` paragraph folds into `impact:` and its `;` splits become spurious
  components. Put CI/test status in `tests:`; keep any trailing block colon-free.
- **Arrow paths**: `extractArrowPaths()` treats every backtick token AFTER the first `→`
  on a `- ✅ …`/`- ⚠️ deferred …` line as a required staged file. Put incidental
  backticked mentions BEFORE the arrow; only real paths after it.
- **First `→` anchors**: the parser anchors on the FIRST `→` in the bullet, scanning
  everything after it. A criterion narrating a pipeline (`capture → extract → …`) with any
  other backticked text after it sweeps those in as required paths. Keep such bullets free
  of other backticks; move references to Architecture Notes/Actions prose.
- **Every physical line must be added**: `validatePlanStepDiff` requires each wrapped
  physical line of a completed bullet to be an added diff line. Reword every physical
  line (not just the endpoints) so git cannot collapse one to unchanged context. Verify
  with `git diff --cached -U1 -- <plan-doc>`.
- **Fast-fail**: validate a plan-step message first with
  `deno run --allow-read --allow-run=git scripts/check_commit_msg.ts <msg>` (~0.2s) before
  `commit_plan_step.ts --commit` (~10-15s). One exception below.
- **Adding one new bullet to an already-completed step is not a plan-step commit**: a `plan:` field makes the check
  require the changed file of EVERY ✅ item in that step. Commit such an addition as an
  ordinary docs commit without `plan:` (submodule first, then pointer bump).
- **Gitlink-only arrow paths (false negative)**: a step whose only `→` path is
  `→ \`exaix-dev-docs\`` fails the fast pre-check (it reads staged parent files only, and
  the pointer is staged later). Skip the fast pre-check in that case and go straight to
  `commit_plan_step.ts --commit`.

Canonical prompt (short):
"You've completed [work]. Create a MANDATORY structured commit message.
Review all staged and unstaged changes first, split them into logical commit batches
unless the prompt says otherwise, commit the full current scope in those batches, run
the required pre-commit checks, then follow the schema: subject line, then what:,
rationale:, tests:, who:, and impact: (grounded in ARCHITECTURE.md). Identify yourself
accurately."

Examples:

- "feat(scripts): add commit validator (Step 1)

  what: Implemented validator script...
  rationale: To enforce rules...
  tests: 10/10 tests passed...
  who: Claude
  impact: scripts: added validation logic
  model: Claude Sonnet 4.6"

Do / Don't

- ✅ Use a blank line after the subject line.
- ✅ Treat staged and unstaged task changes as in scope by default.
- ✅ Split unrelated changes into separate structured commits.
- ✅ Run the required pre-commit checks before proposing the command.
- ✅ On hook failure (fmt:check, lint), fix and retry `git commit` — never `--no-verify`.
- ✅ Use `deno task test_parallel` for test validation — not the slower `deno task test`.
- ✅ Redirect test_parallel output to a temp file and grep failures.
- ✅ Ground `impact:` in ARCHITECTURE.md components.
- ✅ List actual tool usage in tool_audit; include your real identity.
- ✅ Ensure the component word in `impact:` appears verbatim in `what:`.
- ✅ Use semicolons in `impact:` only between `Component: detail` entries.
- ❌ Use a single paragraph for everything.
- ❌ Ignore unstaged task changes, unless the prompt narrows scope.
- ❌ Bundle unrelated changes into one commit when separable.
- ❌ Present a commit as ready while checks fail or were skipped uncalled.
- ❌ Skip mandatory fields (rationale, tests, who, impact).
- ❌ Use `--no-verify`.
- ❌ Hallucinate model versions or agent names.

Related skills: #next-steps, #review-phase-code, #refactor

Workflow chain: #plan → #review-phase-plan → #next-steps → #review-phase-code → **#commit**

Expected response pattern:

1. Review and summarize staged and unstaged changes; decide commit count/batches.
1. Run and summarize the relevant pre-commit checks (or state what still must run).
1. Show the `git add` commands for the full intended scope.
1. Show the structured `git commit` command per batch.
1. Verify all mandatory headers; list any blocking validation issue.
````

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
