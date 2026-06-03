# Exaix User Guide

- **Version:** 0.1.0
- **Date:** 2026-01-25

## 1. Introduction

This guide explains how to deploy and use an Exaix workspace. Unlike the development repository (where the code
lives), a **User Workspace** is where your actual agents, knowledge, and portals reside.

### 1.1 When to Use Exaix

Exaix is **not** a replacement for IDE-integrated AI assistants (Copilot, Cursor, Windsurf). Those tools excel at real-time, interactive coding help.

**Use Exaix when you need:**

| Scenario                          | Why Exaix                                             |
| --------------------------------- | ----------------------------------------------------- |
| **Overnight batch processing**    | Drop request, go to lunch, come back to results       |
| **Audit/compliance requirements** | Full trace_id linking: request → plan → code → commit |
| **Multi-project refactoring**     | Portals give agents context across multiple codebases |
| **Air-gapped environments**       | 100% local with Ollama (no cloud required)            |
| **Team accountability**           | Know who approved what change and why                 |

**Use IDE agents when you need:**

| Scenario                    | Why IDE Agent            |
| --------------------------- | ------------------------ |
| Quick code fix while coding | Faster, more interactive |
| Real-time pair programming  | Conversational interface |
| Exploring unfamiliar code   | Inline explanations      |

### 1.2 Key Concepts

- **Request:** What you want the agent to do (markdown file or CLI command).
- **Request Analysis:** A pre-processing step that extracts structured goals, requirements, and constraints from your request. This helps ensure the agent's plan is grounded in your actual intent.
- **Actionability Score:** A 0–100 score indicating if your request is ready for execution. A low score (typically <60) means the request is underspecified or ambiguous.
- **Quality Gate:** An automatic quality check that runs before agent execution. It scores your request and either lets it proceed, auto-enriches it, asks clarifying questions, or rejects it outright if it is too vague to be actionable. See the "Request Quality Gate — How Scoring Works" section for full details.
- **Clarification Round:** One turn of the Q&A loop driven by the quality gate. The system asks 3–5 targeted questions; your answers are folded into a refined `IRequestSpecification` that guides the agent.
- **Request Specification (`IRequestSpecification`):** A structured contract produced by the clarification loop. Contains `summary`, `goals`, `successCriteria`, `scope`, `constraints`, and `context` fields. Used as ground truth for evaluation downstream.
- **Complexity:** The system classifies a request as `Simple`, `Medium`, `Complex`, or `Epic` to select the most cost-effective and powerful engine for the task.
- **Plan:** Agent's proposal for how to accomplish the request.
- **Approval:** Human review gate before agent executes.
- **Trace ID:** UUID linking everything together for audit.

### 1.2.1 How to Improve Your Actionability Score

The **Actionability Score** is a measure of how "grounded" and "specified" your request is. A higher score leads to more accurate plans and fewer agent errors.

#### Strategies for High-Score Requests

1. **Define Explicit Goals:** Instead of "Fix the bug," use "Fix the null pointer exception in `handler.ts` when the user ID is missing."
2. **Reference Specific Files:** Use absolute paths or workspace-relative paths (e.g., `src/services/db.ts`). This allows the analyzer to verify the context exists.
3. **Provide Acceptance Criteria:** Use phrases like "The task is complete when..." or "Must pass all unit tests in `tests/`."
4. **Specify Constraints:** Mention any library versions, style guides, or performance requirements (e.g., "Must use Deno.test and maintain < 100ms latency").
5. **Use Markdown Requests:** For complex tasks, create a `.md` file in `Workspace/Active/` with headers for "Goal," "Context," and "Constraints" instead of a one-line CLI string.

#### Resolving Ambiguity

If `exactl request show` reports an actionability score below 60, look for the **Ambiguities** section in the output. To resolve them:

- **Clarify the Scope:** If the agent is unsure which files to edit, provide the list.
- **Provide Samples:** If the task involves a new format, include a snippet of the desired output.
- **Run `exactl request analyze`:** Use this command to re-run the analysis after you've updated the request description to see if the score improves.

### 1.3 Quick Request Examples

Submit requests via the CLI to get started quickly:

```bash
# 1. Simple task
exactl request "Refactor src/utils.ts to use async/await"

# 2. High priority task with specific agent
exactl request "Audit security in src/api/" --agent security-auditor --priority high

# 3. Task targeting a specific portal
exactl request "Update README in the MyProject portal" --portal MyProject

# 4. Use a specific model configuration
exactl request "Generate unit tests for src/math.ts" --model fast

# 5. Analyze a request without executing it
exactl request analyze "Implement a new authentication flow" --mode hybrid
```

## 2. Installation & Deployment

### 2.1 Standard Deployment

From the repository root run the included script to create a user workspace (default: `~/Exaix`):

```bash
# From repo root
./scripts/deploy_workspace.sh /path/to/target-workspace

# Example (create a workspace in your home dir)
./scripts/deploy_workspace.sh ~/Exaix
```

**What the deploy script does:**

- Creates the standard runtime folders (`System`, `Memory`, `Workspace`, `Portals`).
- Copies runtime artifacts (`deno.json`, `import_map.json`, `scripts/`, `migrations/`, `packages/`, `apps/`) into the target workspace.
- Runs `deno task cache` and `deno task setup` to initialize the database.
- Installs `exactl` CLI globally to `~/.deno/bin/`.

### 2.2 Post-Deployment Setup

After deployment, ensure `~/.deno/bin` is in your PATH (one-time setup):

```bash
# Add to your shell profile
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Then optionally customize your configuration:

````bash
cd /path/to/target-workspace

# Review and customize config (optional)
cp exa.config.sample.toml exa.config.toml
nano exa.config.toml

# Start the daemon
deno task start
# or: exactl daemon start

```bash
deno task start
````

### 2.3 Ollama Setup (Local LLM)

For fully local, air-gapped operation without cloud API dependencies, install Ollama:

```bash
# Install Ollama (Linux/macOS/WSL)
curl -fsSL https://ollama.com/install.sh | sh

# Verify installation
ollama --version

# Start the Ollama service
ollama serve &
```

#### Choosing the Right Model

Select a model based on your hardware capabilities:

| Hardware Profile                       | Recommended Model       | Install Command                     | Performance               |
| -------------------------------------- | ----------------------- | ----------------------------------- | ------------------------- |
| **Minimal** (8GB RAM, CPU)             | `llama3.2:1b`           | `ollama pull llama3.2:1b`           | ⚡ Fast, basic reasoning  |
| **Standard** (16GB RAM, CPU)           | `llama3.2:3b`           | `ollama pull llama3.2:3b`           | ⚖️ Balanced speed/quality |
| **Developer** (16GB RAM, GPU)          | `codellama:7b-instruct` | `ollama pull codellama:7b-instruct` | 💻 Optimized for code     |
| **Power User** (32GB+ RAM, GPU 8GB+)   | `codellama:13b`         | `ollama pull codellama:13b`         | 🚀 Best code quality      |
| **Workstation** (64GB+ RAM, GPU 16GB+) | `codellama:34b`         | `ollama pull codellama:34b`         | 🏆 Premium quality        |

**Quick Start:**

```bash
# Pull the default model (recommended for most users)
ollama pull llama3.2

# For code-focused work, add codellama
ollama pull codellama:7b-instruct

# Test the model
ollama run llama3.2 "Explain what Exaix does in one sentence."
```

**Configure Exaix to use Ollama:**

```bash
# Option 1: Environment variable (temporary)
EXA_LLM_PROVIDER=ollama EXA_LLM_MODEL=llama3.2 exactl daemon start

# Option 2: Config file (permanent)
# Add to [models.local] or set as default
cat >> ~/Exaix/exa.config.toml << 'EOF'
[agents]
default_model = "local"

[models.local]
provider = "ollama"
model = "llama3.2"
EOF
```

**Troubleshooting:**

| Issue                  | Solution                                   |
| ---------------------- | ------------------------------------------ |
| "connection refused"   | Run `ollama serve` to start the service    |
| Slow inference         | Use smaller model or enable GPU support    |
| Out of memory          | Switch to smaller model (3b or 1b variant) |
| GPU not detected (WSL) | Install NVIDIA drivers on Windows host     |

### 2.4 Cloud LLM Setup (Anthropic, OpenAI, Google)

Exaix supports premium cloud models for higher reasoning capabilities. These require API keys and an internet connection.

#### 2.4.1 API Key Configuration

Set your API keys as environment variables in your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY="your-key-here"

# OpenAI (GPT)
export OPENAI_API_KEY="your-key-here"

# Google (Gemini)
export GOOGLE_API_KEY="your-key-here"
```

#### 2.4.2 Model Configuration

Configure your preferred models in `exa.config.toml`. You can define multiple named models and switch between them.

```toml
[agents]
default_model = "default"

[models.default]
provider = "anthropic"
model = "claude-opus-4.5"

[models.fast]
provider = "openai"
model = "gpt-5.2-pro-mini"

[models.local]
provider = "ollama"
model = "llama3.2"
```

#### 2.4.3 Provider Comparison

| Provider      | Best For                         | Recommended Model | Cost |
| ------------- | -------------------------------- | ----------------- | ---- |
| **Anthropic** | Complex reasoning, large context | `claude-opus-4.5` | $$$  |
| **OpenAI**    | General purpose, speed           | `gpt-5.2-pro`     | $$   |
| **Google**    | Long context, multimodal         | `gemini-3-pro`    | $$   |
| **Ollama**    | Privacy, zero cost, offline      | `llama3.2`        | Free |

#### 2.4.4 Enterprise Providers (Vertex AI, OpenRouter)

For users who hit free-tier quotas on a paid subscription, or who want one key for many models:

**Google Vertex AI** — uses a Google Cloud **service account** (project-based quotas/billing) instead of a simple API key.

1. Create a GCP project with the Vertex AI API enabled and billing on.
2. Create a service account with the **Vertex AI User** role and download its JSON key.
3. Provide the JSON (single line) via the configured env var, then point a model at the `vertex-ai` provider:

   ```bash
   export VERTEX_AI_SERVICE_ACCOUNT="$(cat ~/exaix-vertex-key.json)"
   ```

   ```toml
   [ai_vertex]
   service_account_env = "VERTEX_AI_SERVICE_ACCOUNT"
   region = "us-central1"   # or europe-west4, asia-southeast1

   [models.vertex]
   provider = "vertex-ai"
   model = "gemini-2.5-flash"
   ```

   > The service-account JSON is read from the environment only and is never logged. The
   > token endpoint is restricted to `*.googleapis.com`.

**OpenRouter** — a single API key to many models (`vendor/model` names).

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

```toml
[ai_openrouter]
api_key_env = "OPENROUTER_API_KEY"
site_name = "Exaix"
site_url = "https://exaix.dev"

[models.openrouter]
provider = "openrouter"
model = "anthropic/claude-3-opus"   # any model from openrouter.ai/models
```

### 2.4 Advanced Deployment Options

```bash
# fast deploy (runs deno tasks automatically)
./scripts/deploy_workspace.sh /home/alice/Exaix

# deploy but skip automatic execution of deno tasks (safer in constrained envs)
./scripts/deploy_workspace.sh --no-run /home/alice/Exaix

# alternative: only scaffold the target layout and copy templates
./scripts/scaffold.sh /home/alice/Exaix

# once scaffolded, initialize runtime manually
cd /home/alice/Exaix
deno task cache
deno task setup
deno task start
```

## 3. Workspace Overview

### 3.1 Directory Structure

- **Workspace/**: Drop requests here.
- **Memory/**: Memory Banks for execution history and project knowledge.
- **.exa/**: Database and logs (do not touch manually).
- **Portals/**: Symlinks to your projects.

### 3.2 Memory Banks

Memory Banks provide structured storage for Exaix's execution history, project context, and cross-project learnings. This system offers CLI-based access to your workspace's knowledge with automatic learning extraction.

#### Directory Structure

```text
Memory/
├── Global/             # Cross-project learnings
│   ├── learnings.json  # Global insights and patterns
│   └── learnings.md    # Human-readable learnings
├── Pending/            # Memory updates awaiting approval
│   └── {proposal-id}.json
├── Execution/          # Execution history (agent runs)
│   ├── {trace-id}/
│   │   ├── summary.md
│   │   ├── context.json
│   │   └── changes.diff
├── Projects/           # Project-specific knowledge
│   ├── {portal-name}/
│   │   ├── overview.md
│   │   ├── patterns.md
│   │   ├── decisions.md
│   │   └── references.md
└── Index/              # Search indices
    ├── tags.json
    └── embeddings/     # Semantic search vectors
```

#### CLI Access

Use the `exactl memory` commands to interact with Memory Banks:

```bash
# List all global learnings
exactl memory list

# List project memory banks
exactl memory project list

# Show project details
exactl memory project show MyProject

# Search across all memory (keyword)
exactl memory search "database migration"

# Search by tags
exactl memory search --tags "error-handling,async"

# List execution history
exactl memory execution list --limit 10

# View pending memory updates
exactl memory pending list

# Approve a pending update
exactl memory pending approve <proposal-id>

# Reject with reason
exactl memory pending reject <proposal-id> --reason "Duplicate"

> Note: If `memory.auto_approve.enabled` is enabled in configuration, the daemon can automatically promote eligible pending proposals, and it may emit a daily pending digest notification when proposals are waiting for review.

# Rebuild search indices
exactl memory rebuild-index
```

#### Features

- **Automatic Learning Extraction**: Insights are extracted from agent executions
- **Pending Workflow**: Review and approve/reject proposed learnings
- **Global + Project Scope**: Learnings can be global or project-specific
- **Tag-Based Search**: Filter by tags for precise results
- **Keyword Search**: Full-text search with frequency ranking
- **Embedding Search**: Semantic similarity search (deterministic mock vectors)
- **Structured Data**: JSON metadata alongside human-readable markdown
- **CLI Integration**: Direct access without external dependencies

#### Pending Workflow

When an agent execution completes, Exaix automatically extracts learnings:

1. **Extract**: Insights from `lessons_learned` and execution patterns

1. **Approve**: Approved learnings are moved to their respective Global or Project banks.

This ensures quality control over what enters the knowledge base.

### 3.3 Procedural Skills

Procedural Skills are specialized "how-to" guides that agents use to perform specific tasks correctly. Unlike declarative memory (facts), skills contain instructions, constraints, and examples for processes like "how to run tests in this project" or "how to deploy to production".

#### Key Concepts

- **Triggering**: Skills are automatically matched to your request based on keywords, task types, or file patterns.
- **Hydration**: When a skill matches, its full instructions are "hydrated" and injected into the agent's prompt.
- **Fail-Open Design**: Skill retrieval has a 500ms timeout. If it takes too long, the agent continues without the skill to avoid delays.

#### CLI Access

Use the top-level `exactl skills` command (or the alias `exactl memory skill`):

```bash
# List all available skills
exactl skills list

# Filter by category (core, project, learned)
exactl skills list --category core

# Show details and instructions for a skill
exactl skills show testing-standard

# Test skill matching for a specific request
exactl skills match "Implement the feature and run tests"
```

#### Configuration

You can tune skill matching in your `exa.config.toml`:

```toml
[skills]
max_per_request = 5        # Max skills to inject per request
match_threshold = 0.3      # Minimum confidence score (0.0 to 1.0)
context_budget_chars = 4000 # Max characters for skills context
```

## 4. CLI Reference

### 4.1 Installation

The Exaix CLI (`exactl`) provides a comprehensive interface for managing plans, reviews, git operations, the daemon, and portals.

**Automatic Installation (recommended):**

The deploy script automatically installs `exactl` globally. You just need to ensure `~/.deno/bin` is in your PATH:

```bash
# Add to your ~/.bashrc or ~/.zshrc (one-time setup)
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify installation
exactl --help
```

**Manual Installation:**

If you need to reinstall or the automatic installation failed:

```bash
# From your Exaix workspace
cd ~/Exaix

# Install globally with config (required for import map resolution)
deno install --global --allow-all --config deno.json -n exactl apps/exactl/main.ts

# For Deno 1.x (older versions)
# deno install --allow-all --config deno.json -n exactl apps/exactl/main.ts
```

**Alternative: Use via task runner (no global install):**

```bash
cd ~/Exaix
deno task cli <command>

# Examples:
deno task cli daemon status
deno task cli plan list
```

**Verify CLI is working:**

```bash
# Check exactl is accessible
exactl --help

# Check daemon status
exactl daemon status
```

### 4.1a Working with the TUI Dashboard

Exaix provides a powerful Terminal User Interface (TUI) dashboard for real-time monitoring, plan review, portal management, and daemon control—all from your terminal. The TUI dashboard is the recommended cockpit for day-to-day operations.

#### Launching the Dashboard

To start the dashboard, run:

```bash
exactl dashboard
```

You can also specify a workspace:

```bash
exactl dashboard --workspace /path/to/Exaix
```

For help and available options:

```bash
exactl dashboard --help
```

#### Dashboard Views

The dashboard includes 7 integrated views, each accessible via the view picker (`p`) or `Tab` navigation:

| Icon | View                | Description                              |
| ---- | ------------------- | ---------------------------------------- |
| 🌀   | **Portal Manager**  | Manage project portals and aliases       |
| 📋   | **Plan Reviewer**   | Review and approve agent-generated plans |
| 📊   | **Monitor**         | Real-time activity log streaming         |
| ⚙️   | **Daemon Control**  | Start, stop, and manage the daemon       |
| 🤖   | **Agent Status**    | Monitor agent health and activity        |
| 📥   | **Request Manager** | Track and manage requests                |
| 💾   | **Memory View**     | Browse and manage Memory Banks           |

#### Key Features

- **Multi-Pane Split View:** Run multiple views side-by-side
- **Real-time Log Streaming:** Filter and search Activity Journal logs
- **Plan Approval Workflow:** Review diffs and approve/reject plans
- **Portal Management:** Add, remove, refresh, and configure portals
- **Daemon Control:** Full lifecycle management from the TUI
- **Notification System:** Alerts for important events
- **Layout Persistence:** Save and restore your preferred layouts
- **Keyboard-First Navigation:** Vim-style keys supported
- **Accessibility:** High contrast mode and screen reader support

#### Global Navigation

| Key                 | Action                     |
| ------------------- | -------------------------- |
| `Tab` / `Shift+Tab` | Switch between panes/views |
| `1`-`7`             | Jump directly to pane      |
| `?` / `F1`          | Show help overlay          |
| `p`                 | Open view picker           |
| `n`                 | Toggle notification panel  |
| `R`                 | Refresh current view       |
| `q` / `Esc`         | Quit dashboard             |

#### Split View (Multi-Pane Mode)

The dashboard supports multiple panes for side-by-side view comparison:

| Key | Action                               |
| --- | ------------------------------------ |
| `v` | Split pane vertically (left/right)   |
| `h` | Split pane horizontally (top/bottom) |
| `c` | Close current pane                   |
| `z` | Maximize/restore pane (zoom)         |
| `s` | Save current layout                  |
| `r` | Restore saved layout                 |
| `d` | Reset to default layout              |

**Layout Persistence:** Press `s` to save your layout, `r` to restore it later. Layouts are saved to `~/.exaix/tui_layout.json`.

#### Using the Dashboard

- **Navigation:** Use `Tab` or arrow keys to switch between panes. Use `↑↓` or `jk` within lists.
- **Split View:** Press `v` for vertical split or `h` for horizontal. Each pane can display a different view.
- **Plan Approval:** In the Plan Reviewer, press `a` to approve or `r` to reject. Use `Enter` to view details.
- **Log Monitoring:** The Monitor streams logs in real time. Press `Space` to pause, `f` to filter.
- **Portal Management:** Add (`a`), delete (`d`), or refresh (`r`) portals from the Portal Manager.
- **Daemon Control:** Press `s` to start, `k` to stop, `r` to restart the daemon.

#### Example Workflow

```bash
# 1. Launch the dashboard
exactl dashboard

# 2. Split the view to see Plans and Monitor side-by-side
#    Press 'v' to split, then 'p' to pick a view

# 3. Navigate to Plan Reviewer (Tab or number key)
# 4. Review and approve a plan (Enter to view, 'a' to approve)
# 5. Watch execution logs in Monitor pane
# 6. Check agent status in Agent Status view
# 7. Save your layout for next time (press 's')
```

#### Accessibility Features

Exaix TUI includes accessibility support:

- **High Contrast Mode:** Enhanced colors for visibility. Set `tui.high_contrast = true` in config.
- **Screen Reader Support:** Status announcements. Set `tui.screen_reader = true`.
- **Keyboard-Only:** All features accessible without mouse.

#### Troubleshooting

- **Dashboard fails to launch:** Ensure your terminal supports ANSI escape codes and raw mode.
- **Keys not responding:** Check that your terminal is in focus and not in paste mode.
- **Layout not saving:** Verify write permissions to `~/.exaix/` directory.
- **Colors look wrong:** Try toggling high contrast mode or check `$TERM` environment variable.

For complete keyboard shortcuts, see [TUI Keyboard Reference](../apps/tui/README.md#keyboard-shortcuts).

For technical details, see the [Implementation Plan](./Exaix_Implementation_Plan.md#step-95-tui-cockpit-implementation-plan).

### 4.2 Command Groups

#### **Dashboard Command** - Terminal UI Cockpit

**Split View (Multi-Pane) Mode:**

- Press `s` or use the on-screen menu to split the dashboard into two or more panes.
- Each pane can show a different view (e.g., Monitor + Plans, Plans + Portals).
- Resize panes with `Ctrl+Arrow` keys. Switch focus with `Tab`.
- Preset layouts (vertical/horizontal) available in the settings panel (`?`).
- Example: Review a plan in one pane while watching logs in another.

The `exactl dashboard` command launches the interactive Terminal User Interface (TUI) cockpit for Exaix. This dashboard provides real-time monitoring, plan review, portal management, and daemon control—all from your terminal.

```bash
# Launch the TUI dashboard
exactl dashboard

# Optional: run in a specific workspace
exactl dashboard --workspace /path/to/Exaix

# See help and options
exactl dashboard --help
```

**Features:**

- Real-time log streaming and filtering
- Review and approve/reject plans with diff view
- Manage portals (add, remove, refresh, view status)
- Control daemon (start, stop, restart, view status)
- View agent health and activity
- Keyboard navigation, theming, and notifications

**Example workflow:**

```bash
# 1. Launch the dashboard
$ exactl dashboard

# 2. Navigate between Monitor, Plans, Portals, Daemon, and Agents views
#    (use Tab/Arrow keys, see on-screen help)

# 3. Approve a plan from the Plan Reviewer view
# 4. Watch logs in real time in the Monitor view
# 5. Add or refresh a portal in the Portal Manager
# 6. Start/stop the daemon from the Daemon Control view
```

**Troubleshooting:**

- If the dashboard fails to launch, ensure your terminal supports ANSI escape codes and your workspace is initialized.
- For accessibility or theming issues, see the dashboard settings panel (press `?` in the TUI).

See the [Implementation Plan](./Exaix_Implementation_Plan.md#step-95-tui-cockpit-implementation-plan) for technical details and roadmap.

Exaix CLI is organized into ten main command groups:

#### **Request Commands** - Primary Interface for Creating Requests

> **⚠️ RECOMMENDED:** Use `exactl request` to create requests. Do NOT manually create files in `/Workspace/Requests/` — this is error-prone and bypasses validation.

The `exactl request` command is the **primary interface** for submitting work to Exaix agents:

```bash
# Basic usage - just describe what you want
exactl request "Implement user authentication for the API"

# With options
exactl request "Add rate limiting" --agent senior_coder --priority high
exactl request "Fix security bug" --priority critical --portal MyProject
exactl request "Patch release branch" --portal MyProject --target-branch release_1.2
exactl request "Build a web app" --flow web-development

# From file (for complex/long requests)
exactl request --file ~/requirements.md
exactl request -f ./feature-spec.md --agent architect

# List pending requests
exactl request list
exactl request list --status pending

# Show request details
exactl request show <trace-id>
exactl request show a1b2c3d4

# Dry run (see what would be created)
exactl request "Test" --dry-run

# JSON output (for scripting)
exactl request "Test" --json

# Inject skills to override agent limitations
exactl request "Audit and write report" --agent security-expert --skills documentation-driven

# Trigger immediate intent analysis
exactl request "Implement a new authentication flow" --analyze --engine llm
exactl request "Update documentation" --analyze --engine heuristic

# Analyze an existing request
exactl request analyze a1b2c3d4
exactl request analyze "Existing Request Subject" --engine llm
```

**Options:**

| Option                  | Short | Description                                                                      |
| ----------------------- | ----- | -------------------------------------------------------------------------------- |
| `--agent`               | `-a`  | Target identity blueprint (default: `default`, mutually exclusive with --flow)   |
| `--flow`                |       | Target multi-agent flow (mutually exclusive with --agent)                        |
| `--priority`            | `-p`  | Priority: `low`, `normal`, `high`, `critical`                                    |
| `--portal`              |       | Portal alias for project context                                                 |
| `--target-branch`       |       | Target/base branch when working inside a portal (stored as `target_branch`)      |
| `--skills`              |       | Comma-separated list of skills to inject (e.g., `documentation-driven,file-ops`) |
| `--file`                | `-f`  | Read description from file                                                       |
| `--acceptance-criteria` |       | Repeatable acceptance criterion; stored in frontmatter as `acceptance_criteria`  |
| `--expected-outcome`    |       | Repeatable expected outcome; stored in frontmatter as `expected_outcomes`        |
| `--interactive`         | `-i`  | Interactive mode with prompts                                                    |
| `--dry-run`             |       | Preview without creating                                                         |
| `--json`                |       | Machine-readable output                                                          |
| `--analyze`             |       | Trigger immediate intent analysis (Phase 45)                                     |
| `--engine`              | `-e`  | Analysis engine: `heuristic` (default), `llm`                                    |

**Example workflow:**

```bash
# 1. Create a request with one command
$ exactl request "Add input validation to all API endpoints"
✓ Request created: request-a1b2c3d4.md
  Trace ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Priority: normal
  Agent: default
  Path: /home/user/Exaix/Workspace/Requests/request-a1b2c3d4.md
  Next: Daemon will process this automatically

# 2. Check if plan was generated
$ exactl plan list
📋 Plans (1):

🔍 add-validation-a1b2c3d4
   Status: review
   Trace: a1b2c3d4...

# 3. List your requests
$ exactl request list
📥 Requests (1):

🟢 a1b2c3d4
   Status: pending
   Agent: default
   Created: user@example.com @ 2025-11-27T10:30:00.000Z
```

**Structured criteria example:**

```bash
exactl request "Implement file upload validation" \
  --agent senior-coder \
  --acceptance-criteria "All existing tests pass" \
  --acceptance-criteria "Payloads over 1MB are rejected" \
  --expected-outcome "Upload endpoint documents size limits"
```

Explicit criteria improve request quality in three ways: they raise the analyzer's confidence about what success looks like, they feed directly into downstream evaluation, and they reduce clarification churn for borderline requests.

**Why CLI instead of manual files?**

| Aspect         | Manual File Creation     | `exactl request`           |
| -------------- | ------------------------ | -------------------------- |
| Frontmatter    | Must write YAML manually | Auto-generated             |
| Trace ID       | Must generate UUID       | Auto-generated             |
| Validation     | None until daemon reads  | Immediate                  |
| Audit trail    | Not logged               | Logged to Activity Journal |
| Error handling | Silent failures          | Clear error messages       |
| Speed          | ~30 seconds              | ~2 seconds                 |

#### **`exactl request clarify` — Interactive Clarification**

When a request enters the **REFINING** or **NEEDS_CLARIFICATION** status the quality gate has determined that the request needs more detail before it can be executed. Use `exactl request clarify` to answer the pending questions:

```bash
# Show pending questions for a request
exactl request clarify <trace-id>

# Answer all questions interactively (prompts for each one)
exactl request clarify <trace-id> --interactive

# Supply specific answers by question ID
exactl request clarify <trace-id> --answer r1q1="The users table" --answer r1q2="src/db/queries.ts"

# Force the request to proceed with the current specification
exactl request clarify <trace-id> --proceed

# Abandon clarification and revert to the original body
exactl request clarify <trace-id> --cancel
```

**Options:**

| Option          | Short | Description                                               |
| --------------- | ----- | --------------------------------------------------------- |
| `--interactive` | `-i`  | Prompt for each pending question sequentially             |
| `--answer`      |       | Supply an answer: `--answer <question-id>="<text"`        |
| `--proceed`     |       | Accept current specification and re-enter the pipeline    |
| `--cancel`      |       | Cancel refinement and revert to the original request body |

**Clarification workflow:**

```text
exactl request "fix something"          # vague → quality gate detects low score
→ status: REFINING                       # gate saves session + questions
→ exactl request clarify <id>            # see the questions
→ exactl request clarify <id> -i        # answer interactively
→ status: NEEDS_CLARIFICATION           # awaiting further rounds or proceed
→ exactl request clarify <id> --proceed # inject final spec and re-queue
→ PENDING → PLANNED                     # agent runs against the specification
```

**Understanding quality gate statuses in `exactl request list`:**

| Status                | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `REFINING`            | Active Q&A loop in progress — use `exactl request clarify <id>`      |
| `NEEDS_CLARIFICATION` | Awaiting your response to the most recent round of questions         |
| `ENRICHING`           | Quality gate is auto-rewriting an underspecified request (transient) |

#### **Request Quality Gate — How Scoring Works**

Every request passes through a three-tier quality assessment before the agent runs:

| Score range | Level       | Recommendation                            |
| ----------- | ----------- | ----------------------------------------- |
| 70 – 100    | Good/Excel. | **Proceed** — agent runs immediately      |
| 50 – 69     | Acceptable  | **Auto-enrich** — gate rewrites the body  |
| 20 – 49     | Poor        | **Needs clarification** — Q&A loop starts |
| 0 – 19      | Very poor   | **Reject** — request returned to sender   |

**Tips for high-quality requests:**

- Include at least one action verb ("implement", "fix", "refactor", "add").
- Reference specific files, modules, or acceptance criteria.
- Specify scope: what **in** and what **out** of scope.
- Use `exactl request analyze` to preview the score before submitting.

**Auto-enrichment:** When a request scores in the _Acceptable_ range and `auto_enrich = true` is configured (default), the gate rewrites the request body into a more structured form. The original body is preserved in `originalBody` and never lost.

#### **Plan Commands** - Review AI-generated plans

Review and approve plans before agents execute them:

> **⚠️ IMPLEMENTATION STATUS:** Plan approval moves plans to `Workspace/Active/` where they are detected and parsed (Steps 5.12.1-5.12.2 ✅). Automatic agent-driven execution (Steps 5.12.3-5.12.6) is in development. In the agent-driven model, LLM agents will have direct portal access through scoped tools (read_file, write_file, git_create_branch, git_commit) and will create reviews themselves. See [Exaix Architecture](./Exaix_Architecture.md#plan-execution-flow-step-512) for details.

```bash
# List all plans awaiting review
exactl plan list
exactl plan list --status review          # Filter by status

# Show plan details
exactl plan show <plan-id>

# Approve a plan (moves to Workspace/Active for detection and parsing)
exactl plan approve <plan-id>

# Approve with skills injection for execution
exactl plan approve <plan-id> --skills file-ops,testing-best-practices

# Reject a plan with reason
exactl plan reject <plan-id> --reason "Approach too risky"

# Request revisions with comments
exactl plan revise <plan-id> \
  --comment "Add error handling" \
  --comment "Include unit tests"
```

#### **Plan Amendment Commands** - Manage paused executions

The Plan Amendment Safety Gate allows agents to propose structural changes to an execution plan mid-mission. This is triggered when the agent detects environmental drift or tool failures.

```bash
# List all plans awaiting amendment approval
exactl plan amendment list

# Show proposed changes for a specific plan
exactl plan amendment show <plan-id>

# Approve amendment and resume execution
exactl plan amendment approve <plan-id>

# Reject amendment and abort execution
exactl plan amendment reject <plan-id> --reason "Incorrect approach"
```

**Workflow:**

1. **Trigger**: Agent detects drift and pauses execution. Status becomes `amendment_pending`.
2. **Review**: You review the proposal using `plan amendment show`.
3. **Decision**: You approve to apply changes and resume, or reject to abort.

For more details, see the **Safety Gates** section.

**Example workflow:**

```bash
# 1. Check what's pending
$ exactl plan list
📋 Plans (2):

🔍 implement-auth
   Status: review
   Trace: 550e8400...

⚠️ refactor-db
   Status: needs_revision
   Trace: 7a3c9b12...

# 2. Review a plan
$ exactl plan show implement-auth

# 3. Approve or request changes
$ exactl plan approve implement-auth
✓ Plan 'implement-auth' approved
  Moved to: Workspace/Active/implement-auth.md
  Status: Plan detected and parsed (agent-driven execution in development)

  Note: Currently, approved plans are detected and validated. Future: agents
  will have portal access to create reviews directly. Agent-driven execution
  (Step 5.12.3-5.12.6) is in development.
```

#### **Review Commands** - Review agent-generated outputs

After agents execute plans and create git branches or artifacts, review their outputs:

```bash
# List all pending reviews (agent-created branches and artifacts)
exactl review list
exactl review list --status pending

# Show review details with diff (for code) or content (for artifacts)
exactl review show <request-id>
exactl review show feat/implement-auth-550e8400

# Approve review (merges branch to main or marks artifact approved)
exactl review approve <request-id>

# Reject review (deletes branch or marks artifact rejected)
exactl review reject <request-id> --reason "Failed code review"
```

**Cleanup behavior (code reviews):**

- **Reject:** Deletes the feature branch (best-effort cleanup if the branch is checked out in a worktree).
- **Approve:** Merges into the review’s recorded base branch (often `main`).
  - If the review was executed in an **isolated worktree**, Exaix also removes the worktree checkout and its pointer at `Memory/Execution/{trace-id}/worktree`, and then deletes the feature branch.
  - If the review was executed on a normal branch checkout, Exaix merges but does not automatically delete the feature branch.
- **Merge conflict on approve (worktree reviews):** Exaix attempts `git merge --abort` and removes the worktree checkout + pointer to avoid leaving orphaned worktrees. The feature branch is kept so a human can resolve and re-merge.

**Example workflow:**

```bash
# 1. See what code changes are ready
$ exactl review list
📋 Reviews (1):

📌 implement-auth (feat/implement-auth-550e8400)
   Files: 12
   Created: 2025-11-25 14:30:22
   Trace: 550e8400...

# 2. Review the changes
$ exactl review show implement-auth
📋 Review: implement-auth

Branch: feat/implement-auth-550e8400
Files changed: 12
Commits: 3

Commits:
  a3f21b89 - Add JWT authentication
  c4d8e123 - Add login endpoint
  f9a23c45 - Add auth middleware

Diff:
[full diff output...]

# 3. Approve or reject
$ exactl review approve implement-auth
✓ Review approved
  Branch: feat/implement-auth-550e8400
  Merged to main: 3b5f7a21
  Files changed: 12
```

#### **Git Commands** - Repository operations with trace_id

Query git history and track changes by trace_id:

```bash
# List all branches with trace metadata
exactl git branches
exactl git branches --pattern "feat/*"     # Filter pattern

# Show repository status
exactl git status

# Search commits by trace_id
exactl git log --trace <trace-id>
```

**Example workflow:**

```bash
# Find all branches created by agents
$ exactl git branches --pattern "feat/*"
🌳 Branches (3):

  feat/implement-auth-550e8400
   Last commit: a3f21b89 (11/25/2025)
   Trace: 550e8400...

  feat/add-tests-7a3c9b12
   Last commit: b2c31a45 (11/24/2025)
   Trace: 7a3c9b12...

# Check workspace status
$ exactl git status
📊 Repository Status

Branch: main

Modified (2):
  M src/auth/handler.ts
  M src/shared/schemas/config.ts

# Find all commits for a specific request
$ exactl git log --trace 550e8400-e29b-41d4-a716-446655440000
📜 Commits for trace 550e8400...

a3f21b89 - Add JWT authentication
  Author: exaix-agent
  Date: 11/25/2025, 2:30:45 PM
```

#### **Portal Commands** - Manage external project access

Portals are symlinked directories that give agents controlled access to external projects:

```bash
# Add a new portal
exactl portal add <target-path> <alias> [--default-branch <branch>] [--execution-strategy <branch|worktree>]
exactl portal add ~/Dev/MyWebsite MyWebsite
exactl portal add ~/Dev/MyWebsite MyWebsite --default-branch main --execution-strategy worktree

# List all configured portals
exactl portal list

# Portal listing output:
# 🔗 Configured Portals (2):
#
# MyWebsite
#   Status: Active ✓
#   Target: /home/user/Dev/MyWebsite
#   Symlink: ~/Exaix/Portals/MyWebsite
#   Context: ~/Exaix/Memory/Projects/MyWebsite.md
#
# MyAPI
#   Status: Broken ⚠
#   Target: /home/user/Dev/MyAPI (not found)
#   Symlink: ~/Exaix/Portals/MyAPI

# Show detailed information about a portal
exactl portal show <alias>
exactl portal show MyWebsite

# Remove a portal (deletes symlink, archives context card)
exactl portal remove <alias>
exactl portal remove MyWebsite
exactl portal remove MyWebsite --keep-card  # Keep context card

# Verify portal integrity
exactl portal verify                        # Check all portals
exactl portal verify MyWebsite              # Check specific portal

# Refresh context card (re-scan project)
exactl portal refresh <alias>
exactl portal refresh MyWebsite
```

**Portal base branch and execution strategy:**

- `exactl request --portal <alias> --target-branch <branch>` stores `target_branch` in request/plan frontmatter and uses it as the review's merge target (`base_branch`) for portal code reviews.
- If `target_branch` is not provided, Exaix falls back to the portal's configured `default_branch` (if set), and otherwise auto-detects the repository's default branch.
- `--execution-strategy` controls how Exaix runs write-capable portal work:
  - `branch` (default): create a feature branch in the portal repo checkout.
  - `worktree`: create an isolated git worktree per execution (good for parallel requests) and record `worktree_path` on the review.

For worktree executions, Exaix also writes a discoverability pointer at `Memory/Execution/{trace-id}/worktree` (symlink when possible; `PATH.txt` fallback).

**Worktree maintenance:**

- `exactl git worktrees list [--portal <alias>] [--repo <path>]` shows all Git worktrees for a repository (useful to locate the active execution worktree).
- `exactl git worktrees prune [--portal <alias>] [--repo <path>]` prunes stale worktree metadata (useful after manual deletion or crashes).

**What happens when adding a portal:**

1. Creates symlink: `~/Exaix/Portals/<alias>` → `<target-path>`

1.
1.
1.
1.

**Portal verification checks:**

- Symlink exists and is valid
- Target directory exists and is readable
- Target path matches config
- Deno has necessary permissions
- Context card exists

**Safety features:**

- Portal removal moves context cards to `_archived/` instead of deleting
- Broken portals are detected and flagged (target moved/deleted)
- OS-specific handling:
  - **Windows:** Creates junction points if symlinks unavailable
  - **macOS:** Prompts for Full Disk Access on first portal
  - **Linux:** Checks inotify limits for filesystem watching

**Example workflows:**

```bash
# 1. Add a new portal
$ exactl portal add ~/Dev/MyWebsite MyWebsite
✓ Validated target: /home/user/Dev/MyWebsite
✓ Created symlink: ~/Exaix/Portals/MyWebsite
✓ Generated context card: ~/Exaix/Memory/Portals/MyWebsite.md
✓ Updated configuration: exa.config.toml
✓ Validated permissions
✓ Logged to Activity Journal
⚠️  Daemon restart required: exactl daemon restart

# 2. List all portals and check status
$ exactl portal list
🔗 Configured Portals (3):

MyWebsite
  Status: Active ✓
  Target: /home/user/Dev/MyWebsite
  Symlink: ~/Exaix/Portals/MyWebsite
  Context: ~/ExaixMemory/Portals/MyWebsite.md

MyAPI
  Status: Active ✓
  Target: /home/user/Dev/MyAPI
  Symlink: ~/Exaix/Portals/MyAPI
  Context: ~/ExaixMemory/Portals/MyAPI.md

OldProject
  Status: Broken ⚠
  Target: /home/user/Dev/OldProject (not found)
  Symlink: ~/Exaix/Portals/OldProject

# 3. View detailed portal information
$ exactl portal show MyWebsite
📁 Portal: MyWebsite

Target Path:    /home/user/Dev/MyWebsite
Symlink:        ~/Exaix/Portals/MyWebsite
Status:         Active ✓
Context Card:   ~/ExaixMemory/Portals/MyWebsite.md
Permissions:    Read/Write ✓
Created:        2025-11-26 10:30:15
Last Verified:  2025-11-26 14:22:33

# 4. Verify portal integrity
$ exactl portal verify
🔍 Verifying Portals...

MyWebsite: OK ✓
  ✓ Target accessible
  ✓ Symlink valid
  ✓ Permissions correct
  ✓ Context card exists

MyAPI: OK ✓
  ✓ Target accessible
  ✓ Symlink valid
  ✓ Permissions correct
  ✓ Context card exists

OldProject: FAILED ✗
  ✗ Target not found: /home/user/Dev/OldProject
  ✓ Symlink exists
  ✓ Context card exists
  ⚠️  Portal is broken - target directory missing

Summary: 1 broken, 2 healthy

# 5. Refresh context card after project changes
$ exactl portal refresh MyWebsite
🔄 Refreshing context card for 'MyWebsite'...
✓ Scanned target directory
✓ Detected changes: 3 new files
✓ Updated context card
✓ Preserved user notes
✓ Logged to Activity Journal

# 6. Remove a portal safely
$ exactl portal remove OldProject
⚠️  Remove portal 'OldProject'?
This will:
  - Delete symlink: ~/Exaix/Portals/OldProject
  - Archive context card: ~/ExaixMemory/Portals/_archived/OldProject_20251126.md
  - Update configuration
Continue? (y/N): y

✓ Removed symlink
✓ Archived context card
✓ Updated configuration
✓ Logged to Activity Journal
⚠️  Daemon restart recommended: exactl daemon restart
```

#### **Blueprint Commands** - Manage agent definitions

Blueprints define agent personas, capabilities, and system prompts. They are **required** for request processing - missing blueprints cause requests to fail.

```bash
# Create a new identity blueprint
exactl blueprint create <agent-id> --name "Agent Name" --model <provider:model>
exactl blueprint create senior-coder --name "Senior Coder" --model anthropic:claude-sonnet

# Create with full options
exactl blueprint create security-auditor \
  --name "Security Auditor" \
  --model openai:gpt-4o-mini \
  --description "Specialized agent for security analysis" \
  --capabilities code_review,vulnerability_scanning \
  --system-prompt-file ~/prompts/security.txt

# Create from template (faster setup)
exactl blueprint create my-coder --name "My Coder" --template coder
exactl blueprint create my-reviewer --name "My Reviewer" --template reviewer
exactl blueprint create test-agent --name "Test Agent" --template mock

# List all available blueprints
exactl blueprint list

# Show blueprint details
exactl blueprint show <agent-id>
exactl blueprint show senior-coder

# Validate blueprint format
exactl blueprint validate <agent-id>
exactl blueprint validate senior-coder

# Edit blueprint in $EDITOR
exactl blueprint edit <agent-id>

# Remove a blueprint
exactl blueprint remove <agent-id>
exactl blueprint remove security-auditor --force # Skip confirmation
```

#### **Flow Commands** - Manage multi-agent workflows

Flows allow you to coordinate multiple agents to perform complex tasks.

```bash
# List all available flows
exactl flow list
exactl flow list --json

# Show flow details and dependency graph
exactl flow show <flow-id>
exactl flow show research-pipeline

# Validate a flow definition
exactl flow validate <flow-id>
exactl flow validate research-pipeline
```

#### Routing Commands — Inspect dynamic identity selection

Use routing commands to preview how Exaix will choose an identity before executing a request, and to validate routing policy syntax and semantics.

```bash
# Preview routing candidate ranking for a request file
exactl routing explain --request ./Workspace/Requests/my-request.md

# Validate a routing policy file
exactl routing policy validate ./routing.policy.yaml

# Validate the configured default routing policy
exactl routing policy validate
```

`exactl routing explain` evaluates the request frontmatter and policy rules without creating a plan. It prints the selected identity/version, matched rule, routing strategy, and top candidate scores.

`exactl routing policy validate` checks a YAML policy file against the current schema. When omitted, it validates the configured default routing policy file, typically `.exaix/routing.policy.yaml`.

##### Flow Step Types

Flows support various step types for different orchestration patterns:

| Step Type  | Purpose               | Key Features                    |
| ---------- | --------------------- | ------------------------------- |
| `agent`    | Execute an agent      | Agent invocation with context   |
| `gate`     | Quality checkpoint    | Pass/fail criteria, retry logic |
| `branch`   | Conditional branching | Expression-based path selection |
| `parallel` | Concurrent execution  | Multiple steps in parallel      |
| `loop`     | Iterative processing  | Repeat until condition met      |

##### Condition Expressions

Flow conditions use a safe expression syntax:

```yaml
# Simple comparisons
condition: "status == 'success'"
condition: "confidence >= 80"

# Logical operators
condition: "status == 'success' && score >= 70"
condition: "isComplete || hasTimeout"

# Step result access
condition: "steps.validation.passed == true"
condition: "steps.analysis.score >= threshold"
```

##### Quality Gates

Gates enforce quality standards before proceeding:

```yaml
step:
  type: gate
  name: code_review_gate
  condition: "score >= 80"
  criteria:
    - CODE_CORRECTNESS
    - HAS_TESTS
  onPass: continue
  onFail:
    action: feedback
    maxRetries: 3
```

**Built-in Evaluation Criteria:**

| Criteria           | Description                           |
| ------------------ | ------------------------------------- |
| `CODE_CORRECTNESS` | Validates syntax and semantics        |
| `HAS_TESTS`        | Ensures test coverage exists          |
| `FOLLOWS_SPEC`     | Matches specification requirements    |
| `IS_SECURE`        | Checks security best practices        |
| `PERFORMANCE_OK`   | Validates performance characteristics |

##### Feedback Loops

Feedback loops enable iterative refinement:

```yaml
step:
  type: loop
  name: refinement_loop
  maxIterations: 5
  exitCondition: "quality >= 90"
  onMaxIterations: proceed_with_best
  steps:
    - type: agent
      agent: reviewer
    - type: gate
      condition: "review.passed"
```

**Available Templates:**

| Template     | Model                   | Best For                          |
| ------------ | ----------------------- | --------------------------------- |
| `default`    | ollama:codellama:13b    | General-purpose tasks             |
| `coder`      | anthropic:claude-sonnet | Software development              |
| `reviewer`   | openai:gpt-4o-mini      | Code review and quality           |
| `architect`  | anthropic:claude-opus   | System design and architecture    |
| `researcher` | openai:gpt-5            | Research and analysis             |
| `gemini`     | google:gemini-3-flash   | Multimodal AI with fast responses |
| `mock`       | mock:test-model         | Testing and CI/CD                 |

**Blueprint File Structure:**

```markdown
+++
agent_id = "senior-coder"
name = "Senior Coder"
model = "anthropic:claude-3-sonnet"
capabilities = ["code_generation", "debugging"]
created = "2025-12-02T10:00:00Z"
created_by = "user@example.com"
version = "1.0.0"
+++

# Senior Coder Agent

System prompt with <thought> and <content> tags...
```

**Example workflow:**

```bash
# 1. Create a custom agent
$ exactl blueprint create my-agent \
  --name "My Custom Agent" \
  --model anthropic:claude-sonnet
✓ Blueprint created: Blueprints/Identities/my-agent.md

# 2. List all agents
$ exactl blueprint list
senior-coder (anthropic:claude-3-sonnet)
security-auditor (openai:gpt-4o-mini)
my-agent (anthropic:claude-sonnet)

# 3. Use in requests
$ exactl request "Review code" --agent security-auditor
```

**Common errors and solutions:**

```bash
# Error: Target path does not exist
$ exactl portal add /nonexistent/path BadPortal
✗ Error: Target path does not exist: /nonexistent/path
✗ Portal creation failed - no changes made

Solution: Verify the path exists and is accessible

# Error: Alias already exists
$ exactl portal add ~/Dev/Another MyWebsite
✗ Error: Portal 'MyWebsite' already exists

Solution: Use a different alias or remove the existing portal first

# Error: Invalid alias characters
$ exactl portal add ~/Dev/Project "My Project!"
✗ Error: Alias contains invalid characters. Use alphanumeric, dash, underscore only.

Solution: Use only letters, numbers, dashes, and underscores

# Error: Permission denied (macOS)
$ exactl portal add ~/Desktop/MyApp MyApp
✗ Error: Permission denied - Full Disk Access required

Solution: System Settings → Privacy & Security → Full Disk Access → Enable for Terminal

# Warning: inotify limit (Linux)
⚠️  Warning: File watch limit may be insufficient for large portals
Current limit: 8192 watches

Solution: Increase limit with: echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
```

**Alias validation rules:**

- Must contain only alphanumeric characters, dashes, and underscores
- Cannot start with a number
- Cannot be empty
- Cannot use reserved names: `System`, `Workspace`, `Memory`, `Blueprints`, `Active`, `Archive`
- Maximum length: 50 characters

#### **Daemon Commands** - Control the Exaix daemon

Manage the background daemon process:

```bash
# Start the daemon (runs in background, returns to prompt)
exactl daemon start

# Alternative: start via deno task (also backgrounds)
deno task start:bg

# For development: run in foreground (blocks terminal, shows live output)
deno task start

# Stop the daemon gracefully
exactl daemon stop

# Restart the daemon
exactl daemon restart

# Check daemon status
exactl daemon status

# View daemon logs
exactl daemon logs
exactl daemon logs --lines 100           # Show last 100 lines
exactl daemon logs --follow              # Stream logs (like tail -f)
```

#### **Skill Commands** - Manage Procedural Skills

Skills are reusable procedural knowledge that agents can learn and apply. They represent patterns, techniques, and best practices that improve agent performance over time.

```bash
# List all available skills
exactl skill list

# Show details of a specific skill
exactl skill show <skill-id>

# Match skills for a given request
exactl skill match "Implement user authentication"

# Derive a new skill from recent learnings
exactl skill derive --name "API Security Patterns"

# Create a new skill manually
exactl skill create <name> --description "Skill description"
```

**Skill Types:**

- **Procedural Skills:** Step-by-step processes (e.g., "Code Review Process")
- **Pattern Skills:** Reusable patterns (e.g., "Error Handling Patterns")
- **Domain Skills:** Specialized knowledge (e.g., "React Best Practices")
- **Tool Skills:** How to use specific tools effectively

**Example workflow:**

```bash
# Find relevant skills for a task
$ exactl skill match "Build a REST API"
🔍 Matching skills for: "Build a REST API"

API Design Patterns (95% match)
  Description: Best practices for REST API design
  Usage: 23 times, Success: 21/23

Authentication Implementation (87% match)
  Description: Secure authentication patterns
  Usage: 15 times, Success: 14/15

# Use a skill in a request
$ exactl request "Build a REST API for user management" --skill api-design-patterns
```

#### **MCP Commands** - Model Context Protocol Server

The Model Context Protocol (MCP) allows external AI clients to interact with your Exaix workspace using standardized tools.

```bash
# Start the MCP server
exactl mcp start

# Start with debug logging
exactl mcp start --log-level debug

# Check MCP server status
exactl mcp status
```

**Available MCP Tools:**

- `exaix_create_request`: Create new requests in your workspace
- `exaix_list_plans`: View pending plans for approval
- `exaix_approve_plan`: Approve plans for execution
- `exaix_query_journal`: Search the Activity Journal
- File system tools: `read_file`, `write_file`, `list_dir`, etc. (scoped to workspace)

**Client Integration:**

**Claude Desktop:**

```json
{
  "mcpServers": {
    "exaix": {
      "command": "exactl",
      "args": ["mcp", "start"],
      "env": {
        "EXAIX_ROOT": "/path/to/your/workspace"
      }
    }
  }
}
```

**Example workflow:**

```bash
# Start MCP server
$ exactl mcp start
🚀 MCP Server started on stdio
  Tools: exaix_create_request, exaix_list_plans, exaix_approve_plan, exaix_query_journal
  File system access: scoped to workspace

# External client can now use Exaix tools
# Client: "Create a request to refactor the authentication module"
# Exaix: ✓ Request created: request-abc123.md
```

#### **Memory Banks CLI** - Access Execution History and Project Knowledge

Exaix provides comprehensive CLI commands to access your workspace's memory banks.

**Memory Commands:**

```bash
# List all projects
exactl memory projects

# Get project details
exactl memory project MyProject

# List execution history
exactl memory execution

# Get specific execution details
exactl memory execution trace-abc123

# Search across all memory banks
exactl memory search "database migration"

# Search within specific project
exactl memory search --project MyProject "API changes"
```

**Features:**

- **Execution History:** Every agent run automatically stored with full context
- **Project Knowledge:** Persistent context for ongoing projects
- **Full-text Search:** Find patterns across all memory banks
- **Structured Data:** JSON metadata alongside human-readable summaries
- **No Dependencies:** Direct CLI access without external tools

#### **Watch Command** - Live Execution Streaming

The `exactl watch` command provides real-time, `docker logs -f` style observability for agent executions. It connects to the local SSE stream and tails execution events as they happen, with color-coded output for different event types.

```bash
# Watch a live execution by trace ID
exactl watch a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Watch with a custom SSE port (if not using default 8765)
EXA_SSE_PORT=9000 exactl watch a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Output format (color-coded):**

| Event Type  | Color    | Example Output                                        |
| ----------- | -------- | ----------------------------------------------------- |
| Heartbeat   | Dim gray | `[14:30:15] ♥ heartbeat step="Step 1" elapsed=5000ms` |
| Tool Start  | Cyan     | `[14:30:16] ▶ tool.start tool="read_file"`            |
| Tool End    | Cyan     | `[14:30:17] ◀ tool.end tool="read_file"`              |
| LLM Stream  | White    | `[14:30:18] ◈ llm.stream Thinking about...`           |
| Flow Status | Green    | `[14:30:19] ◆ flow.status status="running"`           |

**How it works:**

1. **Live mode:** If the daemon's SSE server is running, `watch` connects to `http://127.0.0.1:8765/api/v1/traces/:id/stream` and streams events in real time.
2. **Fallback mode:** If the SSE server is unavailable (daemon stopped, execution finished), `watch` queries the Activity Journal database and displays historical events for that trace, then exits.

**Behavior:**

- Heartbeats fire every 5 seconds during long-running LLM calls, confirming the agent is still active.
- Press `Ctrl+C` to stop watching at any time.
- The command validates the trace ID (must be a valid UUID) before connecting.

---

**Example workflow:**

```bash
# Check if daemon is running
$ exactl daemon status
🔧 Daemon Status

Version: 1.0.0
Status: Running ✓
PID: 12345
Uptime: 2:15:30

# View recent logs
$ exactl daemon logs --lines 20

# Follow logs in real-time
$ exactl daemon logs --follow
[2025-11-25 14:30:15] INFO: Daemon started
[2025-11-25 14:30:16] INFO: Watching /Workspace/Requests
[2025-11-25 14:32:45] INFO: New request detected: implement-auth
...
```

#### **Wait Commands** - Resolve durable wait states

When a flow execution reaches a quality gate that fails below the configured
threshold, the `FlowRunner` creates a **durable wait state** that pauses the
flow until an operator resolves it. Use `exactl wait` commands to list and
resolve these pending decisions.

```bash
# List all pending wait states
exactl wait list

# Filter by status
exactl wait list --status pending

# Approve a wait state (flow resumes from last checkpoint)
exactl wait approve <resume-token> -m "Approved after review"

# Reject a wait state
exactl wait reject <resume-token> -m "Does not meet criteria"

# Amend a wait state — marks original as amended and creates a successor
exactl wait amend <resume-token> -m "Please revise approach"

# Expire a wait state (bypasses deadline)
exactl wait expire <resume-token> -m "Timed out"
```

**Wait state lifecycle:**

| Command   | Resulting status | Flow behavior                                      |
| --------- | ---------------- | -------------------------------------------------- |
| `approve` | `fulfilled`      | Resumes flow execution from the last checkpoint    |
| `reject`  | `rejected`       | Flow halts — gate decision stands as rejected      |
| `amend`   | `amended`        | Original wait is replaced by a successor amendment |
| `expire`  | `expired`        | Wait is closed without resumption                  |

Wait states are persisted as JSON files at `{workspace}/WaitStates/{traceId}/{waitStateId}.json`
and can be inspected manually if needed.

---

### 4.3 Quick Reference

**Most Common Operations:**

```bash
# Create requests quickly (instead of manual file creation)
exactl request "Add user authentication"    # Quick request
exactl request "Fix bug" --priority high    # With priority
exactl request -i                           # Interactive mode

# Human review workflow
exactl plan list                           # See pending plans
exactl plan show <id>                      # Review plan details
exactl plan approve <id>                   # Approve for execution
exactl plan reject <id> --reason "..."     # Reject with feedback

# Code review workflow
exactl review list                      # See agent-created branches
exactl review show <id>                 # Review code changes
exactl review approve <id>              # Merge to main
exactl review reject <id> --reason "..."# Delete branch

# Portal management
exactl portal add ~/Dev/MyProject MyProject  # Mount external project
exactl portal list                           # Show all portals
exactl portal show MyProject                 # Portal details
exactl portal remove MyProject               # Unmount portal
exactl portal verify                         # Check portal integrity
exactl portal refresh MyProject              # Update context card
exactl portal analyze MyProject              # Analyze codebase knowledge
exactl portal knowledge MyProject            # Show gathered knowledge

# Daemon management
exactl daemon start                        # Start background process
exactl daemon stop                         # Stop gracefully
exactl daemon status                       # Check health
exactl daemon logs --follow                # Watch logs

# Git operations
exactl git branches                        # List all branches
exactl git status                          # Working tree status
exactl git log --trace <id>                # Find commits by trace

# Memory and skills
exactl memory search "authentication"      # Search execution history
exactl skill match "API design"            # Find relevant skills
exactl skill list                          # List all skills

# MCP server
exactl mcp start                          # Start MCP server for external clients
exactl mcp status                          # Check MCP server status

# Activity Journal
exactl journal --tail 20                  # View recent activity
exactl journal --filter action_type=error # Find errors
exactl journal --count                    # Count activities by type
```

### 4.4 Activity Logging

All human actions via CLI are automatically logged to the Activity Journal:

- Plan approvals/rejections → `plan.approved`, `plan.rejected`
- Review approvals/rejections → `review.approved`, `review.rejected`
- All actions tagged with `actor='human'`, `via='cli'`
- User identity captured from git config or OS username

Query activity history:

```bash
# View recent activity history
exactl journal --tail 10

# Filter by trace ID to see complete request lifecycle
TRACE_ID=$(exactl journal --tail 1 --format json | jq -r '.[0].trace_id')
exactl journal --filter trace_id=$TRACE_ID

# Audit all errors across the system
exactl journal --filter action_type=error
```

### 4.5 Output Formatting

All CLI commands output human-readable text by default. JSON output is supported for scripting:

```bash
# Human-readable (default)
exactl plan list

# Machine-readable JSON output
exactl plan list --format json
```

### 4.6 File Format Reference

Exaix uses **YAML frontmatter** for all markdown files (requests, plans, reports). This format provides structured metadata for processing and search.

#### YAML Frontmatter Format

Request, plan, and report files use `---` delimiters with YAML syntax:

```markdown
---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created: 2025-11-28T10:30:00.000Z
status: pending
priority: normal
agent: default
source: cli
created_by: user@example.com
tags: [feature, api]
---

# Request

Implement user authentication for the API...
```

#### Why YAML Frontmatter?

| Benefit                 | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| **Memory Banks search** | Structured metadata enables powerful search and filtering |
| **CLI commands work**   | CLI can filter/sort by status, priority, agent            |
| **Standard format**     | Most markdown tools expect YAML (`---` delimiters)        |
| **Auto-generated**      | `exactl request` creates proper frontmatter automatically |

#### Frontmatter Fields Reference

**Request Files** (`Workspace/Requests/request-*.md`):

| Field                 | Type     | Required | Example                                                                     |
| --------------------- | -------- | -------- | --------------------------------------------------------------------------- |
| `trace_id`            | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"`                                    |
| `created`             | datetime | ✓        | `2025-11-28T10:30:00.000Z`                                                  |
| `status`              | string   | ✓        | `pending`, `processing`, `completed`                                        |
| `priority`            | string   | ✓        | `low`, `normal`, `high`, `critical`                                         |
| `agent`               | string   | ✓        | `default`, `senior_coder`, `architect`                                      |
| `source`              | string   | ✓        | `cli`, `file`, `interactive`                                                |
| `created_by`          | string   | ✓        | `user@example.com`                                                          |
| `portal`              | string   |          | `MyProject` (optional project context)                                      |
| `target_branch`       | string   |          | `main` (review base branch for portal work)                                 |
| `acceptance_criteria` | array    |          | `[`"All tests pass"`,`"Endpoint returns 200"`]`                             |
| `expected_outcomes`   | array    |          | `[`"API docs updated"`]`                                                    |
| `scope`               | object   |          | `{ include: ["packages/api/src/"], exclude: ["packages/api/src/legacy/"] }` |
| `tags`                | array    |          | `[feature, api]` (optional tags)                                            |

#### Structured Request Quality Fields

When you already know what "done" means, put it in frontmatter instead of burying it in prose. Exaix treats these fields as explicit, high-confidence signals during analysis and evaluation.

```yaml
---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created: 2025-11-28T10:30:00.000Z
status: pending
priority: high
agent: senior-coder
source: cli
created_by: user@example.com
acceptance_criteria:
  - All existing tests pass
  - Input validation rejects payloads larger than 1MB
expected_outcomes:
  - Upload endpoint available at /api/v2/upload
scope:
  include: ["packages/api/src/", "tests/api/"]
  exclude: ["packages/api/src/legacy/"]
---
```

CLI flags map directly to these fields:

- `--acceptance-criteria` → `acceptance_criteria`
- `--expected-outcome` → `expected_outcomes`

Use them when you want fewer clarification rounds and more reliable evaluation against your actual requirements.

**Plan Files** (`Workspace/Plans/*.md`):

| Field        | Type     | Required | Example                                  |
| ------------ | -------- | -------- | ---------------------------------------- |
| `trace_id`   | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"` |
| `request_id` | string   | ✓        | `"implement-auth"`                       |
| `status`     | string   | ✓        | `review`, `approved`, `rejected`         |
| `created_at` | datetime | ✓        | `2025-11-28T10:35:00.000Z`               |
| `agent_id`   | string   | ✓        | `senior_coder`                           |

**Report Files** (`Memory/Reports/*.md`):

| Field          | Type     | Required | Example                                  |
| -------------- | -------- | -------- | ---------------------------------------- |
| `trace_id`     | string   | ✓        | `"550e8400-e29b-41d4-a716-446655440000"` |
| `request_id`   | string   | ✓        | `"implement-auth"`                       |
| `status`       | string   | ✓        | `completed`, `failed`                    |
| `completed_at` | datetime | ✓        | `2025-11-28T11:00:00.000Z`               |
| `agent_id`     | string   | ✓        | `senior_coder`                           |
| `branch`       | string   |          | `feat/implement-auth-550e8400`           |

#### YAML Syntax Quick Reference

```yaml
# Strings (quotes optional for simple values)
status: pending
agent: default

# Strings with special characters (quotes required)
trace_id: "550e8400-e29b-41d4-a716-446655440000"
created_by: "user@example.com"

# Dates (ISO 8601 format)
created: 2025-11-28T10:30:00.000Z

# Arrays (inline format)
tags: [feature, api, urgent]

# Arrays (block format)
acceptance_criteria:
  - All tests pass
  - Endpoint returns 200

# Nested objects
scope:
  include: [packages/api/src/, tests/api/]
  exclude: [packages/api/src/legacy/]

# Booleans
approved: true
```

> **💡 TIP:** Use `exactl request` to create requests with proper frontmatter automatically. Manual file creation is error-prone.

### 4.7 Bootstrap (Reference Implementation)

```bash
# 1. Clone or deploy workspace
./scripts/deploy_workspace.sh ~/Exaix

# 2. Navigate to workspace
cd ~/Exaix

# 3. Cache dependencies
deno task cache

# 4. Initialize database and system
deno task setup

# 5. Start daemon
exactl daemon start
# or: deno task start

# 6. Verify daemon is running
exactl daemon status
```

**Complete workflow example:**

```bash
# 1. Create a request (quick method - recommended)
exactl request "Implement user authentication for the API"
# Output: ✓ Request created: request-a1b2c3d4.md

# Alternative: Manual file creation (if you need custom frontmatter)
# echo "Implement user authentication" > ~/Exaix/Workspace/Requests/auth.md

# 2. Agent will generate a plan automatically
# Wait a moment... (daemon watches Workspace/Requests)

# 3. Review the plan
exactl plan list
exactl plan show implement-auth

# 4. Approve the plan
exactl plan approve implement-auth

# 5. Review changes created by agents
exactl review list
exactl review show implement-auth

# 6. Approve the review to merge
exactl review approve implement-auth

# Current Status:
# ✅ Request creation automated
# ✅ Plan generation automated
# ✅ Plan approval workflow complete
# ✅ Plan detection and parsing implemented
# ✅ Review creation and approval available
# 🚧 Full agent-driven execution in development

# All completed steps logged to Activity Journal with trace_id
```

## 5. Operational Procedures

### 5.1 Backup

**Before Backup:**

```bash
# Stop daemon to ensure database consistency
deno task stop
```

**Backup Command:**

```bash
# Backup Exaix directory
tar -czf exaix-backup-$(date +%Y%m%d).tar.gz \
  --exclude='*.log' \
  --exclude='deno-dir' \
  ~/Exaix

# Verify backup
tar -tzf exaix-backup-*.tar.gz | head
```

**What to backup separately:**

- Portals are symlinks, not actual code
- Actual project code lives in `~/Dev/*` (backup separately)
- OS keyring secrets (handled by OS backup tools)

### 5.2 Restore

```bash
# Extract backup
tar -xzf exaix-backup-20251120.tar.gz -C ~/

# Verify portal symlinks still work
cd ~/Exaix/Portals
ls -la

# Recreate broken symlinks if projects moved
deno task mount ~/Dev/MyProject MyProject

# Restart daemon
deno task start
```

### 5.3 Upgrade Exaix

```bash
# 1. Stop daemon
deno task stop

# 2. Backup current version (see 12.1)
tar -czf exaix-pre-upgrade.tar.gz ~/Exaix

# 3. Pull latest code
cd ~/Exaix
git pull origin main

# 4. Check for breaking changes
cat CHANGELOG.md

# 5. Run migrations if needed
deno task migrate

# 6. Clear Deno cache (forces re-compilation)
deno cache --reload apps/daemon/main.ts

# 7. Restart daemon
deno task start

# 8. Verify
deno task status
```

### 5.4 Troubleshooting

**Agent Stuck / Unresponsive:**

```bash
# Check daemon status
exactl daemon status

# View recent daemon logs
exactl daemon logs --lines 50

# Check active git branches
exactl git branches --pattern "feat/*"

# View agent activity
exactl review list

# Restart daemon if needed
exactl daemon restart
```

**Plan Not Processing:**

```bash
# List pending plans
exactl plan list

# Check if plan is approved
exactl plan show <id>

# Approve if status is 'review'
exactl plan approve <id>

# Check daemon logs for errors
exactl daemon logs --follow
```

**Code Changes Not Visible:**

```bash
# List all reviews
exactl review list

# Show specific review details
exactl review show <id>

# Check git status
exactl git status

# View branches
exactl git branches
```

**Database Corruption:**

```bash
# Stop daemon first
exactl daemon stop

# Check integrity
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
cp ~/backups/journal.db ~/Exaix/.exa/journal.db

# If no backup, rebuild empty database
rm ~/Exaix/.exa/journal.db
deno task setup --db-only

# Restart daemon
exactl daemon start
```

**Permission Errors:**

```bash
# Check current Deno permissions
cat deno.json

# View daemon status for errors
exactl daemon status
exactl daemon logs

# Verify workspace paths are accessible
ls -la ~/Exaix/Workspace
ls -la ~/Exaix/.exa

# Restart with correct permissions
exactl daemon restart
```

### 5.5 Uninstall

```bash
# 1. Stop daemon
exactl daemon stop

# 2. Remove Exaix directory
rm -rf ~/Exaix

# 3. Remove CLI tool from PATH (if installed globally)
rm ~/.deno/bin/exactl

# 4. Portals are just symlinks - actual projects untouched
# Nothing to clean unless you want to remove project directories
```

### 5.6 Health Check

```bash
# Check daemon status
exactl daemon status

# Output:
# 🔧 Daemon Status
# Version: 1.0.0
# Status: Running ✓
# PID: 12345
# Uptime: 2:15:30

# View recent activity
exactl daemon logs --lines 20

# Check git repository status
exactl git status

# List pending work
exactl plan list
exactl review list

# View all branches
exactl git branches
```

### 5.7 Common Workflows

**Daily Operations:**

```bash
# Morning: Check what's pending
exactl plan list
exactl review list

# Review and approve plans
exactl plan show <id>
exactl plan approve <id>

# Review and merge code
exactl review show <id>
exactl review approve <id>

# End of day: Check daemon health
exactl daemon status
```

**Weekly Maintenance:**

```bash
# Stop daemon for backup
exactl daemon stop

# Backup workspace (see section 5.1)
tar -czf exaix-backup-$(date +%Y%m%d).tar.gz ~/Exaix

# Clean up old branches
exactl git branches | grep -v main | xargs git branch -d

# Restart daemon
exactl daemon start
```

### 5.8 Portal Workflows

Portals enable agents to work directly in external project repositories (e.g., `~/git/MyProject`) instead of the deployed workspace. This ensures git operations, feature branches, and reviews track actual source code changes in the correct repositories.

#### How Portal Execution Works

When you submit a request targeting a portal:

1. **Execution Environment**: Agent runs in portal workspace (e.g., `~/git/MyProject`)

1.
1.

#### Cleanup & lifecycle notes

- **Portals:** A portal is a stable symlink entry under `Portals/`. It is not auto-removed; use `exactl portal remove <alias>` when you no longer want it mounted.
- **Reviews:** Review records remain for audit/history, but their _working artifacts_ (branches/worktrees) may be cleaned up as part of approve/reject.
- **Worktree execution:** Some portal runs use an isolated Git worktree checkout. A pointer is recorded at `Memory/Execution/{trace-id}/worktree` pointing to the worktree directory.
  - **Approve/Reject:** Worktree checkout + pointer are removed to avoid stale worktrees.
  - **Approve:** The feature branch is deleted after cleanup.
  - **Merge conflict:** Exaix aborts the merge (best effort) and removes the worktree checkout + pointer, but keeps the feature branch for manual conflict resolution.

#### Code Analysis with Portal

Read-only agents (like `code-analyst`) execute in portal workspace but don't create git branches. Instead, they produce analysis artifacts stored in `Memory/Execution/`:

```bash
# Add portal to workspace
exactl portal add ~/git/MyProject my-project

# Submit analysis request (read-only agent)
exactl request --portal my-project "Analyze src/ architecture"

# Review results (artifact, not git review)
exactl review list
exactl review show artifact-<id>

# Approve the analysis
exactl review approve artifact-<id>
```

**Analysis Workflow:**

- Agent reads portal files for context
- No git branch created (read-only operation)
- Analysis stored as markdown artifact with frontmatter status
- Review via unified `exactl review` command

#### Feature Development with Portal

Write-capable agents (like `feature-developer`) create feature branches in the portal repository:

```bash
# Submit feature request (write-capable agent)
exactl request --portal my-project --agent feature-developer "Add user authentication"

# Review changes in portal repository
cd ~/git/MyProject
git log --oneline  # Shows feature branch
git diff main      # Shows actual code changes

# Or review via Exaix
exactl review list
exactl review show <review-id>

# Approve and merge
exactl review approve <review-id>
```

**Development Workflow:**

- Agent creates feature branch in portal's .git/
- Code modifications happen in portal workspace
- Review shows only modified files (not entire workspace)
- Feature branch ready for review in source repository

#### Portal Git Integration

**Automatic Behaviors:**

- ✅ Write agents create feature branches in portal repository
- ✅ Reviews reference portal repo, not deployed workspace
- ✅ File modifications happen in portal workspace
- ✅ Git history maintained in correct repository

**Manual Steps:**

- Add portals: `exactl portal add /path/to/repo alias`
- Review changes: `exactl review show <id>`
- Approve changes: `exactl review approve <id>`
- Merge feature branch in portal repo after execution

#### Troubleshooting Portal Issues

##### Issue: Portal not found

```bash
# Verify portal exists
exactl portal list

# Check portal configuration
exactl portal show my-project
```

##### Issue: Git operations in wrong repository

```bash
# Verify portal has .git directory
ls -la ~/git/MyProject/.git

# Check review repository reference
exactl review show <id> | grep repository
```

##### Issue: Review shows all workspace files

```bash
# This indicates portal execution didn't work
# Verify request used --portal flag
exactl request --portal my-project "..."

# Check that portal path is correct
exactl portal show my-project
```

#### Migration from Workspace Execution

**Before (workspace execution):**

```bash
exactl request "Analyze code"
# Result: Operates in ~/Exaix
```

**After (portal execution - recommended):**

```bash
exactl request --portal my-project "Analyze code"
# Result: Operates in ~/git/MyProject
```

#### Portal Knowledge Gathering (Phase 46)

Exaix automatically analyzes every portal codebase and stores the results in
`Memory/Projects/{alias}/knowledge.json`. This gives agents structured, up-to-date
context about the project without reading every file on each request.

**What is gathered:**

| Category            | Examples                                            |
| ------------------- | --------------------------------------------------- |
| Directory census    | File count, extension breakdown, top-level folders  |
| Key files           | Entry points, `package.json`, `deno.json`, configs  |
| Dependencies        | Runtime deps, dev deps, package manager             |
| Code conventions    | Naming patterns, test file naming, style hints      |
| Architecture layers | `src/`, `tests/`, `docs/` inference                 |
| Exported symbols    | Public API types and functions (TS/JS portals only) |

**When does analysis run?**

- Automatically on `portal add` and `portal refresh` (when `auto_analyze_on_mount = true`).
- Automatically before each request execution if the snapshot is stale (default: > 168 hours).
- Manually on demand with `exactl portal analyze <alias>`.

**Modes:**

| Mode       | Speed  | Detail | Requires LLM |
| ---------- | ------ | ------ | ------------ |
| `quick`    | Fast   | Low    | No           |
| `standard` | Medium | High   | No           |
| `deep`     | Slow   | Full   | Optional     |

**CLI commands:**

```bash
# Run analysis manually (default: quick mode)
exactl portal analyze MyProject

# Force deep analysis, ignore staleness
exactl portal analyze MyProject --mode deep --force

# Display gathered knowledge (human-readable)
exactl portal knowledge MyProject

# Display as machine-readable JSON
exactl portal knowledge MyProject --json
```

**Configuration (`[portal_knowledge]` in `exa.config.toml`):**

```toml
[portal_knowledge]
auto_analyze_on_mount = true      # Analyze on portal add/refresh
default_mode          = "quick"   # quick | standard | deep
quick_scan_limit      = 200       # Max files read in quick mode
max_files_to_read     = 50        # Hard cap across all strategies
staleness_hours       = 168       # Re-analyze after this many hours (default: 1 week)
use_llm_inference     = true      # Allow LLM calls in deep mode
ignore_patterns       = ["node_modules", ".git", "dist", "build"]
```

**Where is it stored?**

Knowledge snapshots are saved at `Memory/Projects/{alias}/knowledge.json`. You can
inspect them directly or via `exactl portal knowledge <alias> --json`.

---

## 6. Advanced Agent Features

Exaix includes sophisticated agent orchestration capabilities that enhance output quality, reliability, and context awareness. This section covers the advanced features available for agent configuration.

### 6.1 Reflexion Pattern (Self-Critique)

The Reflexion pattern enables agents to critique and improve their own outputs iteratively.

#### How It Works

1. Agent generates initial response

1.
1.

#### Configuration

Enable reflexion in identity blueprint frontmatter:

```toml
+++
agent_id = "quality-reviewer"
name = "Quality Reviewer"
model = "anthropic:claude-opus-4.5"
capabilities = ["read_file", "search_files"]
reflexive = true
max_reflexion_iterations = 3
confidence_required = 80
+++
```

| Field                      | Default | Description                          |
| -------------------------- | ------- | ------------------------------------ |
| `reflexive`                | `false` | Enable self-critique loop            |
| `max_reflexion_iterations` | `3`     | Maximum refinement passes            |
| `confidence_required`      | `80`    | Minimum confidence (0-100) to accept |

#### When to Use

- **Code review agents**: Catch issues the first pass might miss
- **Technical writing**: Ensure accuracy and completeness
- **Security audits**: Multi-pass vulnerability analysis
- **Quality-critical tasks**: Any output requiring high confidence

#### Trade-offs

- **Higher quality**: More thorough analysis
- **Increased latency**: 2-4x longer response time
- **Higher cost**: Multiple LLM calls per request

### 6.2 Confidence Scoring

Every agent output includes a confidence score indicating how certain the agent is about its response.

#### Understanding Confidence Scores

| Score  | Level     | Interpretation                                         |
| ------ | --------- | ------------------------------------------------------ |
| 90-100 | Very High | Confident response, proceed with caution-free approval |
| 70-89  | High      | Good confidence, standard review recommended           |
| 50-69  | Medium    | Moderate uncertainty, careful review needed            |
| 30-49  | Low       | Significant uncertainty, human verification required   |
| 0-29   | Very Low  | Agent uncertain, consider alternate approach           |

#### Human Review Triggers

Outputs with confidence below threshold are flagged for human review:

```toml
[agents]
confidence_threshold = 70  # Flag outputs below this score
```

When flagged, you'll see warnings in the plan output:

```bash
⚠️ Low confidence (55%): Agent uncertain about database migration strategy.
   Reasoning: Multiple valid approaches exist; recommend architectural review.
```

### 6.3 Session Memory

Session Memory automatically provides relevant context from past interactions to agents.

#### How It Works

1. **Request received**: User submits a request

1.
1.
1.

#### Configuration

```toml
[agents.memory]
enabled = true           # Enable session memory
topK = 5                # Number of memories to inject
threshold = 0.3         # Minimum relevance score (0-1)
maxContextLength = 4000  # Maximum characters for memory context
includeExecutions = true # Include past execution history
includeLearnings = true  # Include approved learnings
includePatterns = true   # Include project patterns
```

#### Memory Types

| Type           | Description                            |
| -------------- | -------------------------------------- |
| **Learnings**  | Approved insights from past executions |
| **Patterns**   | Code patterns identified in projects   |
| **Decisions**  | Architectural decisions and rationale  |
| **Executions** | Past agent execution summaries         |

#### Viewing Memory Context

To see what memories were injected for a request:

```bash
exactl request show <request-id> --show-context
```

### 6.4 Retry & Recovery

Agents automatically retry failed operations with intelligent backoff.

#### Retry Behavior

| Attempt | Wait Time  | With Jitter |
| ------- | ---------- | ----------- |
| 1       | 1 second   | 0.5-1.5s    |
| 2       | 2 seconds  | 1.0-3.0s    |
| 3       | 4 seconds  | 2.0-6.0s    |
| 4       | 8 seconds  | 4.0-12.0s   |
| 5       | 16 seconds | 8.0-24.0s   |

#### Configuration

```toml
[agents.retry]
maxAttempts = 5
initialDelay = 1000      # ms
maxDelay = 60000         # ms
backoffMultiplier = 2.0
jitterFactor = 0.5
retryableErrors = [
  "rate_limit_exceeded",
  "service_unavailable",
  "timeout",
  "connection_reset"
]
```

#### Non-Retryable Errors

Some errors are not retried:

- Authentication failures
- Invalid input/schema errors
- Permission denied
- Resource not found

### 6.5 Structured Output Validation

Agent outputs are validated against JSON schemas with automatic repair.

#### Validation Process

1. **Extract JSON**: Parse JSON from agent response

1.
1.

#### Auto-Repair Capabilities

| Issue              | Auto-Fix                |
| ------------------ | ----------------------- |
| Trailing commas    | Removed                 |
| Missing quotes     | Added around keys       |
| Unescaped newlines | Escaped                 |
| Comments in JSON   | Stripped                |
| Truncated output   | Detected (not repaired) |

#### Validation Errors

When validation fails, you'll see detailed errors:

```bash
❌ Plan validation failed:
  - steps[2].dependencies: Expected array, got string
  - estimatedDuration: Missing required field
  - steps[0].tools[1]: Unknown tool "invalid_tool"
```

### 6.6 Agent Templates

Exaix provides templates for common agent patterns:

| Template               | Pattern                  | Best For                     |
| ---------------------- | ------------------------ | ---------------------------- |
| `pipeline-agent`       | Sequential processing    | Transformations in workflows |
| `collaborative-agent`  | Multi-agent coordination | Handoffs and consensus       |
| `reflexive-agent`      | Self-critique            | Quality-critical tasks       |
| `research-agent`       | Information gathering    | Exploration, documentation   |
| `judge-agent`          | LLM-as-Judge             | Quality gates, approvals     |
| `specialist-agent`     | Domain expertise         | Security, architecture       |
| `conversational-agent` | Multi-turn dialogue      | Interactive sessions         |

#### Using Templates

```bash
# Copy template
cp Blueprints/Identities/templates/reflexive-agent.md.template \
   Blueprints/Identities/my-agent.md

# Edit placeholders
# Validate
exactl blueprint validate my-agent

# Use
exactl request "Task" --agent my-agent
```

See `Blueprints/Identities/templates/README.md` for detailed template documentation.

### 6.7 Troubleshooting

#### High Latency

If agent responses are slow:

1. **Check reflexion settings**: Reduce `max_reflexion_iterations`

1.
1.

#### Low Confidence Outputs

If agents consistently produce low-confidence outputs:

1. **Check prompt clarity**: Ensure request is specific

1.
1.

#### Retry Exhaustion

If agents fail after max retries:

1. **Check service status**: Provider may be down

1.
1.

#### Memory Not Found

If relevant memories aren't being injected:

1. **Check threshold**: Lower `threshold` value (e.g., 0.1)

1.
1.

---

## 7. Configuration

Exaix is designed to be fully configurable without modifying source code. The primary configuration file is `exa.config.toml` (located in your workspace root).

### 5.1 The "No Magic Values" Policy

We enforce a strict "No Magic Values" policy. This means all timeouts, limits, model names, and provider settings are defined in your configuration file, not hardcoded in the application.

- **Defaults:** A `exa.config.sample.toml` is provided with sensible defaults.
- **Customization:** Copy `exa.config.sample.toml` to `exa.config.toml` to override any setting.

### 5.2 Key Configuration Areas

The main configuration areas in `exa.config.toml` are:

- **[system]:** Workspace paths, logging level
- **[watcher]:** File watching settings (debounce, extensions)
- **[models]:** AI provider configurations
- **[agents]:** Agent blueprint settings
- **[mcp]:** Model Context Protocol client configuration
- **[quality_gate]:** Request quality gate thresholds, mode, and enrichment behaviour (Phase 47)

**Example configuration:**

```toml
[agents]
default_model = "claude-opus-4.5"
max_tokens = 8192

[system]
watcher_timeout_sec = 60
debounce_ms = 200

[mcp]
server_name = "exaix-mcp"
version = "1.0.0"
enable_stdio = true
enable_sse = false

# Quality gate — controls automatic request quality checks
[quality_gate]
enabled = true
mode = "hybrid"           # "heuristic" | "llm" | "hybrid"
auto_enrich = true        # auto-rewrite acceptable-range requests
block_unactionable = false  # reject (vs ask) when score < minimum
max_clarification_rounds = 5

[quality_gate.thresholds]
minimum = 20    # below → needs-clarification or reject
enrichment = 50 # below → auto-enrich (if auto_enrich = true)
proceed = 70    # at or above → proceed immediately
```

**Best Practices:**

1. **Never modify `packages/core/src/constants.ts` directly** - All magic values are defined in `exa.config.toml`

1.

### 5.3 Environment Variable Reference

Exaix supports environment variables for runtime configuration overrides and API authentication.

#### 5.3.1 Provider API Keys

Cloud providers require API keys set as environment variables:

| Variable            | Provider           | Required When            |
| ------------------- | ------------------ | ------------------------ |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | Using Anthropic provider |
| `OPENAI_API_KEY`    | OpenAI (GPT)       | Using OpenAI provider    |
| `GOOGLE_API_KEY`    | Google (Gemini)    | Using Google provider    |

**Setup (permanent):**

```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export ANTHROPIC_API_KEY="your-key-here"' >> ~/.bashrc
echo 'export OPENAI_API_KEY="your-key-here"' >> ~/.bashrc
echo 'export GOOGLE_API_KEY="your-key-here"' >> ~/.bashrc
source ~/.bashrc
```

#### 5.3.2 Runtime Configuration Overrides

Four environment variables allow runtime override of AI provider configuration:

| Variable             | Purpose                    | Validation        | Example                                          |
| -------------------- | -------------------------- | ----------------- | ------------------------------------------------ |
| `EXA_LLM_PROVIDER`   | Override AI provider       | ProviderType enum | `export EXA_LLM_PROVIDER=ollama`                 |
| `EXA_LLM_MODEL`      | Override model name        | Non-empty string  | `export EXA_LLM_MODEL=llama3.2`                  |
| `EXA_LLM_BASE_URL`   | Override provider endpoint | Valid URL         | `export EXA_LLM_BASE_URL=http://localhost:11434` |
| `EXA_LLM_TIMEOUT_MS` | Override request timeout   | 1000-300000ms     | `export EXA_LLM_TIMEOUT_MS=60000`                |

**Usage Example:**

```bash
# Temporarily use local Ollama for a single request
EXA_LLM_PROVIDER=ollama EXA_LLM_MODEL=llama3.2 exactl request "Explain the codebase"

# Set for the current session
export EXA_LLM_PROVIDER=anthropic
export EXA_LLM_MODEL=claude-opus-4.5
exactl daemon start
```

**Validation:** All `EXA_LLM_*` variables are validated via Zod schema. Invalid values (e.g., timeout below 1000ms, invalid provider name) are rejected with clear warning messages.

**Best Practice:** Use `exa.config.toml` for persistent configuration. Use environment variables for temporary overrides or testing different providers.

#### 5.3.3 Troubleshooting Environment Variables

**Invalid environment variable warnings:**

If you see warnings like "Invalid EXA_LLM_TIMEOUT_MS: must be ≥ 1000", check:

1. **Value is within valid range** (timeout: 1000-300000ms)

1.
1.

**Environment variables not taking effect:**

1. **Restart the daemon** after setting env vars: `exactl daemon restart`

1.

For more details, see `templates/exa.config.sample.toml` and [Technical Specification](./dev/Exaix_Technical_Spec.md).

## 8. Model Context Protocol (MCP) Server

Exaix includes a built-in MCP server, allowing generic AI clients (like Claude Desktop or IDE extensions) to interact with your workspace using standardized tools.

### 8.1 Starting the Server

The standard way to run the MCP server is via the `exactl` CLI:

```bash
# Start in stdio mode (default, for local clients)
exactl mcp start

# Start with detailed logging
exactl mcp start --log-level debug
```

### 8.2 Available Tools

When connected, AI agents have access to high-level domain tools:

- **`exaix_create_request`**: Create a new request in your workspace.
- **`exaix_list_plans`**: List pending plans.
- **`exaix_approve_plan`**: Approve a plan for execution.
- **`exaix_query_journal`**: Search the Activity Journal for past events.
- **FileSystem & Git**: Standard tools (`read_file`, `write_file`, `git_status`, etc.) are also available, scoped to your workspace.

### 8.3 Client Integration

**Claude Desktop:**
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "exaix": {
      "command": "exactl",
      "args": ["mcp", "start"],
      "env": {
        "EXAIX_ROOT": "/path/to/your/workspace"
      }
    }
  }
}
```

See `templates/mcp/` for more client configuration examples.

## 9. Security

Exaix is built with a "Safety First" architecture, focusing on local execution and explicit permissions.

### 9.1 Key Security Features

- **Sandboxing:** File system access is strictly scoped to your Workspace and configured Portals. Path traversal attempts are blocked.
- **API Keys:** Keys are loaded from environment variables (`ANTHROPIC_API_KEY`, etc.) and never stored in the database or logs.
- **Human-in-the-Loop:** Critical actions (plan approval, file writes via generic agents) require explicit human confirmation unless configured otherwise.
- **Git Safety:** Automated commits are signed with detailed trace IDs.

### 9.2 Best Practices

1. **Review Plans:** Always inspect the diffs in the TUI (`exactl plan show`) before approving.

1.

---

## 10. Daemon Management & Monitoring

Exaix can run as a background daemon to serve the MCP API, run scheduled tasks, and monitor workspace health.

### 10.1 Daemon Control

Use the `exactl daemon` command to manage the background service:

```bash
# Start the daemon
exactl daemon start

# Check status (PID, uptime, version)
exactl daemon status

# View live logs
exactl daemon logs -f

# Stop the daemon (sends SIGTERM for graceful shutdown)
exactl daemon stop
```

> [!TIP]
> **Graceful Shutdown:** The daemon handles shutdown signals to ensure critical operations (like database writes or git commits) complete before exiting.

### 10.2 Health Checks

The daemon exposes health endpoints and performs self-monitoring. checking:

- **Database Connectivity**: Verifies SQLite WAL mode and query response.
- **Disk Space**: Monitoring `warn` and `critical` thresholds.
- **Memory Usage**: Tracks heap usage to prevent OOM errors.

```bash
# Perform an ad-hoc health check
exactl health check
```

### 10.3 Activity Journal

The Activity Journal provides a permanent, searchable audit trail of all agent actions, system events, and errors. It is stored locally in `journal.db` and is essential for debugging, compliance, and understanding system behavior.

**Usage:**

```bash
exactl journal [options]
```

**Core Options:**

| Option                                   | Description                                     | Default |
| ---------------------------------------- | ----------------------------------------------- | ------- |
| `--tail <n>`, `-n <n>`                   | Show the last N entries                         | 50      |
| `--filter <key=value>`, `-f <key=value>` | Filter by criteria (can be used multiple times) | None    |
| `--format <format>`                      | Output format: `text`, `table`, `json`          | `text`  |
| `--distinct <field>`                     | Return distinct values for specified field      | None    |
| `--count`                                | Return count aggregation by action_type         | false   |
| `--payload <pattern>`                    | Filter by payload LIKE pattern                  | None    |
| `--actor <actor>`                        | Filter by actor                                 | None    |
| `--target <target>`                      | Filter by target                                | None    |

**Filter Keys:**

- `trace_id`: Filter by specific operation UUID (e.g., `trace_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- `action_type`: Filter by event type (e.g., `action_type=request.created`, supports wildcards like `action_type=plan.%`)
- `agent_id`: Filter by agent name (e.g., `agent_id=security-auditor`)
- `since`: Filter by time (e.g., `since=2024-01-01`, `since=2024-01-01T10:00:00`)

#### Basic Usage Examples

```bash
# View recent system activity (last 50 entries)
exactl journal

# Show only the last 10 entries
exactl journal --tail 10

# Output in JSON format for scripting
exactl journal --format json

# Display in table format for better readability
exactl journal --format table
```

#### Filtering by Trace ID

```bash
# Investigate a specific request's complete lifecycle
exactl journal --filter trace_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Get the trace ID from a recent request and investigate
TRACE_ID=$(exactl journal --tail 1 --format json | jq -r '.[0].trace_id')
exactl journal --filter trace_id=$TRACE_ID
```

#### Filtering by Action Type

```bash
# Show only request creation events
exactl journal --filter action_type=request.created

# Show all plan-related events (using wildcard)
exactl journal --filter action_type=plan.%

# Show all errors
exactl journal --filter action_type=error

# Show blueprint operations
exactl journal --filter action_type=blueprint.%
```

#### Filtering by Agent

```bash
# Show activity for a specific agent
exactl journal --filter agent_id=security-auditor

# Show activity for mock agents (using wildcard)
exactl journal --filter agent_id=mock-%
```

#### Time-Based Filtering

```bash
# Show activity since a specific date
exactl journal --filter since=2024-01-01

# Show activity since a specific datetime
exactl journal --filter since=2024-01-01T10:00:00

# Show recent activity (last hour)
exactl journal --filter since=$(date -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
```

#### Payload Pattern Matching

```bash
# Search for activities containing specific text in payload
exactl journal --payload %security%

# Check for potential credential leaks
exactl journal --payload %password%
exactl journal --payload %api_key%
exactl journal --payload %secret%

# Find token usage information
exactl journal --payload %tokens%

# Search for cost-related activities
exactl journal --payload %cost%
```

#### Aggregation and Analysis

```bash
# Count total activities by action type
exactl journal --count

# Get distinct list of all agents that have performed actions
exactl journal --distinct agent_id

# Get distinct list of all action types
exactl journal --distinct action_type

# Get distinct actors (users who performed actions)
exactl journal --distinct actor
```

#### Advanced Multi-Filter Queries

```bash
# Combine multiple filters: errors from specific agent since date
exactl journal --filter action_type=error --filter agent_id=security-auditor --filter since=2024-01-01

# Find all failed actions for a specific trace
exactl journal --filter trace_id=$TRACE_ID --filter action_type=action.failed

# Security audit: check for dangerous commands executed
exactl journal --filter action_type=action.executing --payload %rm% --payload %sudo%

# Performance analysis: find slow operations
exactl journal --payload %timeout% --payload %error%
```

#### Real-World Use Cases

**Debugging Failed Requests:**

```bash
# Find the trace ID of a failed request
FAILED_TRACE=$(exactl journal --filter action_type=request.failed --tail 1 --format json | jq -r '.[0].trace_id')

# Investigate the complete failure chain
exactl journal --filter trace_id=$FAILED_TRACE
```

**Security Auditing:**

```bash
# Check for unauthorized file access attempts
exactl journal --payload %permission%denied% --payload %access%denied%

# Audit all portal access
exactl journal --filter action_type=portal.% --tail 100

# Check for sensitive data in logs
exactl journal --payload %password% --payload %key% --payload %secret% | wc -l
```

**Performance Monitoring:**

```bash
# Count requests by agent over time
exactl journal --filter action_type=request.created --distinct agent_id

# Find most active time periods
exactl journal --count --filter since=$(date -d '7 days ago' +%Y-%m-%d)

# Monitor token usage trends
exactl journal --payload %tokens% --tail 100 --format json | jq '.[] | .payload.tokens.total // 0' | paste -sd+ | bc
```

**Compliance and Reporting:**

```bash
# Export all activities for a specific month to JSON
exactl journal --filter since=2024-01-01 --filter since=2024-02-01 --format json > january_activities.json

# Generate audit report for specific agent
exactl journal --filter agent_id=production-agent --format json > production_audit.json

# Count human approvals vs automated actions
exactl journal --filter action_type=plan.approved --count
```

#### Power User: Direct SQL Access

For advanced analysis, you can query the SQLite database directly:

```bash
# View the database schema
sqlite3 ~/Exaix/.exa/journal.db ".schema activity"

# Complex queries not available via CLI
sqlite3 ~/Exaix/.exa/journal.db "
  SELECT action_type, COUNT(*) as count,
         MIN(timestamp) as first_seen,
         MAX(timestamp) as last_seen
  FROM activity
  WHERE timestamp >= '2024-01-01'
  GROUP BY action_type
  ORDER BY count DESC;
"

# Find requests with the most steps
sqlite3 ~/Exaix/.exa/journal.db "
  SELECT trace_id, COUNT(*) as steps
  FROM activity
  WHERE action_type LIKE 'step.%'
  GROUP BY trace_id
  ORDER BY steps DESC
  LIMIT 10;
"
```

**Database Maintenance:**

```bash
# Check database integrity
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"

# Vacuum database to reclaim space
sqlite3 ~/Exaix/.exa/journal.db "VACUUM;"

# Backup journal before maintenance
cp ~/Exaix/.exa/journal.db ~/backups/journal_$(date +%Y%m%d).db
```

## 11. Cost Tracking (Beta)

Exaix provides comprehensive cost tracking and budget management for AI provider usage. This feature helps you monitor spending, set limits, and optimize your AI usage costs.

### 11.1 How Cost Tracking Works

Cost tracking operates at multiple levels:

1. **Per-Request Tracking**: Each agent execution logs token usage and estimated cost

1.
1.

### 11.2 Configuration

Configure cost tracking in your `exa.config.toml`:

```toml
[cost_tracking]
enabled = true
max_daily_cost_usd = 50.0  # Daily spending limit

[cost_tracking.rates]
# Override default rates if needed
anthropic_claude_sonnet = 0.000015  # $15 per million tokens
openai_gpt4 = 0.00003               # $30 per million tokens
```

Prompt-window enforcement is configured separately through the Phase 62
`[budget_enforcement]` section. This controls whether Exaix applies strict
prompt-budget caps before execution; it does not replace monetary cost limits.

```toml
[budget_enforcement]
cloud = true   # Enforce strict section budgets for hosted providers
local = false  # Leave local/self-hosted models in relaxed mode by default
```

When enabled, Exaix derives section budgets for `system`, `plan`,
`portalKnowledge`, `memory`, `skills`, and `loopHistory` before assembling the
final prompt.

### 11.3 Budget Enforcement

Before each agent execution, Exaix checks:

1. **Daily Budget**: Current day's spending vs `max_daily_cost_usd`

1.

If a request would exceed your budget, it's rejected with a clear error message.

### 11.4 Monitoring Usage

Query cost information through the Activity Journal:

```bash
# View recent cost-related activities
exactl journal --payload %cost% --tail 10

# Find high-cost operations
exactl journal --payload %tokens% --tail 20 --format json | jq '.[] | select(.payload.cost > 1.0)'

# Daily cost summary (requires external processing)
exactl journal --filter since=$(date +%Y-%m-%d) --payload %cost% --format json > daily_costs.json
```

### 11.5 Cost Optimization Tips

- **Use Appropriate Models**: Smaller models for simple tasks, larger models for complex reasoning
- **Set Realistic Budgets**: Start with conservative limits and adjust based on usage
- **Monitor Regularly**: Use journal queries to identify expensive operations
- **Batch Requests**: Combine related tasks to reduce overhead
- **Cache Results**: Memory banks help avoid redundant work

### 11.6 Supported Providers

Cost tracking supports all major AI providers:

| Provider  | Token Tracking | Cost Estimation | Budget Enforcement |
| --------- | -------------- | --------------- | ------------------ |
| Anthropic | ✅             | ✅              | ✅                 |
| OpenAI    | ✅             | ✅              | ✅                 |
| Google    | ✅             | ✅              | ✅                 |
| Ollama    | ✅             | ❌ (free)       | ❌                 |
| Mock      | ✅             | ❌              | ❌                 |

## 12. Safety Gates & Plan Amendments

The **Plan Amendment Safety Gate** is a human-in-the-loop safeguard that allows the Exaix agent to propose structural changes to an execution plan mid-mission.

### 12.1 When Amendments Trigger

An amendment is automatically proposed by the agent when:

- **Environmental Drift**: The workspace environment changed since the plan was created.
- **Tool Failures**: A critical tool fails in a way that makes downstream steps impossible.
- **Low Confidence**: The agent's reasoning confidence falls below the configured threshold.

### 12.2 The Amendment Workflow

1. **Pause**: Execution is immediately paused. A checkpoint is saved.
2. **Proposal**: The agent generates a "Plan Amendment Patch" with a summary of changes.
3. **Wait**: The plan status becomes `amendment_pending`.
4. **Human Review**: Use CLI commands to review and decide:
   - `exactl plan amendment show` to see the proposed diff.
   - `exactl plan amendment approve` to apply and resume.
   - `exactl plan amendment reject` to abort the plan.

### 12.3 Configuration

Configure the safety gate in `exa.config.toml`:

```toml
[amendment]
enabled = true             # Enable the safety gate (default: false)
threshold = 60            # Confidence threshold (0-100) (default: 60)
expiry_ms = 86400000       # How long an amendment can stay pending (default: 24h)
```

---

### End of User Guide
