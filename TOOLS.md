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

These tools are available to AI agents via the MCP protocol. They are validated, permission-checked, and logged.

| Tool                | Description                                                               | Handler                                                                                    |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `create_directory`  | Create a directory (and all required parent directories) within a portal. | [`src/mcp/handlers/create_directory_tool.ts`](src/mcp/handlers/create_directory_tool.ts)   |
| `delete_file`       | Delete a single file from a portal.                                       | [`src/mcp/handlers/delete_file_tool.ts`](src/mcp/handlers/delete_file_tool.ts)             |
| `git_commit`        | Commit changes in a portal git repository                                 | [`src/mcp/handlers/git_commit_tool.ts`](src/mcp/handlers/git_commit_tool.ts)               |
| `git_create_branch` | Create a new git branch in a portal repository                            | [`src/mcp/handlers/git_create_branch_tool.ts`](src/mcp/handlers/git_create_branch_tool.ts) |
| `git_status`        | Query git repository status in a portal                                   | [`src/mcp/handlers/git_status_tool.ts`](src/mcp/handlers/git_status_tool.ts)               |
| `list_directory`    | List files and directories in a portal path                               | [`src/mcp/handlers/list_directory_tool.ts`](src/mcp/handlers/list_directory_tool.ts)       |
| `move_file`         | Move or rename a file within a portal.                                    | [`src/mcp/handlers/move_file_tool.ts`](src/mcp/handlers/move_file_tool.ts)                 |
| `patch_file`        | Apply a targeted string replacement to a file in a portal.                | [`src/mcp/handlers/patch_file_tool.ts`](src/mcp/handlers/patch_file_tool.ts)               |
| `read_file`         | Read a file from a portal (scoped to allowed portals)                     | [`src/mcp/handlers/read_file_tool.ts`](src/mcp/handlers/read_file_tool.ts)                 |
| `run_command`       | Execute a whitelisted shell command in the context of a portal            | [`src/mcp/handlers/run_command_tool.ts`](src/mcp/handlers/run_command_tool.ts)             |
| `search_files`      | Search for files matching a glob pattern (e.g., '**/*.ts')                | [`src/mcp/handlers/search_files_tool.ts`](src/mcp/handlers/search_files_tool.ts)           |
| `write_file`        | Write a file to a portal (validated and logged)                           | [`src/mcp/handlers/write_file_tool.ts`](src/mcp/handlers/write_file_tool.ts)               |

<!-- AGENT_TOOLS_END -->

---

## Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
