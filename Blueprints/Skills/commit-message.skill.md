---
id: "550e8400-e29b-41d4-a716-446655440006"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "commit-message"
name: "Conventional Commit Messages"
version: "1.0.0"
description: "Write clear, conventional commit messages for readable history"

triggers:
  keywords:
    - commit
    - message
    - git
    - changelog
    - version
    - release
  task_types:
    - commit
    - version
  tags:
    - git
    - commits
    - versioning

constraints:
  - "Follow conventional commit format"
  - "Keep subject line under 72 characters"
  - "Use imperative mood (Add, Fix, not Added, Fixed)"
  - "Reference issues when applicable"
  - "For non-trivial commits, use structured body sections: Context, Changes, Validation, References"
  - "Do not chain multiple -m flags; use one multiline commit message"
  - "NEVER use --no-verify; all pre-commit hooks must pass before committing"

output_requirements:
  - "Type prefix (feat, fix, docs, etc.)"
  - "Clear, concise subject line"
  - "Body for complex changes"
  - "Structured body with Context/Changes/Validation (and optional References)"

quality_criteria:
  - name: "Format Compliance"
    description: "Follows conventional commit format"
    weight: 40
  - name: "Clarity"
    description: "Message clearly describes the change"
    weight: 40
  - name: "Completeness"
    description: "Includes necessary context"
    weight: 20

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Conventional Commit Messages

Follow the Conventional Commits specification for consistent, parseable commit history:

## Format

```text
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

For medium/large commits, prefer this body shape:

````text
Context:
<why this change is needed>

Changes:

- <important change 1>
- <important change 2>

Validation:

- <checks run>

References:

- <issue/plan step/breaking change note>

When committing from CLI, avoid chained `-m` usage. Prefer one multiline message:

```bash
git commit -F - <<'COMMIT_MSG'
<type>(<scope>): <subject>

Context:
<why this change is needed>

Changes:

- <important change 1>
- <important change 2>

Validation:

- <checks run>

References:

- <issue/plan step/breaking change note>
````

## Types

| Type       | When to Use                             | Bumps |
| ---------- | --------------------------------------- | ----- |
| `feat`     | New feature                             | MINOR |
| `fix`      | Bug fix                                 | PATCH |
| `docs`     | Documentation only                      | -     |
| `style`    | Code style (formatting, semicolons)     | -     |
| `refactor` | Code change that neither fixes nor adds | -     |
| `perf`     | Performance improvement                 | PATCH |
| `test`     | Adding or correcting tests              | -     |
| `build`    | Build system or dependencies            | -     |
| `ci`       | CI configuration                        | -     |
| `chore`    | Other changes (e.g., .gitignore)        | -     |

## Examples

### Simple Fix

```text
fix(auth): prevent race condition in token refresh

Token refresh could fire multiple times if multiple requests
failed simultaneously. Added mutex to ensure single refresh.

Fixes #123
```

### New Feature

```text
feat(api): add user profile endpoints

- GET /api/users/:id/profile
- PUT /api/users/:id/profile
- Added profile image upload support

Closes #456
```

### Breaking Change

```text
feat(api)!: change authentication to JWT

BREAKING CHANGE: Session-based auth removed.
All clients must now use JWT tokens.

Migration guide: docs/migration-v2.md
```

### Documentation

```text
docs(readme): add installation instructions for Windows
```

### Refactor

```text
refactor(core): extract validation logic to separate module

No functional changes. Moved validation functions from
UserService to new ValidationService for reuse.
```

## Subject Line Rules

1. **Use imperative mood**: "Add feature" not "Added feature"
2. **Don't capitalize first letter** after type
3. **No period at the end**
4. **Max 72 characters** (50 is better)

```text
✅ feat(cart): add quantity validation
❌ feat(cart): Added quantity validation.
❌ feat(Cart): Add Quantity Validation
```

## Body Guidelines

- Wrap at 72 characters
- Explain **what** and **why**, not **how**
- Use bullet points for multiple changes
- Leave blank line between subject and body

## Footer Guidelines

```text
# Reference issues
Fixes #123
Closes #456
Refs #789

# Breaking changes (required for major version bumps)
BREAKING CHANGE: description of what breaks

# Co-authors
Co-authored-by: Name <email@example.com>
```

## Scope Suggestions

Use consistent scopes across your project:

- `(api)` - API changes
- `(ui)` - User interface
- `(auth)` - Authentication
- `(db)` - Database
- `(core)` - Core functionality
- `(deps)` - Dependencies
- `(config)` - Configuration

## Tools

- **commitlint**: Enforce commit conventions
- **husky**: Git hooks for validation
- **standard-version**: Automatic versioning and changelog
- **semantic-release**: Automated releases based on commits
