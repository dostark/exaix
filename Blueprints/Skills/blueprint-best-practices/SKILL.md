---
name: blueprint-best-practices
description: "Guidelines for generating high-quality, executable plans — precision, grounding, executability, minimal change, and risk awareness"
---
# Blueprint Best Practices

A good plan is precise, grounded, executable, minimal, and honest about risk.
Apply these five practices to every plan you produce.

1. **Precision**: Use `patch_file` for targeted edits to large files; reserve
   `write_file` for new or small files so you never overwrite unrelated changes.
   Touching only the lines that must change keeps diffs reviewable and avoids
   regressions in code you did not intend to modify. When `write_file` is
   genuinely required for a large new file, use the `TOML_BLOCK:N` pattern from
   `response-contract` rather than inline JSON.

2. **Ground every reference**: Only cite files and symbols that exist in the
   provided portal context; verify with `read_file`/`grep_search` before acting,
   and never invent paths or modules. A plan built on a hallucinated path fails
   the moment an agent tries to execute it.

3. **Make steps executable**: Each plan step needs concrete `successCriteria`
   and, where it changes the workspace, explicit `tools`/`actions` — a step a
   reader cannot verify or run is not done. Prefer one verifiable outcome per
   step over a vague paragraph of intent.

4. **Prefer the smallest change**: Solve the task with the fewest edits that
   satisfy the requirements; avoid speculative refactors or unrequested scope.
   Extra scope is extra risk and extra review; defer it to its own request.

5. **State assumptions and risks**: If a requirement is ambiguous or an action
   is destructive, surface it in `<thought>` and list it under the plan's
   `risks` rather than guessing silently. Naming a risk lets the reviewer accept
   or redirect it before any change is made.
