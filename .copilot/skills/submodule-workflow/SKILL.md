---
name: submodule-workflow
agent: copilot
tools:
  - git_status
  - git_commit
  - git_create_branch
  - run_command
  - read_file
  - patch_file
scope: dev
title: "Submodule Workflow Skill (#submodule-workflow)"
description: Manage simultaneous parent repo and exaix-dev-docs submodule changes safely with correct pointer policy
short_summary: "Correct handling of simultaneous parent repo and exaix-dev-docs submodule changes."
version: "1.0.1"
topics: ["git", "submodule", "docs", "workflow"]
qwen_skill: submodule-workflow
---

Key points

- exaix-dev-docs and exaix-team are real Git submodules, not nested folders.
- The parent stores only a pointer to each submodule commit.
- A broken flow leaves the parent pointing at a detached or uncommitted submodule state.
- Commit submodule changes FIRST, then update the parent pointer — **except plan-step
  commits** (parent message carries `plan:`), which commit both together via
  `scripts/commit_plan_step.ts` so the phase file and parent stay in sync. The exception
  applies only to `exaix-dev-docs` planning docs — `exaix-team` is source, so it always
  follows the submodule-first rule.

Canonical prompt (short):
"Update exaix-dev-docs submodule for {goal}: commit submodule change first, push it,
then update the parent repo pointer and commit with the submodule SHA reference."

Core policy

1. Make the change in the submodule — docs/planning in exaix-dev-docs/, Team source/tests in exaix-team/.
2. Commit and push that change in the submodule.
3. In the parent, `git add exaix-dev-docs` (or exaix-team) after the submodule commit exists.
4. Commit the pointer update, referencing the submodule SHA.
5. Keep matching branch names: `feat/<feature>` + `feat/<feature>-docs`.

Plan-step commits (exception — commit both together, staged)

A plan-step commit implements a step of a plan doc (exaix-dev-docs/planning/). Its parent
message carries `plan:`, e.g. `plan: exaix-dev-docs/planning/phase-134-model-registry.md#6`.
For these, do NOT commit the submodule first:

1. Stage the plan-doc changes in the submodule (`git -C exaix-dev-docs add planning/<phase>.md`).
   The step's `✅ … →`path``/ `⚠️ deferred … → `token`` lines must be staged there.
2. Stage the implementing code + tests in the parent (the `→` paths must be staged files).
3. Run `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`. It validates
   cross-repo consistency (every ✅/deferred line is an added staged-plan line; `→` paths
   are staged parent files; no open `- [ ]`; ledger rows for deferrals), then commits the
   submodule, stages the pointer, and commits the parent.
4. Blocked with **roll back the submodule's last commit**? The submodule was committed
   separately. Fix: `git -C exaix-dev-docs reset --soft HEAD~1`, then re-run the
   orchestrator so both land together.
5. **Different failure mode — the submodule commit SUCCEEDS but the parent's
   `check_commit_msg.ts` rejects the message** (Structural Bloom, Component Traceability —
   see `#commit`): do NOT roll back the submodule. Confirm `git -C exaix-dev-docs
   log --oneline -1`, fix the message, and commit the parent directly — `git add
   exaix-dev-docs <staged parent files> && git commit -F <fixed-msg>` — skipping
   `commit_plan_step.ts` (it would re-commit nothing staged).

The submodule-first rule governs all NON-plan-step changes.

Local workflow (`exaix-team` variant: substitute the name, use `feat:`/`fix:` type)

```bash
git submodule update --init --recursive

# Make and commit docs changes in the submodule
cd exaix-dev-docs
git checkout -b feat/<feature>-docs
git add .
git commit -m "docs: update submodule docs for <feature>"
git push -u origin HEAD

# Return to the parent and update the pointer
cd ..
git checkout -b feat/<feature>
git add exaix-dev-docs
git status --submodule=summary
git commit -m "chore(exaix): update exaix-dev-docs pointer to <sha> for <feature>"
git push -u origin HEAD
```

⚠️ Post-merge push order (commonly forgotten)

CI checks out the parent commit, then `git submodule update` fetches the recorded SHA. If
that SHA is not yet on the submodule's remote `main`, the build breaks and anyone cloning
with `--recurse-submodules` gets a dangling pointer. **Push submodule main FIRST, then parent.**

```bash
# 1. Merge the submodule feature branch into submodule main (ff-only)
cd exaix-dev-docs
git checkout main
git merge --ff-only feat/<feature>   # branch protection rejects merge commits; --no-ff needs an admin bypass

# 2. Push submodule main first — the commit must be reachable
git push origin main

# 3. Return to the parent and stage the pointer — guard against the checkout trap below
cd ..
git add exaix-dev-docs
git ls-tree HEAD exaix-dev-docs       # committed pointer SHA
git -C exaix-dev-docs rev-parse HEAD  # must match

# 4. Push parent main second — CI can now resolve the pointer
git push origin main
```

**Checkout-resets-submodule trap.** Any `git checkout <branch>` in the PARENT silently
resets the submodule's working tree and HEAD to the commit the parent index recorded —
even mid-sequence, to an older commit. Staging afterward then points the pointer WRONG,
silently. Guard: immediately before `git add exaix-dev-docs`, run
`git -C exaix-dev-docs rev-parse HEAD` and compare to the commit you merged; mismatch →
`git -C exaix-dev-docs checkout main` to restore, then stage.

Verification

```bash
git status --submodule=summary     # pointer state
git diff --submodule=log           # submodule commit log diff
git ls-tree HEAD exaix-dev-docs    # committed submodule SHA
```

PR guidance

- Document the submodule SHA in the parent PR description.
- Submodule change already merged? Cite the merged PR/commit.
- Shipping both? Include both branch names and the pointer SHA.

Validation

- Parent CI: `scripts/build_agents_index.ts`, `scripts/validate_agents_docs.ts`.
- Missing submodule content in CI: fail fast, not an incomplete pointer update.

Do / Don't

- ✅ Commit submodule changes first — EXCEPT plan-step commits, staged both and committed via `scripts/commit_plan_step.ts --commit`.
- ✅ Verify pointer state with `git status --submodule=summary`.
- ✅ Document the submodule SHA in the parent PR description.
- ✅ Push submodule main BEFORE parent main (CI must resolve the pointer).
- ❌ Update the parent pointer before the submodule change is committed and pushed.
- ❌ Skip submodule initialization (`git submodule update --init --recursive`).
- ❌ Use the same branch name in both repos without confirming your workflow supports it.

## Output Format

1. **Action** — submodule change or pointer update.
1. **Submodule SHA** — before and after.
1. **Verification** — `git status --submodule=summary`, `git diff --submodule=log`.
1. **Push order confirmed** — submodule main pushed before parent main.
1. **Commit payload** — use `#commit`.

## Examples

- Update a planning doc in `exaix-dev-docs/` and bump the parent pointer (phase-76)
- Add an architecture document to `exaix-dev-docs/` before updating the pointer
- Fix a broken pointer: `git submodule update --init --recursive` then re-commit

---
exaix:
  skill_id: submodule-workflow
  triggers:
    keywords: [submodule, exaix-dev-docs, pointer, git-submodule, subrepo]
    task_types: [chore, docs]
    tags: [git, submodule]
  constraints:
    - "Never commit a submodule pointer update without corresponding parent repo changes"
    - "Always commit submodule changes before updating parent pointer"
    - "Use correct pointer policy — detached HEAD in submodule is normal"
    - "Verify submodule status with git submodule status before committing"
  output_requirements:
    - "Submodule updated to correct commit hash"
    - "Parent repo commit includes the new submodule pointer"
    - "No dangling submodule references"
  quality_criteria:
    - name: pointer_consistency
      description: Submodule pointer matches the parent repo's expected state
      weight: 40
    - name: commit_order
      description: Submodule changes committed before parent pointer update
      weight: 30
    - name: verification
      description: git submodule status confirms clean state after update
      weight: 30
---
