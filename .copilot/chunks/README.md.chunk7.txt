1. **Identify Learnings**: What was the root cause? specific architectural nuance? "Gotcha"?
2. **Update Agent Docs**: If the learning is a general pattern, add it to `.copilot/source/patterns.md` or `.copilot/tests/testing.md`.
3. **Save to Memory Bank**: Use the project's memory system to record the insight:
   - Run `exactl memory global promote` for cross-project patterns.
   - Run `exactl memory project update` for project-specific findings.
4. **Regenerate Index**: Update the agent documentation manifest:
   ```bash
   deno task check:docs
   ```

## Linking to GitHub Issues

If the issue also exists on GitHub:

```markdown
---
github_issue: #123
---

See also: https://github.com/org/repo/issues/123
````text

## Searching Issues