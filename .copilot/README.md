---
agent: general
scope: dev
title: .copilot/ — IDE & Dev Agent Instructions
short_summary: "Overview of the .copilot/ directory, schema, and maintenance guidelines."
version: "0.1"
---

## Purpose

This directory contains short, machine-discoverable instruction documents intended to be consumed by development-time agents (e.g., VS Code Copilot, Copilot Labs) and provider integrations (OpenAI, Claude, Google). The content is curated to be concise, provider-agnostic where possible, and easy to inject into prompts using tooling in `scripts/`.

## Layout

- `.copilot/manifest.json` — auto-generated manifest listing available agent docs (`scripts/build_agents_index.ts`)
- `.copilot/copilot/` — Copilot-focused docs and short summaries
- `.copilot/providers/` — provider-specific adaptation notes and prompt templates
- `.copilot/prompts/` — Comprehensive prompt templates for systematic coding workflows (see [prompts/README.md](prompts/README.md))
- `.copilot/chunks/` — (auto-generated) pre-chunked text files for quick retrieval
- `.copilot/issues/` — structured bug reports and technical issues (see [issues/README.md](issues/README.md))

## Quick Links for Agents

- **Task mapping:** [cross-reference.md](cross-reference.md)
- **Commit message guidance:** [prompts/commit-message.md](prompts/commit-message.md)
- **Commit message skill reference:** [../Blueprints/Skills/commit-message.skill.md](../Blueprints/Skills/commit-message.skill.md)

## Relationship with `docs/`

- **`docs/`**: Source of truth for **human** users (Architecture, User Guide).
- **`.copilot/`**: Source of truth for **agents** (Context, Prompts, Schemas).
  - Agents should read `.copilot/` for coding instructions.
  - Agents should always use prompt templates from `.copilot/prompts/` for systematic workflows.
  - Agents may read `docs/` for high-level context but must not modify it unless explicitly asked.

## Schema

Each `.md` file should include YAML frontmatter with at least the following keys:

- `agent` (string) — e.g., `copilot`, `openai`
- `scope` (string) — e.g., `dev`, `ci`, `docs`
- `title` (string)
- `short_summary` (string) — one paragraph, 1–3 lines — used for quick ingestion
- `version` (string)
- `topics` (array of strings) — optional tags

## Maintenance

- Use `scripts/validate_agents_docs.ts` to validate frontmatter and safety rules.
- Update the manifest with `scripts/build_agents_index.ts` if new docs are added.

## Code Quality Standards

**MANDATORY:** For any code changes, agents MUST run code quality checks before committing:

### Formatting (deno fmt)

Always run `deno fmt` on modified files to ensure consistent code formatting:

```bash
# Format specific files
deno fmt src/some-file.ts tests/some-test.ts

# Format entire project (recommended)
deno task fmt
```

### Linting (deno lint)

Always run `deno lint` to catch potential issues and ensure code quality:

```bash
# Lint specific files
deno lint src/some-file.ts tests/some-test.ts

# Lint entire project (recommended)
deno lint src/ tests/
```

### Markdown Linting

Always run markdown linting on modified markdown files to ensure consistent formatting and catch issues:

```bash
# Lint specific markdown files
deno run --allow-read scripts/markdown_lint.ts docs/some-file.md .copilot/some-file.md

# Lint all markdown files in project (recommended)
deno run --allow-read scripts/markdown_lint.ts
```

The markdown linter will automatically fix common issues. For manual fixes, common rules include:

- Use consistent heading levels and spacing
- Ensure proper link formatting
- Maintain consistent code block formatting
- Use proper table formatting
- Check for broken links and references

### Pre-commit Validation

The project includes automated pre-commit hooks that run:

- `deno fmt --check` - Validates formatting
- `deno lint` - Validates code quality
- Markdown linting - Validates markdown formatting
- Manifest freshness checks

**Failure to run these checks will result in commit rejection.**

### Workflow for Code Changes

1. Make code changes

1.
1.
1.
1.
1.

## Regenerating manifest & chunks

If you add or update files under `.copilot/`, regenerate the manifest and pre-chunk artifacts with:

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

To verify the manifest is fresh (useful for CI):

```bash
deno run --allow-read scripts/verify_manifest_fresh.ts
```


## How to Add a New Agent Doc

Follow this workflow to create a new agent documentation file:

### 1. Create File in Appropriate Subfolder

Choose the right location based on content:

- **`source/`** — Source code development guidance (patterns, architecture, conventions)
- **`tests/`** — Testing patterns and helpers (TDD, test utilities, security tests)
- **`docs/`** — Documentation maintenance (Implementation Plan, versioning, cross-references)
- **`providers/`** — Provider-specific adaptations (Claude, OpenAI, Google, Copilot)
- **`copilot/`** — Copilot-specific quick references

### 2. Add YAML Frontmatter with Required Fields

Every agent doc MUST start with YAML frontmatter:

```yaml
---
identity: claude  # or: copilot, openai, google, general
scope: dev     # or: ci, docs, test
title: "Your Title Here"
short_summary: "One-liner description (1-3 sentences max, <200 chars)"
version: "0.1"
topics: ["keyword1", "keyword2", "keyword3"]
---
```

**Field descriptions:**

- **`identity`**: Target identity type (`claude`, `copilot`, `openai`, `google`, `general`)
- **`scope`**: Context scope (`dev`, `ci`, `docs`, `test`)
- **`title`**: Human-readable title
- **`short_summary`**: Concise summary for quick injection (≤200 characters recommended)
- **`version`**: Semantic version (start with `"0.1"`)
- **`topics`**: Array of searchable keywords (helps with semantic retrieval)

### 3. Include Required Sections

Structure your document with these sections:

#### Key Points (Required)

Bullet list of 3-5 critical takeaways:

```markdown
Key points

- Use `initTestDbService()` for database tests
- Follow TDD workflow: tests first, implementation second
- Clean up resources in finally blocks

#### Canonical Prompt (Required)

Example system prompt showing ideal usage:

```markdown
Canonical prompt (short):
"You are a test-writing assistant for Exaix. List failing test names and assertions first, using `initTestDbService()` or `createCliTestContext()` where appropriate."
```

#### Examples (Required)

2-3 example prompts with expected responses:

```markdown
Examples

- Example prompt: "Write tests that verify PlanWriter handles missing files and empty JSON. Use `initTestDbService()` and ensure cleanup is called."
- Example prompt: "Propose 3 failing unit tests showing how ConfigLoader handles malformed TOML."

#### Do / Don't (Recommended)

Guidance on safe/unsafe patterns:

```markdown
Do / Don't

- ✅ Do follow TDD and verify Success Criteria
- ✅ Do add module-level documentation
- ❌ Don't proceed without Implementation Plan step

### 4. Regenerate Manifest

After creating or updating a doc:

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

This updates `.copilot/manifest.json` and regenerates `.copilot/chunks/*.txt` files.

### 5. Validate

Run validation to check schema compliance and safety:

```bash
deno run --allow-read scripts/validate_agents_docs.ts
```

This checks for:

- Required frontmatter fields
- Canonical prompt section
- Examples section
- Sensitive data patterns (fails if detected)
- YAML syntax

### 6. Test Retrieval

Verify your doc is discoverable:

```bash
deno run --allow-read scripts/inject_agent_context.ts --query "your test query" --agent claude
```

This should return JSON with your doc if the query matches.

### Template File

Copy an existing doc as a starting point:

- For provider-specific: `.copilot/providers/claude.md`
- For testing guidance: `.copilot/tests/testing.md`
- For source patterns: `.copilot/source/exaix.md`

### Common Mistakes to Avoid

- ❌ **Missing `short_summary`** or making it too long (>200 chars)
  - Keep it concise: 1-3 sentences maximum

- ❌ **Forgetting to add topics array**
  - Topics improve semantic search quality

- ❌ **Not including canonical prompt example**
  - Required by validation

- ❌ **Skipping manifest regeneration**
  - Your doc won't be discoverable without this step

- ❌ **Hardcoding sensitive data (credentials, auth tokens, etc.)**
  - Validation will fail if detected

- ❌ **Using inconsistent agent/scope values**
  - Stick to standard values: `claude`, `copilot`, `openai`, `google`, `general` for agent
  - And: `dev`, `ci`, `docs`, `test` for scope

### Example: Creating a New Security Testing Guide

````bash
cat > .copilot/tests/security-patterns.md << 'EOF'
---
agent: claude
scope: test
title: Security Testing Patterns
short_summary: "Common security testing patterns for Exaix: path traversal, injection, leakage."
version: "0.1"
topics: ["security", "testing", "paranoid-tests", "path-traversal"]
---

## Security Testing Patterns

Key points

- Label security tests with `[security]` in test names
- Test path traversal with `../` sequences
- Use PathResolver for all path validation
- Verify Portal permissions are enforced

Canonical prompt (short):
"You are a security testing assistant. Propose paranoid tests for attack vectors: path traversal, command injection, symlink escapes."

Examples

- Example prompt: "Write security tests for PathResolver that check ../ handling and symlink resolution."

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
deno run --allow-read scripts/validate_agents_docs.ts
deno run --allow-read scripts/inject_agent_context.ts --query "security path traversal" --agent claude
````

Canonical prompt (short):
"You are a dev-time agent. Before performing repository-specific changes, consult `.copilot/manifest.json` and include matching `short_summary` items for relevant docs in `.copilot/`."

Examples

- Example prompt: "Suggest 3 unit test cases for PlanWriter that use `initTestDbService()` and include expected assertions."

## Notes

These files are **not** runtime Blueprints/agents (see `Blueprints/Agents/`). They are development-focused guidance to be used by IDE agents and automation helpers.

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
deno run --allow-read scripts/validate_agents_docs.ts
deno run --allow-read scripts/inject_agent_context.ts --query "security path traversal" --agent claude
```

Canonical prompt (short):
"You are a dev-time agent. Before performing repository-specific changes, consult `.copilot/manifest.json` and include matching `short_summary` items for relevant docs in `.copilot/`."

Examples

- Example prompt: "Suggest 3 unit test cases for PlanWriter that use `initTestDbService()` and include expected assertions."

## Configuration & Coding Standards

The full set of style and configuration guidelines has been consolidated in
[CODE_STYLE.md](../../CODE_STYLE.md). That document covers magic values,
constants, enums, environment variables, strict typing, imports, DI patterns,
and more. Refer back to it whenever you need to check or update coding
rules.

## Architectural Awareness

Agents must use the following core services for reliability and security:

- **Resilience:** Wrap external API calls in `CircuitBreaker`. Use `GracefulShutdown` for cleanup.
- **Security:** Sanitize all inputs with `InputValidator`. Use `SafeError` for public error messages.
- **Monitoring:** Respect `CostTracker` limits. Register checks via `HealthCheckService`.
- **Async:** Use `DatabaseConnectionPool` for all DB operations.

## Regression Testing Requirements

**MANDATORY:** When fixing any bug or issue, agents MUST create regression tests to prevent the bug from recurring.

### Requirements

1. **Every bug fix requires a regression test** — Before or after implementing a fix, create a test that:
   - Reproduces the original bug condition
   - Verifies the fix resolves the issue
   - Guards against future regressions

1.

   ```typescript
   Deno.test("[regression] Plan list shows approved plans from Active directory", ...);
   Deno.test("[regression] EventLogger works with stub db", ...);
   ```

1.
   - `tests/<feature>_regression_test.ts` for feature-specific regressions
   - `tests/integration/<N>_<feature>_integration_test.ts` for integration-level regressions

1.
   - The original error message or behavior
   - The root cause
   - The fix applied

### Example Regression Test

```typescript
/**
 * Regression test for: "TypeError: this.db.logActivity is not a function"
 * Root cause: Fallback db object was empty {} without required methods
 * Fix: Added stub logActivity() and waitForFlush() to fallback db
 */
Deno.test("[regression] EventLogger works with stub db", async () => {
  const stubDb = { logActivity: () => {}, waitForFlush: async () => {} };
  const logger = new EventLogger({ db: stubDb as any });

  // Should NOT throw "logActivity is not a function"
  await logger.info("test.action", "target");
});
```

### Workflow

1. **Reproduce** — Write a test that fails with the original bug

1.
1.

## Issue Tracking

For detailed bug reports, feature requests, and technical investigations, create structured issue documents in `.copilot/issues/`.

### When to Create an Issue Document

Create an issue in `.copilot/issues/` when you:

- **Discover a bug** during development or testing
- **Encounter test failures** in CI/CD that need investigation
- **Identify technical debt** requiring refactoring
- **Need to document** complex problems with reproduction steps
- **Want to track** feature requests with detailed technical specifications

### Quick Start

```bash
# Create a new issue using the template in issues/README.md
cat > .copilot/issues/component-issue-description.md << 'EOF'
---
title: "Brief, descriptive title"
status: open
priority: high
created: 2026-01-21
labels: [bug, component-name]
---

# Title

## Problem
Clear description of what is broken or missing.

## Reproduction Steps
Step-by-step commands to reproduce the issue.

## Expected vs Observed Behavior
What should happen vs what actually happens.

See issues/README.md for complete template.
EOF
```

### Issue Guidelines

- **Naming**: Use kebab-case: `component-issue-type-description.md`
- **Status**: `open`, `in-progress`, `blocked`, `resolved`, `wontfix`
- **Priority**: `critical`, `high`, `medium`, `low`
- **Labels**: Tag by type, component, and impact

**See [issues/README.md](issues/README.md) for complete guidelines, templates, and best practices.**
