---
model_size: M
thinking: true
agent_role: senior-coder
---

In the `live-portal` portal, raise the constant `PLANNING_MARKER_LIMIT` in `src/limits.ts` by one
and keep `src/main.ts` consistent with the new value. Change only these two files.

Call exactly one tool per response and wait for its result before the next call.

Acceptance criteria:

- `PLANNING_MARKER_LIMIT` in `src/limits.ts` is one higher than before.
- `src/main.ts` still uses the constant and stays consistent with it.
