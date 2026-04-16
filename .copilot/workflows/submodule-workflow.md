---
agent: copilot
scope: dev
title: Submodule Workflow & Pointer Policy
short_summary: "Correct handling of simultaneous parent repo and exaix-dev-docs submodule changes."
version: "0.1"
topics: ["git", "submodule", "docs", "workflow"]
---

## Submodule Workflow & Pointer Policy

This policy defines the safe, repeatable way to manage changes that span the parent `exaix` repository and the sibling `exaix-dev-docs` submodule.

### Why this matters

- `exaix-dev-docs` is a real Git submodule, not a normal nested folder.
- The parent repository only stores a pointer to the submodule commit.
- A broken workflow can leave the parent repo pointing at a detached or uncommitted submodule state.

### Core policy

1. **Always commit submodule changes first.**
   - Make the documentation or planning change inside `exaix-dev-docs/`.
   - Commit and push that change in the submodule repository before updating the parent repo.

2. **Then update the parent repo pointer.**
   - In the parent repo, run `git add exaix-dev-docs` after the submodule commit exists.
   - Commit the pointer update in the parent repo with a clear message referencing the submodule SHA.

3. **Keep a clean branch relationship.**
   - Use matching or related branch names across repos when the same feature spans both.
   - Recommended naming: `feat/<feature>` in parent and `feat/<feature>-docs` in submodule, or the same exact feature branch if your workflow supports it.

4. **Separate review boundaries when appropriate.**
   - If the submodule change is purely documentation or planning, it may be reviewed independently.
   - If the parent repo change depends on the submodule content, merge the submodule change first and then update the parent repo pointer in a follow-up PR.

5. **Always verify the submodule pointer.**
   - Use `git status --submodule=summary` or `git diff --submodule=log` in the parent repo.
   - Confirm the parent repo commit points at the intended submodule SHA.

### Recommended local workflow

```bash
# ensure submodules are initialized
git submodule update --init --recursive

# make and commit docs changes inside the submodule
cd exaix-dev-docs
git checkout -b feat/<feature>-docs
# edit files, then:
git add .
git commit -m "docs: update submodule docs for <feature>"
git push -u origin HEAD

# return to parent repo and update the pointer
cd ..
git checkout -b feat/<feature>
git add exaix-dev-docs
git status --submodule=summary
git commit -m "chore(exaix): update exaix-dev-docs pointer to <sha> for <feature>"
git push -u origin HEAD
```

### PR and review guidance

- Document the submodule SHA in the parent PR description.
- If the submodule change is already merged, cite the merged PR/commit.
- If the parent repo and submodule changes are shipped together, include both branch names and the pointer SHA.

### Agent guidance

- Agents and prompts should consult this workflow when asked to change docs or planning material in `exaix-dev-docs`.
- Do not ask the parent repo to update the submodule pointer until the submodule change is committed and available.
- Prefer the precise file path `exaix-dev-docs/MAINTENANCE.md` for maintenance rules.

### Validation

- Parent repo CI should include `scripts/build_agents_index.ts` and `scripts/validate_agents_docs.ts` when the submodule is present.
- If the submodule content is missing in CI, the parent repo should fail fast rather than accept an incomplete pointer update.
