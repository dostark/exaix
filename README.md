---
title: "Agent Instructions"
description: Exaix Orchestration Platform - Overview and Quickstart
agent_priority: critical
copilot_knowledge_base: true
version: 2.1
capabilities: [system_overview, installation, initial_setup]
links:
  - "ARCHITECTURE.md"
  - "docs/dev/Exaix_Developer_Setup.md"
copilot_instructions: .copilot/blueprints/senior-coder.md
---

## Exaix — Auditable Agent Orchestration Platform

[![Deno](https://img.shields.io/badge/runtime-Deno-green.svg)](https://deno.land/)
[![SQLite](https://img.shields.io/badge/storage-SQLite-blue.svg)](https://www.sqlite.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/dostark/exaix/ci.yml)](https://github.com/dostark/exaix/actions)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](./LICENSE)

Exaix enables secure, auditable multi-agent workflows with human-in-the-loop supervision — unlike LangChain or CrewAI, it guarantees full reproducibility via persistent SQLite journals and filesystem-based APIs.

## Why Exaix

- **Permanent audit trail**: Every agent action (plan, tool call, file change) is journaled immutably.
- **Human oversight**: Agents propose structured Plans requiring explicit approval before execution.
- **Files-as-API**: Workspaces use disk files (Requests, Plans, Changesets) for easy CI/integration.
- **Local-first security**: Deno permissions + optional cloud LLMs keep data on your machine by default.

## Key Concepts

| Term               | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| **Request**        | User task input triggering agent workflows.                      |
| **Plan**           | Agent's proposed steps/changes for human review.                 |
| **Changeset**      | Approved, atomic file modifications from Plans.                  |
| **Plan Amendment** | Mid-execution replanning with human approval when triggers fire. |
| **Safety Gate**    | Approval checkpoint for dynamic mission adjustments.             |
| **Blueprint**      | Reusable agent identity/persona definitions.                     |
| **Portal**         | Symlink to external project repos for context.                   |
| **Memory**         | Persistent vector store for agent recall/search.                 |
| **Skills**         | Procedural knowledge ("how-to") injected into agent prompts.     |

## Architecture Overview

```mermaid
graph TD
    A[User Request] --> B[Agent Planning]
    B --> C[Human Review/Approve]
    C -->|Reject| D[Revise Plan]
    C -->|Approve| E[Apply Changeset]
    E --> F[Journal Activity]
    F --> G[Memory Update]
    G --> B
```

## Prerequisites

- Deno 2.0+
- SQLite (built-in)
- Optional: API keys for cloud LLMs (Anthropic, OpenAI, Google)

## Quick Start

```bash
# 1. Clone & deploy workspace
git clone https://github.com/dostark/exaix.git
cd exaix
./scripts/deploy_workspace.sh ~/MyExaixWorkspace

# 2. Configure LLM (edit ~/MyExaixWorkspace/exa.config.toml)
# See LLM Configuration below

# 3. Start daemon + submit example request
cd ~/MyExaixWorkspace
deno task start &
exactl request "Refactor src/cli.ts to use new JournalService"

# 4. Review & approve in dashboard
exactl dashboard
```

**Full CLI install**: `deno install -A --unstable https://deno.land/x/exactl@latest`

## Repo Structure

```text
exaix/
├── Blueprints/     # Agent personas/templates
├── Memory/         # Persistent memory banks
├── docs/           # User guides & specs
├── src/            # Core runtime
├── scripts/        # Deploy, CI helpers
├── tests/          # Unit/integration
└── templates/      # Workspace skeletons
```

Deployed workspace adds `Workspace/`, `Portals/`, `.exa/` (runtime state).

## LLM Configuration

Exaix auto-selects providers by cost/performance. Edit `exa.config.toml`:

**Basic**:

```toml
[ai]
provider = "ollama"
model = "llama3.2"
```

**Advanced Multi-Provider**:

```toml
[models.default]
provider = "anthropic"
model = "claude-3.5-sonnet"

[models.fast]
provider = "openai"
model = "gpt-4o-mini"

[models.local]
provider = "ollama"
model = "llama3.2"

[provider_strategy]
prefer_free = true
max_daily_cost_usd = 5.00
```

Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. Override: `EXA_LLM_PROVIDER=ollama exactl request ...`

## Operator Features

- **TUI Dashboard**: `exactl dashboard` — monitor, review Plans, approve Changesets.
- **CLI Commands**: `exactl request`, `exactl list`, `exactl apply`, `exactl journal`.
- **Least-privilege**: Deno sandbox per agent task.

## Testing & Contributing

```bash
deno task test      # Unit tests
deno task ci        # Full CI: fmt, lint, test, coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_STYLE.md](CODE_STYLE.md). Regression tests mandatory (`[regression]` prefix).

## Documentation

- **Quick Tools**: [TOOLS.md](./TOOLS.md)
- **User Guide**: [docs/Exaix_User_Guide.md](./docs/Exaix_User_Guide.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Developer Setup**: [docs/dev/Exaix_Developer_Setup.md](./docs/dev/Exaix_Developer_Setup.md)

## License

Proprietary © Exaix Development Team. See [LICENSE](./LICENSE).

---

# Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Dev Docs**: [exaix-dev-docs/](./exaix-dev-docs/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
