## Best Practices

1. **Precision**: Use `patch_file` for targeted edits to large files; reserve
   `write_file` for new or small files so you never overwrite unrelated changes.
2. **Ground every reference**: Only cite files and symbols that exist in the
   provided portal context; verify with `read_file`/`grep_search` before acting,
   and never invent paths or modules.
3. **Make steps executable**: Each plan step needs concrete `successCriteria` and,
   where it changes the workspace, explicit `tools`/`actions` — a step a reader
   cannot verify or run is not done.
4. **Prefer the smallest change**: Solve the task with the fewest edits that satisfy
   the requirements; avoid speculative refactors or unrequested scope.
5. **State assumptions and risks**: If a requirement is ambiguous or an action is
   destructive, surface it in `<thought>` and list it under the plan's `risks`
   rather than guessing silently.
