---
title: "Issues Folder Guidelines"
version: "1.0"
topics: ["issues", "bug-tracking", "documentation"]
---

## Issues Folder Guidelines

This folder contains structured issue reports for Exaix bugs, feature requests, and technical debt. Issues here complement GitHub Issues with detailed technical context and reproduction steps.

## When to Create an Issue Here

Create an issue document in `.copilot/issues/` when:

- **Bug Discovery**: You encounter a bug during development or testing
- **Test Failures**: CI/CD tests fail and need investigation
- **Technical Debt**: You identify code that needs refactoring or improvement
- **Feature Requests**: Detailed technical specifications for new features
- **Investigation Needed**: Complex problems requiring deep analysis

## Issue Document Format

Use the following template for all issues:

````markdown
---
title: "Brief, descriptive title"
status: open | in-progress | blocked | resolved | wontfix
priority: critical | high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD (optional)
labels: [bug, feature, refactor, performance, security, etc.]
assignee: username (optional)
related_issues: [issue-filename.md] (optional)
---

# Title

## Problem

Clear description of the issue. What is broken or missing?

## Reproduction Steps

```bash
# Step-by-step commands to reproduce
command1
command2
```text
````text

## Observed Behavior

What actually happens? Include:

- Error messages
- Log excerpts
- Screenshots (if applicable)
- Journal entries

## Expected Behavior

What should happen instead?

## Environment

- Exaix Version: x.x.x
- OS: Linux/macOS/Windows
- Deno Version: x.x.x
- Relevant Config: exa.config.toml settings

## Investigation Needed

1. **Area 1**: Questions to answer
   - Specific file or function to check
   - Hypothesis about root cause

1.
   - Related systems to verify

## Related Files

- `path/to/file1.ts` - Description
- `path/to/file2.ts` - Description

## Workaround

Temporary solution if available, or "None currently known"

## Priority Justification

Why this priority level? Impact on users/system.

## Resolution (when resolved)

- **Root Cause**: What was the actual problem
- **Fix**: What changes were made
- **Commit**: Link to commit or PR
- **Verified**: How the fix was tested

````text
## Naming Convention

Use descriptive, kebab-case filenames:

- `request-processing-failure-test-provider.md`
- `daemon-startup-timeout-ci.md`
- `portal-permissions-not-enforced.md`
- `memory-leak-file-watcher.md`

**Format**: `<component>-<issue-type>-<brief-description>.md`

## Status Workflow

1. **open** - Issue created, needs investigation
1.
1.
1.
1.

## Priority Levels

- **critical** - System broken, data loss, security vulnerability
- **high** - Core functionality broken, major user impact
- **medium** - Important but has workaround, affects some users
- **low** - Minor issue, cosmetic, nice-to-have

## Labels

Common labels to use:

- **Type**: `bug`, `feature`, `refactor`, `performance`, `security`, `docs`
- **Component**: `daemon`, `cli`, `tui`, `request-processor`, `database`, `ai`, `mcp`
- **Area**: `testing`, `ci-cd`, `deployment`, `configuration`
- **Impact**: `breaking-change`, `data-migration`, `api-change`

## Best Practices

### DO

✅ Include complete reproduction steps
✅ Attach relevant log excerpts
✅ Link to related files with line numbers
✅ Provide environment details
✅ Update status as work progresses
✅ Document resolution when fixed
✅ **Preserve Initial Information**: When updating an issue (e.g., adding investigation findings or resolution), **NEVER** delete the original problem description or reproduction steps. Always append or insert new sections without removing the initial context.
✅ Cross-reference related issues

### DON'T

❌ Create duplicate issues (search first)
❌ Use vague titles like "fix bug" or "broken"
❌ Skip reproduction steps
❌ Leave issues stale without updates
❌ Mix multiple unrelated problems in one issue

## Examples

### Good Issue Title
✅ `request-processing-fails-with-test-provider-selection.md`

### Bad Issue Title
❌ `bug.md`
❌ `fix-this.md`
❌ `todo.md`

### Good Description
✅ "When submitting a request via `exactl request`, the daemon incorrectly selects test-provider instead of the configured Google provider, causing plan validation to fail."

### Bad Description
❌ "Requests don't work"
❌ "Something is broken"

## Integration with Development Workflow

1. **Discovery**: Create issue document with reproduction steps
1.
1.
1.
1.
1.
1.

## Propagating Learnings to Memory Bank

When an issue is **resolved**, valuable learnings should be documented to improve future context retrieval and prevent recurrence.

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

```bash
# Find all open bugs
grep -l "status: open" .copilot/issues/*.md | xargs grep -l "labels:.*bug"

# Find high priority issues
grep -l "priority: high" .copilot/issues/*.md

# Find issues by component
grep -l "labels:.*daemon" .copilot/issues/*.md
```text

## Maintenance

- Review open issues weekly
- Close resolved issues or move to `resolved/` subfolder
- Update stale issues with current status
- Archive issues older than 6 months if resolved

---

**Remember**: Good issue documentation saves debugging time and helps future contributors understand the problem context.

````
