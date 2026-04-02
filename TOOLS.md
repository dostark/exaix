---
title: TOOLS.md
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

---
agent: all
scope: dev
title: Developer Tools Quick Reference
short_summary: "Essential tools for Exaix development — what each tool does and when to use it."
version: "1.0"
topics: ["tools", "productivity", "quick-reference"]
---

# Exaix Developer Tools — Quick Reference

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

## � Related

- **Installation & Detailed Guide**: [docs/dev/Exaix_Tools.md](./docs/dev/Exaix_Tools.md)
- **Developer Setup**: [docs/dev/Exaix_Developer_Setup.md](./docs/dev/Exaix_Developer_Setup.md)
- **README**: [README.md](./README.md)

---

**Last Updated**: March 2026 | **Exaix Version**: 1.0.2

---

**Footer — Agent Knowledge Base**

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
