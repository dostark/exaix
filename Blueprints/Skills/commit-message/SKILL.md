---
name: commit-message
description: "Write clear, conventional commit messages for readable history"
---
# Conventional Commit Messages

Follow the Conventional Commits specification for consistent, parseable commit history.

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
