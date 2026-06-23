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
version: "1.0"
topics: ["git", "submodule", "docs", "workflow"]
qwen_skill: submodule-workflow
---

Key points

- exaix-dev-docs is a real Git submodule, not a normal nested folder
- The parent repository only stores a pointer to the submodule commit
- A broken workflow can leave the parent repo pointing at a detached or uncommitted submodule state
- ALWAYS commit submodule changes first, then update the parent pointer

Canonical prompt (short):
"Update exaix-dev-docs submodule for {goal}: commit submodule change first, push it,
then update the parent repo pointer and commit with the submodule SHA reference."

Core policy

1. Make the documentation or planning change inside exaix-dev-docs/
2. Commit and push that change in the submodule repository
3. In the parent repo, run git add exaix-dev-docs after the submodule commit exists
4. Commit the pointer update in the parent repo with a clear message referencing the submodule SHA
5. Keep matching or related branch names across repos (feat/<feature> + feat/<feature>-docs)

Recommended local workflow

```bash
# Ensure submodules are initialized
git submodule update --init --recursive

# Make and commit docs changes inside the submodule
cd exaix-dev-docs
git checkout -b feat/<feature>-docs
git add .
git commit -m "docs: update submodule docs for <feature>"
git push -u origin HEAD

# Return to parent repo and update the pointer
cd ..
git checkout -b feat/<feature>
git add exaix-dev-docs
git status --submodule=summary
git commit -m "chore(exaix): update exaix-dev-docs pointer to <sha> for <feature>"
git push -u origin HEAD
```

⚠️ Post-merge follow-up — push order matters (commonly forgotten)

After the parent feature branch is merged into main, CI will check out
the parent commit and try to resolve the submodule pointer. The
submodule commit MUST already exist on the submodule's remote `main`
before you push the parent. **Push submodule main FIRST, then parent.**

```bash
# 1. Merge submodule feature branch into submodule main
cd exaix-dev-docs
git checkout main
git merge --ff-only feat/<feature>   # or --no-ff if preferred

# 2. Push submodule main FIRST — so the commit is reachable
git push origin main

# 3. Return to parent and verify pointer matches submodule main
cd ..
git ls-tree HEAD exaix-dev-docs       # shows committed pointer SHA
git -C exaix-dev-docs rev-parse HEAD  # should match

# 4. Push parent main SECOND — CI can now resolve the pointer
git push origin main
```

**Why this order?** CI checks out the parent commit, then runs
`git submodule update`, which fetches the submodule at the recorded
SHA. If that SHA only exists on a submodule feature branch (or hasn't
been pushed yet), `git submodule update` fails and the build breaks.

Failing to do the full sequence leaves the parent `main` pointing at a
submodule commit that only exists on a feature branch — breaking the
build for anyone cloning with `--recurse-submodules`.

Verification commands

```bash
git status --submodule=summary     # confirm pointer state
git diff --submodule=log           # show submodule commit log diff
git ls-tree HEAD exaix-dev-docs    # show committed submodule SHA
```

PR and review guidance

- Document the submodule SHA in the parent PR description
- If the submodule change is already merged, cite the merged PR/commit
- If shipping parent + submodule together, include both branch names and pointer SHA

Validation

- Parent repo CI: scripts/build_agents_index.ts and scripts/validate_agents_docs.ts
- If submodule content is missing in CI, fail fast rather than accept an incomplete pointer update

Do / Don't

- ✅ Do always commit submodule changes first before updating the parent pointer
- ✅ Do use git status --submodule=summary to verify pointer state
- ✅ Do document the submodule SHA in the parent PR description
- ✅ Do push submodule main BEFORE pushing parent main (CI must resolve the pointer)
- ❌ Don't update the parent pointer before the submodule change is committed and pushed
- ❌ Don't skip submodule initialization (git submodule update --init --recursive)
- ❌ Don't use the same branch name in both repos without checking your workflow supports it

## Output Format

1. **Action** — submodule change or pointer update.
1. **Submodule SHA** — before and after the change.
1. **Verification** — `git status --submodule=summary`, `git diff --submodule=log`.
1. **Push order confirmed** — submodule main pushed before parent main.
1. **Commit payload** — use `#commit` for the structured commit message.

## Examples

- Update planning doc in `exaix-dev-docs/` and bump parent repo pointer for phase-76
- Add new architecture document to `exaix-dev-docs/` before updating parent pointer
- Fix a broken parent pointer: `git submodule update --init --recursive` then re-commit
