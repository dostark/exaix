# Identity Blueprints

This directory contains identity blueprint templates that define LLM personas, models, and capabilities for Exaix.

## Directory Structure

- `examples/`: **Reference Implementations**. Comprehensive, ready-to-use identity blueprints (e.g., `code-reviewer`, `security-auditor`). Use these to learn best practices or as a base for custom identities.
- `templates/`: **Abstract Patterns**. Reusable templates (e.g., `pipeline-agent`, `collaborative-agent`) with placeholders. Use these when you need a specific behavioral pattern but want to define the persona from scratch.
- `*.md`: **Active Identities**. Identity blueprints available for immediate use in your workspace (e.g., `default.md`, `senior-coder.md`).

## Skills Integration (Phase 17)

All identities support `default_skills` for automatic procedural knowledge injection:

`````yaml
---
identity_id: "my-identity"
name: "My Identity"
model: "google:gemini-2.0-flash-exp"
capabilities: ["read_file", "write_file"]
default_skills: ["code-review", "error-handling", "portal-grounding"]  # NEW
---
```text

**Available Core Skills:** `code-review`, `security-first`, `tdd-methodology`, `error-handling`, `documentation-driven`, `typescript-patterns`, `commit-message`, `exaix-conventions`

See `Blueprints/Skills/` for skill definitions.

## Usage Guide

### Using Active Identities

Active identities are ready to use:

```bash
exactl request "Task description" --identity senior-coder
```text

### Using Examples

Examples in `examples/` are for learning. To use one:

1. Copy it to this directory: `cp examples/code-reviewer.md .`

1.

### Using Templates

Templates in `templates/` are for creating new identities:

1. Copy a template: `cp templates/pipeline-agent.md.template my-identity.md`

1.
1.

Each identity blueprint file contains:

1. **YAML Frontmatter** (between `---` delimiters)
   - agent_id, name, model, capabilities, default_skills, etc.

1.
   - Identity persona and capabilities
   - **JSON Plan Schema** with examples
   - Response format instructions

## Available Identities

### Core Identities

| Identity        | Model                          | Skills                                                 | Use Case                  |
| --------------- | ------------------------------ | ------------------------------------------------------ | ------------------------- |
| `default`       | `ollama:codellama:13b`         | `error-handling`                                       | General-purpose coding    |
| `senior-coder`  | `ollama:codellama:7b-instruct` | `typescript-patterns`, `error-handling`, `code-review` | Complex implementations   |
| `quality-judge` | `anthropic:claude-3-5-sonnet`  | `code-review`                                          | LLM-as-a-Judge evaluation |

### Specialist Identities

| Identity             | Skills                                        | Use Case                        |
| ---------------------- | --------------------------------------------- | ------------------------------- |
| `security-expert`      | `security-first`, `code-review`               | Security vulnerability analysis |
| `performance-engineer` | `code-review`                                 | Performance optimization        |
| `technical-writer`     | `documentation-driven`                        | Documentation generation        |
| `software-architect`   | `exaix-conventions`, `typescript-patterns` | Architecture design             |
| `test-engineer`        | `tdd-methodology`, `error-handling`           | Test implementation             |
| `product-manager`      | -                                             | Requirements analysis           |
| `code-analyst`         | `code-review`, `typescript-patterns`          | Code structure analysis         |
| `qa-engineer`          | `tdd-methodology`, `error-handling`           | Integration testing             |

## JSON Plan Schema Reference

See `docs/Plan_Format_Reference.md` for the complete schema reference.

```json
{
  "title": "Plan title (required)",
  "description": "What this accomplishes (required)",
  "steps": [
    {
      "step": 1,
      "title": "Step title (required)",
      "description": "What this step does (required)",
      "tools": ["write_file"],
      "successCriteria": ["Criterion 1"],
      "dependencies": [],
      "rollback": "How to undo"
    }
  ],
  "estimatedDuration": "2-3 hours",
  "risks": ["Risk 1"]
}
```text

## Available Tools

The following tools are available for identities to use in their plans:

| Tool               | Description                        | Why/When to Use                                                                                    |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `read_file`        | Read the contents of a file        | Use to examine the full content of a specific file.                                                |
| `write_file`       | Create or overwrite a file         | Use for creating new files or rewriting small files. **Avoid** for large files (use `patch_file`). |
| `run_command`      | Execute a shell command            | Use for system commands not covered by specialized tools (e.g., `npm install`).                    |
| `list_directory`   | List files and directories         | Use to explore file structure and discover file names in a folder.                                 |
| `search_files`     | Search for files by name           | Use when you know the filename (or wildcard) but not its location.                                 |
| `create_directory` | Create a new directory             | Use before creating files in non-existent nested paths.                                            |
| `fetch_url`        | Fetch content from an external URL | Use to read external documentation or schemas (if domain is whitelisted).                          |
| `grep_search`      | Search file contents using regex   | Use to find code definitions, references, or text patterns across the codebase.                    |
| `git_info`         | Get repository status/diffs        | Use to see what changed, check current branch, or find untracked files.                            |
| `move_file`        | Move or rename a file              | Use for refactoring to ensure atomic moves and path validation.                                    |
| `copy_file`        | Copy a file                        | Use to duplicate files, such as creating a backup before editing.                                  |
| `delete_file`      | Delete a file                      | Use to permanently remove unused or temporary files.                                               |
| `deno_task`        | Run standard Deno tasks            | Use `test`, `lint`, or `fmt` to verify code quality and adherence to standards.                    |
| `patch_file`       | Apply precision text edits         | Use for making targeted changes to **large** files to save tokens and reduce risk.                 |

## Creating New Identities

Use `exactl blueprint identity create` or manually create following this template:

````markdown
+++
agent_id = "my-identity"
name = "My Custom Identity"
model = "provider:model-name"
capabilities = ["capability1", "capability2"]
created = "2025-12-09T00:00:00Z"
created_by = "your-email@example.com"
version = "1.0.0"
+++

# Identity Name

Identity description and persona...

## Skills (new)

To reduce code duplication across identities, use `default_skills` to reference shared skills. Skills are versioned, typed, and criticality-aware — the modern replacement for fragment includes.

### Example Usage:

```yaml
default_skills: ["response-contract", "code-review", "portal-grounding"]
```

### Key Skills:

- `response-contract`: Mandatory `<thought>`/`<content>` output contract with JSON schema.
- `code-review`: Comprehensive code review checklist.
- `security-first`: Secure coding and vulnerability assessment.
- `tdd-methodology`: Red-Green-Refactor cycle and test design.
- `portal-grounding`: Grounding responses in portal context.

Skills are loaded at runtime by the skill service. Every identity should include `response-contract` in its `default_skills`.
## Validation

The system will:

1. Extract JSON from `<content>` tags

1.
1.

## Testing

Test your identity with:

```bash
exactl request "Your test request" --identity my-identity
```text

Check the generated plan in `Workspace/Plans/` - it should contain properly formatted markdown converted from JSON.
`````
