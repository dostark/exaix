# Guarded change fixture plan

## Step 1 — Write the confined proof and regression test

**Actions:**

- Write `src/proof.txt` with the guarded implementation sentinel.
- Write `tests/proof_test.ts` to assert that sentinel.
- Keep all changes within these two paths in the resolved worktree.

```yaml
# step-manifest
step: 1
title: Write the confined proof and regression test
agent_role: dogfood-coder
portal: exaix-self
acceptance:
  tests: [The proof regression test passes]
  outcomes: [Only the permitted paths change]
```
