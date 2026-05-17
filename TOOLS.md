---
title: "Agent Instructions"
description: Developer tools and runtime capability map
agent_priority: high
copilot_knowledge_base: true
version: 1.1
capabilities: [tool_selection, setup_verification, capability_map]
links:
  - "docs/dev/Exaix_Tools.md"
  - "scripts/sync_tool_schemas.ts"
copilot_instructions: .copilot/blueprints/senior-coder.md
---

## Exaix Developer Tools — Quick Reference

> **📚 Full Guide**: See [docs/dev/Exaix_Tools.md](./docs/dev/Exaix_Tools.md) for installation instructions and detailed usage.

---

## 🔥 Essential Tools

| Tool          | Purpose      | When to Use                                                   |
| ------------- | ------------ | ------------------------------------------------------------- |
| **exactl**    | Exaix CLI    | All Exaix operations (requests, plans, daemon control)        |
| **lazygit**   | Git TUI      | Visual Git operations, branch management, conflict resolution |
| **delta**     | Git diffs    | Reviewing code changes with syntax highlighting               |
| **fd**        | File finder  | Finding files by name (faster than `find`)                    |
| **just**      | Task runner  | Running development tasks (alternative to `deno task`)        |
| **watchexec** | File watcher | Auto-run tests/lint on file changes                           |

---

## ✅ Verify Installation

```bash
deno --version      # Runtime
git --version       # Version control
sqlite3 --version   # Database
rg --version        # Code search (ripgrep)
fzf --version       # Fuzzy finder
bat --version       # Better cat
jq --version        # JSON processor
docker --version    # Containers
```

---

## 🎯 When to Use What

| Task           | Command                             |
| -------------- | ----------------------------------- |
| Find files     | `fd <pattern>`                      |
| Search code    | `rg <pattern>`                      |
| View file      | `bat <file>`                        |
| Git operations | `lazygit`                           |
| View diff      | `git diff \| delta`                 |
| Run tests      | `deno test --allow-all`             |
| Watch files    | `watchexec -e ts,md -- deno test`   |
| Run tasks      | `just <task>` or `deno task <task>` |
| JSON parsing   | `jq '<query>'`                      |
| Fuzzy search   | `fd \| fzf`                         |

---

## 🔗 Related

- **Installation & Detailed Guide**: [docs/dev/Exaix_Tools.md](./docs/dev/Exaix_Tools.md)
- **Developer Setup**: [docs/dev/Exaix_Developer_Setup.md](./docs/dev/Exaix_Developer_Setup.md)
- **README**: [README.md](./README.md)

---

**Last Updated**: May 2026 | **Exaix Version**: 1.0.2

<!-- AGENT_TOOLS_START -->

## 🤖 Agent Tool Index (MCP) {#agent-tools}

These tools are available to AI agents via the MCP protocol. They are validated, permission-checked,
and logged. The table is generated from the canonical tool manifest in `packages/mcp/src/manifest.ts`.
Run `deno task docs-sync-schemas` to regenerate after manifest changes.

> **Migration note**: The Source column is generated from explicit manifest ownership metadata.
> It is a current ownership hint, not a promise that the file path is permanent across package migration.
> Update manifest `source_ref` values when handlers move; root `tests/` retains integration and
> server-wiring coverage while package-owned tests migrate with their implementations.

| Tool                   | Description                                                                                                                                                                                                                                                            | Category | Dynamic | Approval   | Source                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ---------- | ------------------------------------------------------------------------------------------ |
| `create_directory`     | Create a directory (and any missing parent directories) inside a portal. Use before writing files into a directory that may not exist yet. Safe to call if the directory already exists. Returns a success confirmation message.                                       | `write`  | —       |            | [`src/mcp/handlers/create_directory_tool.ts`](src/mcp/handlers/create_directory_tool.ts)   |
| `delete_file`          | Permanently delete a file inside a portal. Use only when you are certain the file is no longer needed; the operation is irreversible unless the portal is under git version control. Returns a success confirmation message.                                           | `write`  | —       |            | [`src/mcp/handlers/delete_file_tool.ts`](src/mcp/handlers/delete_file_tool.ts)             |
| `exaix_approve_plan`   | Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Use when a human has reviewed a plan and wants to authorize or cancel agent execution. Mutating — requires human confirmation in Phase 79. Returns the updated plan record. | `domain` | —       | ⚠ Phase 79 | [`src/mcp/domain_tools.ts`](src/mcp/domain_tools.ts)                                       |
| `exaix_create_request` | Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation in Phase 79. Returns the created request record with its assigned ID.      | `domain` | —       | ⚠ Phase 79 | [`src/mcp/domain_tools.ts`](src/mcp/domain_tools.ts)                                       |
| `exaix_list_plans`     | List all execution plans (active, draft, or completed) tracked in the Exaix workspace. Read-only; safe for dynamic execution. Use to check plan status or find a plan ID before approving or querying. Returns an array of plan summary objects.                       | `domain` | ✓       |            | [`src/mcp/domain_tools.ts`](src/mcp/domain_tools.ts)                                       |
| `exaix_query_journal`  | Query the Exaix activity journal for execution history, tool calls, or agent events. Read-only; safe for dynamic execution. Use to audit what happened or look up recent activity in a flow. Returns an array of matching journal entry records.                       | `domain` | ✓       |            | [`src/mcp/domain_tools.ts`](src/mcp/domain_tools.ts)                                       |
| `git_commit`           | Stage all changes and create a git commit in the portal repository. Use after writing or modifying files to record the change. Returns the commit hash of the newly created commit.                                                                                    | `git`    | —       |            | [`src/mcp/handlers/git_commit_tool.ts`](src/mcp/handlers/git_commit_tool.ts)               |
| `git_create_branch`    | Create a new git branch in the portal repository. Use before making changes that should be isolated on a branch. Returns the new branch name on success.                                                                                                               | `git`    | —       |            | [`src/mcp/handlers/git_create_branch_tool.ts`](src/mcp/handlers/git_create_branch_tool.ts) |
| `git_status`           | Show the working tree status (modified, staged, untracked files) of the portal git repository. Use to inspect pending changes before committing. Returns the git status output as a formatted string.                                                                  | `git`    | ✓       |            | [`src/mcp/handlers/git_status_tool.ts`](src/mcp/handlers/git_status_tool.ts)               |
| `list_directory`       | List the files and subdirectories at a path inside a portal. Use to check whether a file exists, explore directory structure, or enumerate files before processing. Returns an array of entry names.                                                                   | `read`   | ✓       |            | [`src/mcp/handlers/list_directory_tool.ts`](src/mcp/handlers/list_directory_tool.ts)       |
| `move_file`            | Move or rename a file within a portal. The source path is removed after the move. Use for file reorganization or renaming; not for copying (use copy_file for that). Returns a success confirmation message.                                                           | `write`  | —       |            | [`src/mcp/handlers/move_file_tool.ts`](src/mcp/handlers/move_file_tool.ts)                 |
| `patch_file`           | Apply a targeted patch to replace a specific substring in a file without rewriting the whole file. Use when you need to make a minimal change. For full rewrites use write_file. Returns a success confirmation message.                                               | `write`  | —       |            | [`src/mcp/handlers/patch_file_tool.ts`](src/mcp/handlers/patch_file_tool.ts)               |
| `read_file`            | Return the full text content of a file inside a portal. Use when you need to read or analyze file contents. For searching within files use grep_search; for checking whether a file exists use list_directory. Returns the raw file text as a string.                  | `read`   | ✓       |            | [`src/mcp/handlers/read_file_tool.ts`](src/mcp/handlers/read_file_tool.ts)                 |
| `run_command`          | Execute a shell command inside the portal working directory. Use for build tasks, test runners, or any operation not covered by dedicated tools. Returns combined stdout/stderr output and exit code.                                                                  | `meta`   | —       |            | [`src/mcp/handlers/run_command_tool.ts`](src/mcp/handlers/run_command_tool.ts)             |
| `search_files`         | Search for files matching a name or glob pattern inside a portal. Use to locate files when you don't know the exact path. For content search within files use grep_search. Returns an array of matching relative file paths.                                           | `read`   | ✓       |            | [`src/mcp/handlers/search_files_tool.ts`](src/mcp/handlers/search_files_tool.ts)           |
| `write_file`           | Write or overwrite the full content of a file inside a portal. Use when you need to create a new file or completely replace an existing file. For partial edits use patch_file. Returns a success confirmation message.                                                | `write`  | —       |            | [`src/mcp/handlers/write_file_tool.ts`](src/mcp/handlers/write_file_tool.ts)               |

<!-- AGENT_TOOLS_END -->

---

## Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
