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
2. **Reference Specific Files:** Use absolute paths or workspace-relative paths (e.g., `packages/storage-sqlite/src/database_service.ts`). This allows the analyzer to verify the context exists.
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

**Curated model lists per size (the curated model registry, Solo).** When a request specifies a `--model-size`
(S/M/L/XL) rather than a named model, the resolver picks a provider for that size. You can
curate a **preferred list** per size so your favourite providers win before any scoring:

```toml
[model_presets.M]
max_cost_per_mtok = 3
min_context_window = 32000
supports_thinking = true
# Try these providers first, in order, for a size-M request (reason: preferred_list).
candidates = ["anthropic", "ollama"]

# Optional intra-list reorder hints for a given --characteristic.
[model_presets.M.characteristics]
cheapest = ["ollama"]
```

- Entries are **provider names** (e.g. `anthropic`), not `provider:model` pairs — the resolver
  picks the model for that provider.
- A **local or free** provider (Ollama, or any provider whose endpoint is genuinely $0) is
  **exempt from cost filtering**, so it can win even under a tight budget. An unknown-priced
  model is never treated as "cheapest" — only a genuinely known price qualifies.
- Curate these lists from the CLI instead of editing TOML by hand — see
  [`exactl config model` and `exactl models`](#exactl-config-model--exactl-models--solo-model-curation-the-curated-model-registry).
- **Editions:** the Solo floor is a static, offline catalog. A live, always-current catalog and
  stricter routing rigor arrive with the Team edition (the Team edition model registry); Solo behaviour is unchanged
  when no Team module is present. For the full precedence chain, characteristic scoring
  (including Team's benchmark-driven `best`), the live catalog, multi-route pricing, and
  cost-accuracy semantics, see **[`docs/Model_Resolution.md`](Model_Resolution.md)**.

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

Sign up at [openrouter.ai](https://openrouter.ai) and create an API key. See the [OpenRouter docs](https://openrouter.ai/docs) for available models and rate limits.

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

#### 2.4.5 Provider Strategy

Exaix's provider strategy system enables intelligent, configuration-driven provider selection based on cost, performance, health, and task requirements. Configured in `exa.config.toml` under `[provider_strategy]`:

```toml
[provider_strategy]
prefer_free = true          # prefer free/local providers when possible
allow_local = true          # allow Ollama and other local providers
max_daily_cost_usd = 5.00   # cap total daily spend across all providers
health_check_enabled = true # skip unhealthy providers
fallback_enabled = true     # try fallback chain on failure
```

**Task routing** directs work to the most suitable provider by task type:

```toml
[provider_strategy.task_routing]
simple = ["small"]     # fast, cheap models
complex = ["large"]    # best available models
code_review = ["large"]
```

The model names (`small`, `medium`, `large`) reference preset blocks defined in the `[models]` section. See `templates/exa.config.sample.toml` for the full set of available options, including budgets, fallback chains, and per-provider metadata overrides.

#### 2.4.6 Subscription-Billed CLI Providers (codex-cli)

Exaix can also drive certain agentic CLI tools you already have installed, billed against
their own subscription instead of a metered per-token API key. Currently documented here:
**codex-cli** (`provider = "codex-cli"`), which spawns a headless `codex exec --json`
subprocess. `claude-cli` and `opencode-cli` are the same kind of provider (driving
`claude`/`opencode` subprocesses respectively) but are not yet documented in this guide — a
pre-existing gap outside this section's scope, not an indication they work differently.

**Prerequisites:**

1. Install the [Codex CLI](https://developers.openai.com/codex/noninteractive) and
   authenticate once with your ChatGPT Codex subscription:

   ```bash
   codex login
   ```

   This persists your session to `~/.codex/auth.json`; no API key is required or used.

2. Point a model at the `codex-cli` provider:

   ```toml
   [models.codex]
   provider = "codex-cli"
   model = "gpt-5.6-terra"
   ```

**What to expect:**

- `cost_usd` always reports `0` for `codex-cli` calls — the ChatGPT Codex subscription bills
  flat-rate, not per-token, so there is no metered cost to track.
- A stray `OPENAI_API_KEY` or `CODEX_API_KEY` already present in your shell environment is
  never forwarded to the spawned `codex` subprocess — your subscription login always wins
  over an environment-provided metered key.
- Every call runs with `--sandbox read-only`, so `codex-cli` calls never write to your
  filesystem — the same read-only posture Exaix already enforces for headless CLI-delegate
  planning calls.

`[session_delegate] tool = "codex"` (Mode 3 headless session delegation) is a **separate**
Codex integration path with its own sandbox model — see
[§2.5.7](#257-codex-sandbox-and-permitted-path-security). This subsection covers only the
ReAct-loop analysis/planning provider above.

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

### 2.5 Session Delegation Configuration

Exaix can delegate specific pipeline gates to external CLI agent tools (OpenCode, Claude
Code, Codex) instead of using the built-in LLM. This is useful when you want
human-in-the-loop review or want to use a specialized tool for specific tasks.

#### 2.5.1 Configuration

Add a `[session_delegate]` section to your `exa.config.toml`:

```toml
[session_delegate]
enabled = true
tool = "opencode"              # claude-code | opencode | codex | cursor | vscode
gates = ["refinement", "plan_review"]   # which gates to delegate
launch_mode = "headless"       # advisory (Mode 1) | supervised (Mode 2) | headless (Mode 3)
```

#### 2.5.2 Prerequisites

The delegate tools must be installed separately:

| Tool            | Installation                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenCode**    | [opencode.ai](https://opencode.ai) — CLI installer and setup guide                                                                                  |
| **Claude Code** | [docs.anthropic.com/en/docs/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview) — requires Claude Pro/Max subscription            |
| **Codex**       | [developers.openai.com/codex](https://developers.openai.com/codex/noninteractive) — requires `codex login` (ChatGPT Codex subscription; no API key) |
| **OpenRouter**  | See [§2.4.4](#244-enterprise-providers-vertex-ai-openrouter) — API key from [openrouter.ai](https://openrouter.ai)                                  |

#### 2.5.3 Launch Modes

| Mode       | Value        | Description                                                                |
| ---------- | ------------ | -------------------------------------------------------------------------- |
| **Mode 1** | `advisory`   | Prints the command; human runs the tool out-of-band                        |
| **Mode 2** | `supervised` | Interactive TTY spawn from `exactl execute --delegate`                     |
| **Mode 3** | `headless`   | Non-interactive spawn; daemon captures stdout and reconciles automatically |

Mode 3 (headless) supports `claude-code`, `opencode`, and `codex`. For tools that don't
write `return.json` natively (`opencode run --format json`, `codex exec --json`), the
daemon captures their JSON event stream from stdout and synthesizes a valid `return.json`.
**Codex's tested, intended mode is headless (Mode 3)** — Mode 2 (`supervised`) launch
throws (`resolveLaunch()` rejects it); see [§2.5.7](#257-codex-sandbox-and-permitted-path-security).

#### 2.5.4 Per-Request Override via Environment Variables

For CI and testing, use environment variables instead of TOML config:

```bash
export EXA_SESSION_DELEGATE_ENABLED=true
export EXA_SESSION_DELEGATE_TOOL=opencode
export EXA_SESSION_DELEGATE_GATES=refinement,plan_review
export EXA_SESSION_DELEGATE_BIN_OVERRIDES=/path/to/custom/binary
```

Default gates when `EXA_SESSION_DELEGATE_ENABLED=true`: `refinement`, `plan_review`.
`code_changes` requires explicit opt-in via `EXA_SESSION_DELEGATE_GATES`.

#### 2.5.5 Gate Effects

| Gate           | What happens when delegated                                        |
| -------------- | ------------------------------------------------------------------ |
| `refinement`   | Request quality gate delegates to CLI tool instead of LLM Q&A loop |
| `plan_review`  | Plan approval delegates to CLI tool (requires handler wiring)      |
| `code_changes` | Plan step execution delegates to CLI tool instead of AgentExecutor |
| `review`       | Code review delegates to CLI tool (requires handler wiring)        |

#### 2.5.6 Mock Binary for Testing

```bash
deno task build:mock-tool   # compiles .cache/mock_session_tool_bin
```

The mock binary reads `--brief <path>` and writes a schema-valid `return.json`.
Add it to `bin_overrides` for CI scenarios:

```toml
bin_overrides = ["/path/to/.cache/mock_session_tool_bin"]
```

#### 2.5.7 Codex Sandbox and Permitted-Path Security

`codex`'s tested, intended integration path is Mode 3 (headless) — `BuiltinSessionAdapter`
registers it without Mode 2 (`supervised`) support (`resolveLaunch()` throws), unlike
`claude-code`/`opencode`. It
reuses the same `codex login` subscription credential as
[§2.4.6](#246-subscription-billed-cli-providers-codex-cli); there is no separate auth step
for session delegation.

Codex enforces scope through two independent, layered mechanisms:

1. **Sandbox (enforced by the `codex` CLI itself, during the run).** With
   `harden_permissions = true`, the daemon derives `--sandbox workspace-write` when the
   delegated gate is `code_changes`, or `--sandbox read-only` for every other gate — see
   `deriveCodexSandboxFlags` (`@exaix/session`). `workspace-write` confines all writes to
   the worktree root; a write to an absolute path outside it (e.g. `/tmp/...`) never
   reaches disk, regardless of what the model attempted.
2. **`permitted_paths` (enforced by Exaix, after the run).** Being inside the worktree is
   not sufficient on its own: `SessionReturnWatcher`/`reconcile` also check every path the
   delegate actually touched (via `git diff --name-only`) against the worktree-relative
   globs in `permitted_paths`. A touched path outside those globs — even one safely inside
   the sandboxed worktree — is rejected as `session.delegate.scope_violation`, and
   `session.delegate.reconciled` is never journaled for that request (the durable wait is
   never resumed).

```toml
[session_delegate]
enabled = true
tool = "codex"
model = "codex-cli:gpt-5.6-terra"   # provider:model form; a bare model id is rejected
gates = ["code_changes"]
launch_mode = "headless"
permitted_paths = ["src/**", "tests/**"]
harden_permissions = true
```

### 2.5a Per-Step CLI Delegate Execution — the Cost-Preferred Path for Live/Eval Runs

`[cli_delegate]` is a **different, narrower** mechanism than `[session_delegate]` above: it
selects a single per-step execution strategy (`CliDelegateStrategy`) rather than delegating a
whole pipeline gate. Where `ReActLoopStrategy` calls the configured `IModelProvider` directly
(Anthropic/OpenAI/Google API — metered, per-token billing), `CliDelegateStrategy` drives the
same headless `claude`/`opencode` CLI you already use interactively, authenticating the same
way that CLI does by default: against a **Claude Pro/Max (or equivalent) subscription**, not
the API.

> [!TIP]
> **Use `[cli_delegate]` for repeated live evaluation and manual/nightly `swe_tasks` runs.**
> If you already pay for a Claude Code subscription, every headless call it drives is covered
> by that flat monthly rate instead of adding to metered API spend — the same work, at no
> marginal per-run cost. This is the preferred configuration for `exactl eval run` against
> live provider cells (see `tests/scenario_framework/README.md`).

#### 2.5a.1 Configuration

Add a `[cli_delegate]` section, and grant the identity's blueprint the matching capability tag:

```toml
[cli_delegate]
enabled = true
tool = "claude-code"          # claude-code | opencode
model = "claude-sonnet-5"     # optional; tool default when absent
```

```yaml
# Blueprints/Identities/<identity>.md frontmatter
capabilities: ["code_generation", "cli_delegate"]
```

`AgentOrchestrator` only registers `CliDelegateStrategy` when `[cli_delegate].enabled = true`,
and only dispatches a step to it when the executing identity's `capabilities` includes
`"cli_delegate"` — both conditions must hold. A step whose identity lacks the tag still runs
through whichever strategy its own capabilities select (`react`/`mcp`/legacy), even with
`[cli_delegate]` enabled globally.

#### 2.5a.2 Auth — making sure the subscription is actually used

Claude Code's own auth precedence always prefers an `ANTHROPIC_API_KEY` (or
`ANTHROPIC_AUTH_TOKEN`) present in the environment over a subscription login, even when
both exist. `CliDelegateStrategy` handles this for you: it strips both variables from the
spawned CLI's environment on every call, so your subscription login is used regardless of
whether the daemon's own environment carries an API key for its other, direct-API calls.

For a daemon or CI environment where an interactive `claude login` session isn't practical,
generate a long-lived subscription-backed token instead:

```bash
claude setup-token   # opens a one-time browser approval, prints a 1-year OAuth token
export CLAUDE_CODE_OAUTH_TOKEN=<token>
```

This is the credential Claude Code's own docs recommend for headless/CI environments — it
authenticates against your subscription and does not expire the way an interactive terminal
login's warning-then-lockout cycle does.

#### 2.5a.3 Prerequisites and multi-turn behavior

Same tool installs as [§2.5.2](#252-prerequisites) (`claude` or `opencode` on `PATH`). Each
plan step is a fresh, cold-spawned CLI call that resumes the prior step's conversation via a
captured session id (`claude -p <objective> --resume <session_id>` /
`opencode run --session <session_id>`) — so a multi-step plan reads as one continuous
session to the CLI, not N unrelated calls. The first turn of each plan includes the whole
plan's text so the CLI orients on the complete task; later turns send only the current step.

#### 2.5a.4 Known limitation

A plan that executes inside a git worktree (`PortalExecutionStrategy.WORKTREE`, forced
whenever the plan targets a real `portal`) commits `CliDelegateStrategy`'s changes inside
that worktree checkout. Merging the worktree branch back into the portal's own working tree
is not yet automatic — verify a `cli_delegate` run's actual file changes against the worktree
under `.exa/worktrees/<portal>/<trace_id>/` if the mounted portal doesn't show them. Track
status in `exaix-dev-docs/planning/phase-140-evaluation-framework-maturation.md`
(`Ledger:CLI_DELEGATE_WORKTREE_MERGE`).

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
├── Tasks/              # Active and historical tasks
│   ├── active/         # Currently executing (symlinks to Workspace/Active/)
│   ├── completed/      # Successfully completed tasks
│   └── failed/         # Failed tasks with error analysis
└── Index/              # Search indices (generated)
    ├── files.json
    ├── patterns.json
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
- **Embedding Search**: Semantic similarity search via embedding service
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

#### Skill Tools

A skill can optionally declare a `tools:` list — the MCP tools its own procedure calls for (e.g. `read_file`, `write_file`, `git_commit`). When one or more skills are matched onto a request, their `tools:` lists are combined into a single set (a matched-only tool is added once even if two skills both name it). That combined set is then narrowed to whatever the identity's own `permitted_tools` allowlist already permits — a skill can only restrict which of the identity's tools are shown, never add a tool the identity isn't already allowed to use. If no matched skill declares `tools:`, the identity's `permitted_tools` (or the full registered tool set, if the identity has no allowlist) is used unchanged.

This keeps prompts focused: an identity broadly permitted to use many tools only sees the ones relevant to the skills actually driving a given request, without an author having to hand-tune `permitted_tools` per request.

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

For complete keyboard shortcuts, see [TUI Keyboard Reference](TUI_Keyboard_Reference.md).

For technical details, see the [Implementation Plan](../exaix-dev-docs/planning/phase-09-ux-improvement.md#step-93-tui-cockpit-implementation-plan).

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

See the [Implementation Plan](../exaix-dev-docs/planning/phase-09-ux-improvement.md#step-93-tui-cockpit-implementation-plan) for technical details and roadmap.

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

| Option                  | Short | Description                                                                                                                 |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `--agent`               | `-a`  | Target identity blueprint (default: `default`, mutually exclusive with --flow)                                              |
| `--flow`                |       | Target multi-agent flow (mutually exclusive with --agent)                                                                   |
| `--priority`            | `-p`  | Priority: `low`, `normal`, `high`, `critical`                                                                               |
| `--portal`              |       | Portal alias for project context                                                                                            |
| `--target-branch`       |       | Target/base branch when working inside a portal (stored as `target_branch`)                                                 |
| `--skills`              |       | Comma-separated list of skills to inject (e.g., `documentation-driven,file-ops`)                                            |
| `--file`                | `-f`  | Read description from file                                                                                                  |
| `--acceptance-criteria` |       | Repeatable acceptance criterion; stored in frontmatter as `acceptance_criteria`                                             |
| `--expected-outcome`    |       | Repeatable expected outcome; stored in frontmatter as `expected_outcomes`                                                   |
| `--interactive`         | `-i`  | Interactive mode with prompts                                                                                               |
| `--dry-run`             |       | Preview without creating                                                                                                    |
| `--json`                |       | Machine-readable output                                                                                                     |
| `--analyze`             |       | Trigger immediate intent analysis                                                                                           |
| `--engine`              | `-e`  | Analysis engine: `heuristic` (default), `llm`                                                                               |
| `--model-size`          |       | Capability tier: `S`, `M`, `L`, `XL` — maps to context/cost preset via ModelResolver (model resolution and intent)          |
| `--thinking`            |       | Require extended reasoning (thinking-capable model, model resolution and intent)                                            |
| `--effort`              |       | Reasoning token budget: `low`, `medium`, `high` (only with `--thinking`, model resolution and intent)                       |
| `--characteristic`      |       | Soft ranking hint — `cheapest` or `fastest`. Scores providers, does not eliminate. Repeatable (model resolution and intent) |
| `--preferred-provider`  |       | Narrow candidate pool to a specific provider, skips cross-provider scoring (model resolution and intent)                    |

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

**Model intent examples (model resolution and intent):**

```bash
# Large model with extended reasoning for complex tasks
exactl request "Design authentication architecture" --model-size L --thinking --effort high

# Quick, cheap task — small model, no thinking
exactl request "Format all files" --model-size S --characteristic cheapest

# Balanced: medium model, some reasoning, speed priority
exactl request "Refactor utils module" --model-size M --thinking --effort low --characteristic fastest

# Pin to a specific provider but let ModelResolver pick the model
exactl request "Audit dependencies" --model-size XL --preferred-provider anthropic
```

**Resolution precedence (Solo, the curated model registry).** For a `--model-size` request the resolver tries, in order:

1. An explicit `provider:model` (e.g. `--model anthropic:claude-opus-4.5`) — passed through as-is
   (`explicit_override`). Solo does not validate the model name against a catalog, so a typo
   surfaces as a provider error at call time.
2. A **curated list** for the size (`model_presets.<SIZE>.candidates`) — the first healthy,
   registered provider wins (`preferred_list`).
3. Capability/cost **scoring** across registered providers (`preset_default` /
   `characteristics_scored`), with local/free providers exempt from budget filtering.

(Team adds catalog validation for step 1, benchmark-driven `best` ranking and a usage
tiebreak to step 3, and a multi-route pricing decision on top of any winner — see
[`docs/Model_Resolution.md`](Model_Resolution.md) for the full picture.)

The chosen provider, model, and the reason are journalled as `model.resolved`. Inspect them with:

```bash
exactl logs --filter action_type=model.resolved --format json
```

##### `exactl config model` & `exactl models` — Solo model curation (the curated model registry)

Curate the per-size preferred lists and inspect the Solo model floor without editing TOML by hand.
Curated lists are written back to `exa.config.toml` (`model_presets.<SIZE>.candidates`) — the same
surface the resolver reads — so there is no separate database.

```bash
# Inspect the Solo model floor: provider:model, pricing provenance, and staleness
exactl models list
exactl models pricing

# Curate the preferred providers for size M (order matters — first healthy provider wins)
exactl config model --size M anthropic ollama

# Add a characteristic reorder hint (promotes ollama when --characteristic cheapest is used)
exactl config model --size M --characteristic cheapest ollama

# Show the current curated lists (unregistered providers are flagged "unconfigured")
exactl config model --list

# Clear a size's curated list (falls back to scoring)
exactl config model --size M --clear
```

Notes:

- Entries are **provider names**, not `provider:model` pairs. An ambiguous bare name that matches a
  model owned by more than one provider is rejected with the qualifying options; an unknown
  provider is stored but flagged `unconfigured` (a pre-curation allowance).
- Pricing **provenance** is shown as `static` (a known, dated price) or `unknown`. A price older
  than 90 days is marked `(stale)`. The Solo floor is offline — there is **no `models refresh`**;
  a live, auto-refreshed catalog arrives with the Team edition (the Team edition model registry).

##### Team: live model catalog (the Team edition model registry)

Enable a self-updating model catalog with the `[model_registry]` config block. Top-level keys
must come before any `[model_registry.*]` sub-table (standard TOML ordering):

```toml
[model_registry]
enabled = true                       # off by default — false/absent is byte-identical to Solo
refresh_on_start = false             # true = one immediate refresh at daemon boot
catalog_refresh_cron = "0 */6 * * *" # how often the catalog is checked (default: every 6h)
pricing_refresh_cron = "0 3 * * *"   # how often prices are checked (default: daily)
route_policy = "cheapest"            # cheapest | reliability | native_first | user_order
route_policy_price_tolerance = 0.05  # 5% near-tie band under "cheapest"
usage_tiebreak = false               # opt-in: break no-characteristics ties by usage history
cost_divergence_tolerance_pct = 5    # flag a reported-vs-computed cost mismatch beyond this

[model_registry.admission]
keep_native_whole = true   # keep your main providers' full catalogs (not just curated entries)
top_n = 25                 # for large marketplace catalogs (e.g. OpenRouter): admit only the top N benchmarked models

[model_registry.route_order]
# only read when route_policy = "user_order" — explicit per-model provider order
"claude-opus-4.5" = ["anthropic", "openrouter"]

[model_registry.benchmark_source]
enabled = true                       # on by default once model_registry.enabled = true
tracked_benchmarks = ["swe_bench_verified", "swe_bench_pro", "gpqa"]

[model_registry.benchmark_map]
# which tracked benchmark(s) inform the "best" characteristic for each kind of task
feature = ["swe_bench_verified", "swe_bench_pro"]
```

With the catalog enabled, `exactl config model` validates an explicit entry against the live
catalog (and auto-admits a real-but-unused model on first use, instead of Solo's pass-through),
and two more commands become available:

```bash
# Trigger/inspect the live refresh cycle
exactl models refresh

# Append an advisory benchmark-score column to the model list
exactl models list --benchmark swe_bench_verified
```

See [`docs/Model_Resolution.md`](Model_Resolution.md) for the full explanation of what each
setting does — curation, characteristics (including the benchmark-driven `best`), the live
catalog, multi-route pricing, and cost accuracy.

> **Data license note (Team benchmark ingest):** `model_registry.benchmark_source` pulls
> community-maintained scores from [models.dev](https://models.dev/), which is MIT-licensed —
> confirmed safe to ingest and redistribute as advisory scoring data.

See the **Model Registry** row of the edition comparison table in
[`docs/Reference_Data.md`](Reference_Data.md#edition-model--component-availability) for how
this fits into the overall Solo / Team / Enterprise split.

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

> **⚠️ IMPLEMENTATION STATUS:** Plan approval moves plans to `Workspace/Active/` where they are detected and parsed (Steps 5.12.1-5.12.2 ✅). Automatic agent-driven execution (Steps 5.12.3-5.12.6) is in development. In the agent-driven model, LLM agents will have direct portal access through scoped tools (read_file, write_file, git_create_branch, git_commit) and will create reviews themselves. See [ARCHITECTURE.md](../ARCHITECTURE.md#plan-execution-flow) for details.

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

##### Execution Anomaly Surfacing

When you run `exactl review list`, reviews whose execution trace contains
anomaly-relevant events display a severity badge:

```text
⚠️ 1 anomaly (0 high, 1 medium, 0 low)
```

The badge appears only when there are live anomalies (high + medium + low > 0).
If all detected failures were later recovered by a successful retry on the same
target, the badge is suppressed entirely — only actionable signal is surfaced
at the list level.

**Severity meanings:**

| Severity   | Meaning                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| **high**   | Security violations, permission denials, execution failures, plan execution failures          |
| **medium** | Tool call failures, step failures, LLM call failures, validation failures, git audit failures |
| **low**    | Timeout warnings, context compaction events                                                   |

When you run `exactl review show`, an "Execution anomalies" section lists each
individual finding with its severity, target, and event type:

```text
📋 Review: implement-auth

...
Execution anomalies:
  medium  build-step  (execution.action_failed)
```

A recovered failure is annotated with `recovered: true`:

```text
medium  build-step  (execution.action_failed, recovered: true)
```

Recovered findings are excluded from the high/medium/low badge counts and are
instead summarized as a `(+N recovered)` tail on the badge when it is shown.
If all anomalies in a trace are recovered, the badge is hidden entirely — only
actionable signal is surfaced at the list level.

**How it works:** The system reads the Activity Journal (the same underlying
data that tracks execution progress) and projects a read-time classification of
anomaly-relevant event types. No separate detection, LLM call, or write path is
involved — events the system already emits are simply surfaced.

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
2. Generates context card: `~/Exaix/Portals/<alias>.md`
3. Updates `exa.config.toml` with portal configuration (optional per-portal keys: `default_branch` and `execution_strategy`)
4. Validates Deno permissions for new path
5. Restarts daemon if running (or prompts for manual restart)
6. Logs action to Activity Journal

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

# Clone an existing identity as a prototype (faster setup)
exactl blueprint create my-coder --name "My Coder" --from senior-coder
exactl blueprint create my-reviewer --name "My Reviewer" --from code-analyst
exactl blueprint create test-agent --name "Test Agent" --from mock-agent

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

#### Flow Step Execution Strategy

A flow step's YAML may declare an optional `strategy` field that routes the step through
Exaix's agent strategy registry instead of the default single-shot generate path:

```yaml
steps:
  - id: implement-feature
    name: Implement Feature
    identity: senior-coder
    execution_mode: declared # strategy is only valid on a declared step
    strategy: cli_delegate # react | mcp | cli_delegate
    dependsOn: [design-architecture]
    input:
      source: step
      stepId: design-architecture
      transform: mergeAsContext
```

**Allowed values:**

| Value          | What it does                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ |
| _(unset)_      | Default. The step generates once via the daemon's direct-generate path — no live tool access.    |
| `react`        | Runs the daemon's own ReAct loop against the step's portal — the daemon keeps execution control. |
| `mcp`          | Routes through the MCP tool-execution path.                                                      |
| `cli_delegate` | Delegates the step to a headless CLI subprocess (`opencode`/`claude`) running its own session.   |

**DECLARED-only rule:** `strategy` may only be set on a step whose `execution_mode` is
`declared` (the default when `execution_mode` is omitted). Setting it on a `dynamic` step is a
validation error — a dynamic step already selects its own tools at runtime, so a forced
strategy is redundant.

**Choosing a strategy — the control-axis tradeoff:** `react` and `cli_delegate` are not a
"faster vs. slower" choice — they trade off _who_ keeps execution control. `react` keeps the
daemon in the loop (its own context compaction, tool-result formatting, and audit trail apply
uniformly), while `cli_delegate` hands the whole task to the external CLI's own internal loop
(useful when you want that tool's own workflow — e.g. its own test-running or file-editing
conventions — rather than the daemon's). Neither is cheaper by default: measure the actual
prompt tokens, wall-clock time, and cost for your own task rather than assuming one is
always cheaper. Most flow steps need neither — a step that only synthesizes or aggregates
already-provided context does not need live tool access at all, so the default (unset) is the
right choice for most steps; opt a step into `react` or `cli_delegate` only when its task
genuinely needs to read the live repository or produce real file changes.

`feature-development.flow.yaml` ships with `strategy: "cli_delegate"` on all 6 of its steps as
a worked example of this rollout, chosen to match its own direct-execution comparison baseline
(see `exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`'s `feature-development`
decision).

#### Flow Step Execution Modes

A flow step declares how it executes via `execution_mode`:

```yaml
steps:
  - id: explore
    name: Explore the codebase
    identity: senior-coder
    execution_mode: dynamic # declared (default) | dynamic
    permitted_tools:
      - read_file
      - list_directory
      - search_files
```

| Mode       | What it does                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declared` | Default. The step generates once via the agent executor (optionally routed by a `strategy`, above).                                                                                                               |
| `dynamic`  | Model-driven tool selection: the step runs a ReAct loop that reasons about which `permitted_tools` to call next and declares completion — see `Blueprints/Flows/analyze-codebase.flow.yaml` for a worked example. |

`execution_mode: dynamic` is a **Team-edition** capability. On a Team/Enterprise daemon the
step's `permitted_tools` are enforced at runtime (the model may only call a tool from that
list); on a Solo daemon the step is not dynamically wired and falls back to the declared path.
Use `dynamic` when the step genuinely needs to inspect the live workspace and choose its own
next action (exploration, investigation); use `declared` (with or without a `strategy`) for
steps whose work is already fully specified.

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

`exactl routing policy validate` checks a YAML policy file against the current schema. When omitted, it validates the configured default routing policy file.

##### Flow Step Types

Flows support various step types for different orchestration patterns:

| Step Type      | Purpose               | Key Features                               |
| -------------- | --------------------- | ------------------------------------------ |
| `agent`        | Execute an agent      | Agent invocation with context              |
| `gate`         | Quality checkpoint    | Pass/fail criteria, retry logic            |
| `branch`       | Conditional branching | Expression-based path selection            |
| `parallel`     | Concurrent execution  | Multiple steps in parallel                 |
| `loop`         | Iterative processing  | Repeat until condition met                 |
| `voting_group` | Multi-agent consensus | Fan-out N runners, majority/weighted/judge |

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

> **model resolution and intent:** Hardcoded `model:` in blueprints is deprecated. Use `model_size:` + `characteristics:` instead.
> See [§6.2 Model Intent](#62-model-intent-model-resolution-and-intent) for the replacement system.

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
---
identity_id: "senior-coder"
name: "Senior Coder"
model: "anthropic:claude-3-sonnet"
capabilities: ["code_generation", "debugging"]
default_skills: ["response-contract", "code-review", "portal-grounding"]
created: "2025-12-02T10:00:00Z"
created_by: "user@example.com"
version: "1.0.0"
---

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

##### Voting Group Steps

`voting_group` steps run multiple agents on the same objective and resolve
consensus. This is a **Team/Enterprise** feature (Solo ❌ / Team ✅ / Enterprise ✅).

```yaml
step:
  id: "vote-on-result"
  type: "voting_group"
  identity: "voter"
  voting:
    runners:
      - blueprint: "senior-coder"
        prompt_variant: "Focus on correctness"
      - blueprint: "senior-coder"
        prompt_variant: "Focus on performance"
      - blueprint: "senior-coder"
        prompt_variant: "Focus on maintainability"
    strategy: "majority" # majority | weighted | llm-judge
    halt_on_no_consensus: true # true: halt via Plan Amendment
    timeout_ms: 30000
```

**Strategies:**

- `majority` — Most frequent response wins (deterministic, CI-safe)
- `weighted` — Highest `confidence` score wins (deterministic, CI-safe)
- `llm-judge` — Judge blueprint ranks candidates (non-deterministic, provider-live)

When `halt_on_no_consensus: true` and no consensus is reached, execution halts
via the Plan Amendment gate for operator resolution. When `false`, the best
candidate is returned with a `dissent_summary`.

Fan-out cost is attributed per runner through `ICostTracker`. Each runner
execution is logged as a separate `voting.runner_failed` or `voting.resolved`
event.

**Edition note:** Runtime edition-gating is deferred to a future
edition-enforcement phase. The `voting_group` construct is reachable in Team
builds but must not be advertised as a generally available Solo feature until
edition-enforcement ships.

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

#### **Eval Commands** - Run and compare evaluation scenarios

Run predefined scenario packs, score results, and compare runs. Full documentation
in `docs/Exaix_Evaluation.md`.

```bash
exactl eval run --pack smoke --trials 5
exactl eval history --last 10
exactl eval compare --run-a <id> --run-b <id>
exactl eval report --pack swe-tasks --format table
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

#### **Log & Journal Commands** - Inspect the Activity Journal and cost reports

```bash
exactl journal                    # Show last 20 events
exactl journal --action config.updated
exactl log cost                   # Aggregated cost report
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
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-ffi",
        "--allow-import",
        "--allow-run=git,deno,npm,node,exoctl,ls,grep,echo,printf,pwd,whoami,id,date,uptime,which,type,command,hash,alias",
        "/path/to/Exaix/apps/exactl/main.ts",
        "mcp",
        "start"
      ],
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

#### **Config Commands** - View and manage configuration (get/set/diff/history/rollback/lock/unlock/edit/compact)

#### **Log & Journal Commands** - Inspect the Activity Journal and cost reports

#### **Migrate Command** - Check workspace schema compatibility

#### **Skills Command** - Quick alias for `memory skill`

#### **Tool Commands** - Manage pending tool confirmations

#### **Version Command** - Display version information

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

#### **Config Commands** — Manage Configuration Overrides

Exaix manages runtime configuration through the **Config DB** (`.exa/config.db`)
instead of TOML files. The `exactl config` command group provides full CRUD, audit, and security
control over config keys registered via `configurable()`. **180+ keys** are registered across all
packages; run `exactl config list` to see them all.

```bash
# Get the effective value of a key (Config DB → registry → schema default)
exactl config get ai.provider

# Set an override with validation and rate limiting
exactl config set ai.timeout_ms 45000

# Remove an override (falls back to registry default)
exactl config unset ai.provider

# Compare effective values against registry defaults
exactl config diff --sources

# Validate a key against its registered schema bounds without writing
exactl config validate ai.timeout_ms 999999
```

**Audit & rollback:**

```bash
# Show the full append-only history for a key (newest-first)
exactl config history ai.provider

# Roll back to a previous value by history id
exactl config rollback ai.provider 3
```

**Key locking (security control):**

Prevents any further writes to a compromised key through every surface (CLI, MCP, daemon).

```bash
# Lock a key — no surface can modify it until unlocked
exactl config lock ai.provider --reason "compromised"

# Unlock
exactl config unlock ai.provider

# List all locked keys
exactl config lock-list
```

**Integrity checksum:**

The daemon computes a SHA-256 checksum of the effective Config DB at boot and periodically
(default every 60s). A tampered DB (e.g. `sqlite3 .exa/config.db` outside Exaix) journals
`config.integrity_mismatch`.

```bash
# Verify manually
exactl config validate --integrity

# Check the journal for integrity events
exactl journal --action config.integrity_verified
```

**Bulk editing:**

Open the current overrides in `$EDITOR`, edit key=value lines, and apply changes through the
same security funnel (lock check + validation + debounce all apply).

```bash
exactl config edit
```

**Blocklist management:**

Persistently deny specific key patterns to one or all MCP agents.

```bash
exactl config block add "ai.api_key" --reason "never expose"
exactl config block list
exactl config block remove "ai.api_key"
```

**Profiles:**

Group overrides into named profiles and switch between them.

```bash
exactl config set --profile workstation ai.timeout_ms 60000
exactl config use-profile workstation
exactl config list-profiles
exactl config get --profile workstation ai.timeout_ms
```

**Hygiene:**

```bash
# Compact the append-only log (collapses to one row per key)
exactl config compact
```

---

#### **Eval Commands** - Run and compare evaluation scenarios

The evaluation framework runs predefined scenarios against your workspace, scores
results, and compares runs over time. Full documentation is in `docs/Exaix_Evaluation.md`.

```bash
# Run an evaluation scenario pack
exactl eval run --pack smoke
exactl eval run --tag smoke --trials 5 --score-threshold 0.7

# Run in eval mode (writes history, produces eval-report.json)
exactl eval run --pack smoke --eval-mode --score-threshold 0.6

# Query evaluation history (SQLite default, --source jsonl to fall back)
exactl eval history --last 10
exactl eval history --pack smoke --since 2026-06-01 --format json
exactl eval history --source jsonl --last 10

# Compare two evaluation runs side-by-side
exactl eval compare --run-a <run-id> --run-b <run-id>

# Bound a run's spend and read the accuracy-vs-cost / harness-lift readouts
exactl eval run --pack swe_tasks --max-cost-usd 0.5
exactl eval report --view frontier
exactl eval report --view lift
exactl eval report --view failures

# View family-level report (swe-tasks pack)
exactl eval report --pack swe-tasks --format table

# External-benchmark comparability (Terminal-Bench, Docker required to run tasks live)
exactl eval report --view external
```

`eval report` views: `cost` (default), `families`, `lift` (Exaix vs the raw CLI on the same
task), `ablation` (per-subsystem contribution), `frontier` (accuracy vs cost with Pareto
marking), `failures` (why runs fail, per family and cell), and `external` (comparability against
a public benchmark — currently Terminal-Bench; requires Docker to run tasks live, read-only
against history otherwise; see `docs/Exaix_Evaluation.md` §17 for the methodology and its
caveats); `--format json` gives machine-readable rows. `--max-cost-usd` stops scheduling once
accumulated tracked cost reaches the cap (remaining scenarios skipped, never a task truncated
mid-run). Full documentation in `docs/Exaix_Evaluation.md`.

Exit codes: `0` all passed, `1` one or more below threshold, `2` infrastructure
error. Eval reports are written to the output directory as `eval-report.json`.

---

#### **Log & Journal Commands** - Query the Activity Journal

Every action in Exaix is recorded in the append-only Activity Journal. The `journal`
and `log journal` commands let you inspect this audit trail. The `log cost` command
aggregates cost data across runs.

```bash
# Query the journal (default: last 20 events, newest first)
exactl journal
exactl log journal

# Filter by action type
exactl journal --action config.updated
exactl journal --action config.integrity_mismatch

# Filter by trace id
exactl journal --trace-id <uuid>

# Filter by agent
exactl journal --agent my-agent

# Time range queries
exactl journal --since "2026-06-01" --until "2026-06-07"

# Aggregation
exactl journal --action-type plan.approved --count

# Display cost reports
exactl log cost
exactl log cost --period monthly
```

To **wait** for an event instead of querying — a readiness barrier — use the `wait`
subcommand. It polls the journal until the matching event is journalled after a baseline
(or the timeout elapses), printing the matched event and exiting `0` on a match
and `1` on timeout. This is useful in scripts and test harnesses that must block until
the daemon is ready, a flow completes, a plan is approved, and so on.

```bash
# Block until the daemon is ready (default timeout 30s), then exit 0
exactl journal wait --event daemon.ready

# Raise the timeout
exactl journal wait --event flow.completed --timeout 120

# Only count events timestamped after a given time (ISO datetime) — ignore earlier events
exactl journal wait --event plan.approved --since "2026-06-01T12:00:00Z" --timeout 120

# Match only events whose payload contains a substring (SQL LIKE pattern)
exactl journal wait --event model.resolved --payload "%preferred_list%"
```

The journal is the primary audit surface — every `config.set`, `plan.approved`,
`tool.confirmed`, and integrity check produces a typed event entry visible here.

---

#### **Migrate Command** - Check workspace schema compatibility

When upgrading Exaix, the workspace schema version may change. `exactl migrate check`
compares the binary's expected schema version against the workspace's stored version.

```bash
# Check schema compatibility
exactl migrate check
```

If versions mismatch, the command reports the expected and actual versions and
recommends migration steps. This is also checked automatically at daemon start.

---

#### **Skills Command** - Quick alias for `memory skill`

The `skills` command is a top-level alias for the most common `memory skill`
subcommands. See the **Skill Commands** section above for full documentation.

```bash
# List all skills (same as memory skill list)
exactl skills list

# Show a specific skill (same as memory skill show)
exactl skills show <skill-id>

# Find skills matching a request description
exactl skills match "Refactor authentication module"
```

---

#### **Tool Commands** - Manage pending tool confirmations

When a tool requires human approval (e.g., writing to a file outside the workspace,
or a dangerous config change), it enters a pending confirmation state. Use `tool`
commands to review and resolve these.

```bash
# List all pending tool confirmations
exactl tool pending

# Approve a pending confirmation by id
exactl tool confirm <confirmation-id>

# Deny a pending confirmation by id
exactl tool deny <confirmation-id>
```

Pending confirmations are also visible through the journal (`exactl journal --action tool.confirmation_pending`).

---

#### **Version Command** - Display version information

Shows the Exaix binary version and workspace schema version.

```bash
# Show version info
exactl version
```

The output includes `binary_version` (the daemon/CLI release) and
`workspace_schema_version` (the data schema expected by the current workspace).
If these mismatch, run `exactl migrate check` for details.

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

# Configuration management
exactl config get ai.provider           # Show effective config value
exactl config set ai.timeout_ms 45000   # Set override (validated)
exactl config history ai.provider       # View audit trail
exactl config rollback ai.provider 3    # Revert to historical value
exactl config lock ai.provider          # Protect a key from writes
exactl config edit                      # Bulk edit in $EDITOR

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

# System info and evaluation
exactl version                            # Show binary and schema version
exactl migrate check                      # Check schema compatibility
exactl tool pending                       # List pending tool confirmations
exactl eval run --pack smoke              # Run an evaluation scenario
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
2. **Git Operations**: Branches and commits created in portal's repository
3. **File Access**: Agent can read/write portal files directly
4. **Reviews**: Track actual code changes in portal repository

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

#### Portal Knowledge Gathering

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
auto_analyze_on_mount = false     # Analyze on portal add/refresh (opt-in)
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

**Supported languages for symbol extraction:**

The portal knowledge pipeline produces a `symbolMap` — a ranked index of exported
symbols. The languages available depend on edition:

| Edition | Languages                                                             |
| ------- | --------------------------------------------------------------------- |
| Solo    | TypeScript, JavaScript (via `deno doc`), **Python** (via tree-sitter) |
| Team    | Solo baseline + extended set: Rust, Go, Java (via tree-sitter)        |
| None    | All other languages yield an empty map (fail-soft, no error)          |

Python extraction uses a local tree-sitter WASM grammar — no network access, no
native code (`--allow-ffi` not required). Extended-language extractors (Team)
follow the same pattern. Symbol extraction is primary-language-scoped: only the
dominant language's symbols are mapped in mixed-language portals.

---

## 6. Advanced Agent Features

Exaix includes sophisticated agent orchestration capabilities that enhance output quality, reliability, and context awareness. This section covers the advanced features available for agent configuration.

### 6.1 Reflexion Pattern (Self-Critique)

The Reflexion pattern enables agents to critique and improve their own outputs iteratively.

#### How It Works

1. Agent generates initial response
2. Agent self-critiques using structured criteria (accuracy, completeness, quality, safety)
3. If issues found, agent refines output
4. Process repeats until quality threshold met or max iterations reached

#### Configuration

Enable reflexion in identity blueprint frontmatter:

```yaml
---
identity_id: "quality-reviewer"
name: "Quality Reviewer"
model: ""                  # deprecated — use model_size + characteristics instead
model_size: L              # large model for thorough evaluation
thinking: true             # extended reasoning for critique
effort: high               # high token budget for deep analysis
capabilities: ["review", "evaluation"]
default_skills: ["response-contract", "reflexive-critique", "portal-grounding"]
permitted_tools: ["read_file", "grep_search"]
reflexive: true
max_reflexion_iterations: 3
confidence_required: 80
---
```

| Field                      | Default | Description                          |
| -------------------------- | ------- | ------------------------------------ |
| `reflexive`                | `false` | Enable self-critique loop            |
| `max_reflexion_iterations` | `3`     | Maximum refinement passes            |
| `confidence_required`      | `80`    | Minimum confidence (0-100) to accept |

#### When to Use Reflexion

- **Code review agents**: Catch issues the first pass might miss
- **Technical writing**: Ensure accuracy and completeness
- **Security audits**: Multi-pass vulnerability analysis
- **Quality-critical tasks**: Any output requiring high confidence

#### Trade-offs

- **Higher quality**: More thorough analysis
- **Increased latency**: 2-4x longer response time
- **Higher cost**: Multiple LLM calls per request

### 6.2 Model Intent (model resolution and intent)

Model Intent lets you describe the model you want by **capability requirements**
rather than hardcoding a specific `provider:model` ID. Instead of saying
"use claude-sonnet-4", you say "give me a size L model with thinking" — and
`ModelResolver` picks the best available provider+model that matches.

This decouples your request/identity from any single provider. The same intent
works locally with Ollama, in the cloud with Anthropic, or in an air-gapped
environment — without editing blueprints.

#### Available intent fields in blueprint frontmatter

| Field                   | Values                                                | Behavior                                                                   |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `model_size`            | `S`, `M`, `L`, `XL`                                   | Maps to capability profile (context window, cost, thinking support)        |
| `thinking`              | `true`, `false`                                       | Require extended reasoning model                                           |
| `effort`                | `low`, `medium`, `high`                               | Reasoning token budget (only meaningful with `thinking: true`)             |
| `characteristics`       | `["cheapest"]`, `["fastest"]`                         | Soft ranking hint — scores providers, does not eliminate                   |
| `preferred_provider`    | provider name                                         | Narrow candidate pool, skip cross-provider scoring                         |
| `required_capabilities` | `chat`, `streaming`, `vision`, `tools`, `multi-model` | Hard filter — providers lacking ALL listed values are excluded             |
| `model`                 | `provider:model`                                      | **Deprecated** — bypasses ModelResolver, ties identity to a specific model |

`required_capabilities` is a **hard filter** — providers that don't support
every listed value are excluded. Supported values per provider:

| Value         | Supported by                      |
| ------------- | --------------------------------- |
| `chat`        | All providers                     |
| `streaming`   | Anthropic, Google, Ollama, OpenAI |
| `vision`      | Anthropic, Google, OpenAI         |
| `tools`       | OpenAI                            |
| `multi-model` | OpenRouter                        |

`characteristics` is a **soft ranking hint** — no providers are excluded,
only scored higher or lower:

| Value      | Effect                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| `cheapest` | Higher score for lower `costPerMtok`. Best for batch/non-urgent work        |
| `fastest`  | Scores all candidates equally. Typically selects the first healthy provider |

#### Preset Configuration

Size tiers map to capability profiles in `exa.config.toml`:

```toml
[model_presets]
S = { max_cost_per_mtok = 0.5,  min_context_window = 8192,   supports_thinking = false }
M = { max_cost_per_mtok = 3,    min_context_window = 32000,  supports_thinking = true  }
L = { max_cost_per_mtok = 15,   min_context_window = 128000, supports_thinking = true  }
XL = { max_cost_per_mtok = 75,  min_context_window = 200000, supports_thinking = true  }
```

Override individual fields per tier:

```toml
[model_presets.M]
max_cost_per_mtok = 5
```

Restrict eligible providers for a tier with `candidates`:

```toml
[model_presets.L]
candidates = ["anthropic:claude-sonnet", "openai:gpt-4o"]
```

#### Resolution Precedence

1. `model: "provider:model"` — explicit override (bypasses resolver)
2. `model_size` + `characteristics` — preset lookup with soft ranking
3. `model_size` only — preset default
4. `fallbacks[]` — fallback chain iteration
5. Context-window overflow — auto-bump to next size tier

During plan execution, **request-level intent overrides the blueprint**: CLI flags such as
`--model-size M` or `--thinking` (written to the request frontmatter) take precedence over
the identity blueprint's `model_size:`/`thinking:` for any field that is explicitly set;
unset fields fall through to the blueprint default. `--preferred-provider` narrows the
candidate pool and skips cross-provider scoring.

Every resolution emits a `model_resolved` trace event visible via
`exactl logs --filter model_resolved`.

#### CLI Flags

Available on `exactl request`:

| Flag                   | Values                  | Description                    |
| ---------------------- | ----------------------- | ------------------------------ |
| `--model-size`         | `S`, `M`, `L`, `XL`     | Capability tier                |
| `--thinking`           | (flag)                  | Require extended reasoning     |
| `--effort`             | `low`, `medium`, `high` | Reasoning token budget         |
| `--characteristic`     | `cheapest`, `fastest`   | Soft ranking hint (repeatable) |
| `--preferred-provider` | provider name           | Narrow to one provider         |

#### Migration: Identity Blueprints

**Hardcoded `model:` in identity blueprints is deprecated.** Replace with
declarative fields:

```diff
  ---
- model: "anthropic:claude-sonnet-4"
+ model: ""                # preserved empty for schema compat
+ model_size: "L"
+ characteristics: ["fastest"]
  ---
```

Supported frontmatter fields:

| Field                | Type    | Values                            |
| -------------------- | ------- | --------------------------------- |
| `model_size`         | string  | `S`, `M`, `L`, `XL`               |
| `preferred_provider` | string  | Provider name (e.g. `anthropic`)  |
| `thinking`           | boolean | `true`, `false`                   |
| `effort`             | string  | `low`, `medium`, `high`           |
| `characteristics`    | array   | `["cheapest"]`, `["fastest"]`     |
| `model`              | string  | **Deprecated** — `provider:model` |

The `model` field continues to work, but it short-circuits the resolver and
ties the identity to a specific provider+model, defeating portability.

#### Future: the curated model registry Model Registry

the curated model registry will introduce the `IModelRegistry` plugin system, enabling:

- Registration of custom model sizes beyond `S`/`M`/`L`/`XL`
- A `fastest` simplification — `--model-size fastest` resolves to the cheapest
  model meeting minimal quality thresholds, removing the need to choose a tier
- Dynamic provider capability discovery at startup
- End-user model aliases in config

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
2. **Memory lookup**: System searches for relevant past interactions
3. **Context injection**: Top-K memories added to agent prompt
4. **Execution**: Agent has historical context
5. **Learning capture**: New insights saved post-execution

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
2. **Schema validation**: Check against PlanSchema
3. **Auto-repair**: Attempt to fix common issues
4. **Detailed errors**: Report specific validation failures

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

### 6.6 Scaffolding Identities and Behavioural Patterns

The catalog is a flat set of concrete identities (no separate template
directory). To create a new identity, clone an existing one as a prototype with
`--from`, then attach the skills that give it the behaviour you want:

```bash
# Clone a prototype, then validate and use
exactl blueprint create my-agent --name "My Agent" --from senior-coder
exactl blueprint validate my-agent
exactl request "Task" --identity my-agent
```

The behavioural patterns that used to be templates are now **skills** in
`Blueprints/Skills/` — add them to your identity's `default_skills`:

| Pattern                  | Skill                                                  | Best for                   |
| ------------------------ | ------------------------------------------------------ | -------------------------- |
| Self-critique            | `reflexive-critique`                                   | Quality-critical tasks     |
| Multi-turn dialogue      | `conversational-dialogue`                              | Interactive sessions       |
| Multi-agent coordination | `collaborative-flow`                                   | Handoffs and consensus     |
| LLM-as-Judge             | `verdict-rubric`                                       | Quality gates, approvals   |
| Information gathering    | `research-methodology`                                 | Exploration, documentation |
| Domain review            | `code-review`, `architecture-review`, `security-first` | Security, architecture     |

See `Blueprints/Skills/README.md` for the full skill library.

Each identity's frontmatter also carries a `permitted_tools` allowlist — the
least-privilege ceiling on which MCP tools that identity may ever use,
regardless of which skills get matched onto a request. See
[§3.3 Skill Tools](#skill-tools) for how a matched skill's own `tools:`
declaration narrows within that ceiling.

### 6.7 Troubleshooting

#### High Latency

If agent responses are slow:

1. **Check reflexion settings**: Reduce `max_reflexion_iterations`
2. **Reduce memory context**: Lower `topK` or `maxContextLength`
3. **Use faster model**: Switch to smaller/faster model variant
4. **Disable optional features**: Turn off reflexion or memory for speed

#### Low Confidence Outputs

If agents consistently produce low-confidence outputs:

1. **Check prompt clarity**: Ensure request is specific
2. **Provide more context**: Add relevant files to portal
3. **Use specialist agent**: Match agent expertise to task
4. **Enable session memory**: Historical context helps

#### Retry Exhaustion

If agents fail after max retries:

1. **Check service status**: Provider may be down
2. **Verify credentials**: API keys may be expired
3. **Check rate limits**: You may be hitting quotas
4. **Increase delays**: Raise `initialDelay` or `maxDelay`

#### Memory Not Found

If relevant memories aren't being injected:

1. **Check threshold**: Lower `threshold` value (e.g., 0.1)
2. **Rebuild index**: `exactl memory rebuild-index`
3. **Add learnings**: Approve pending learnings
4. **Check scope**: Ensure learnings are in correct project/global scope

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
- **[quality_gate]:** Request quality gate thresholds, mode, and enrichment behaviour

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

1. **Never modify `packages/core/src/types/constants.ts` directly** - All magic values are defined in `exa.config.toml`
2. **Use `exa.config.sample.toml` as reference** - Contains documented examples for all settings
3. **Validate after changes** - Run `exactl daemon restart` to ensure config is valid

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

#### 5.3.3 Test Environment Variables

Three environment variables control cost-safe LLM testing:

| Variable                   | Purpose                                      | Validation       | Example                                 |
| -------------------------- | -------------------------------------------- | ---------------- | --------------------------------------- |
| `EXA_TEST_ENABLE_PAID_LLM` | Opt-in to real LLM calls (mock by default)   | `"1"` to enable  | `export EXA_TEST_ENABLE_PAID_LLM=1`     |
| `EXA_TEST_OPENAI_API_KEY`  | API key for OpenAI-compatible test endpoints | Non-empty string | `export EXA_TEST_OPENAI_API_KEY="sk-…"` |
| `EXA_TEST_LLM_MODEL`       | Default model for paid LLM tests             | Model ID string  | `export EXA_TEST_LLM_MODEL=gpt-5-mini`  |

**CI Safety:** When `CI` is set and `EXA_TEST_ENABLE_PAID_LLM` is not `"1"`, the `ModelFactory` returns a `MockProvider` for cost-friendly model aliases. Never set `EXA_TEST_ENABLE_PAID_LLM=1` in CI jobs unless the run is on a trusted branch with properly stored secrets.

**Usage Example:**

```bash
# Manual paid-LLM integration test
export EXA_TEST_ENABLE_PAID_LLM=1
export EXA_TEST_OPENAI_API_KEY="sk-..."
export EXA_TEST_LLM_MODEL="gpt-5-mini"
deno test tests/integration/19_llm_free_provider_test.ts --allow-env --allow-net --allow-read
```

#### 5.3.4 Troubleshooting Environment Variables

**Invalid environment variable warnings:**

If you see warnings like "Invalid EXA_LLM_TIMEOUT_MS: must be ≥ 1000", check:

1. **Value is within valid range** (timeout: 1000-300000ms)
2. **No typos in variable name** (case-sensitive)
3. **Provider name is valid** (`mock`, `ollama`, `anthropic`, `openai`, `google`)
4. **URL is well-formed** (must include protocol: `http://` or `https://`)

**Environment variables not taking effect:**

1. **Restart the daemon** after setting env vars: `exactl daemon restart`
2. **Check the daemon logs** to see which values were loaded: `exactl daemon logs`
3. **Verify the variable is set** in the daemon's environment: `env | grep EXA_LLM`

For more details, see `templates/exa.config.sample.toml` and [Technical Specification](../exaix-dev-docs/dev/Exaix_Technical_Spec.md).

### 5.3a Execution Configuration

The `[execution]` section controls how plan steps are executed:

```toml
[execution]
# Enable provider-enforced native tool selection. When true and the configured
# provider supports it, the model selects tools via the API's native tool_choice
# mechanism instead of embedding tool calls in TOML prose.
# Default: false.
native_tools_enabled = true
```

When `native_tools_enabled = true`, the daemon's `ReActLoopStrategy` sends a real
`tools[]`/`tool_choice` (or provider-equivalent) parameter to the configured provider's
API, constraining the model to choose from the tools Exaix actually offers. Falls back
to the standard TOML-block prose path when the provider or strategy does not support
native tool selection.

**Current scope:**

- **Live-verified**: Anthropic, OpenAI, and Google. Real API calls confirm provider-enforced
  tool selection end-to-end. Google's live verification was confirmed with a standard paid-tier
  run returning `"serviceTier": "standard"` (25 dynamic tool call rows, total cost `$0.1211575`).
- **Code-complete, pending live verification**: OpenRouter. Serialization is
  implemented and unit-tested (`supportsNativeTools: true` is registered), but
  has not yet been proven against a real API call in this environment. Enabling this on
  OpenRouter today uses tested-but-not-yet-live-proven functionality.
- **OpenRouter caveat**: tool support depends on the specific model OpenRouter routes
  to, not on OpenRouter itself — check that a model's `supported_parameters` includes
  `tools` via OpenRouter's `/api/v1/models` endpoint before relying on native tool
  selection through it.
- ReActLoopStrategy only (LegacyAgentStrategy and LlmClient unchanged).

### 5.4 Testing & CI Model Aliases

Exaix provides two predefined model configurations for testing and CI workflows via `exa.config.toml`:

```toml
[models.ci_safe]
provider = "mock"
model = "mock"

[models.local_cheaper]
provider = "openai"
model = "gpt-5-mini"
```

- **`ci_safe`** — Always returns a `MockProvider` (no API calls, no costs). Used automatically when `CI` is set and `EXA_TEST_ENABLE_PAID_LLM` is not `"1"`. Safe for automated CI pipelines.
- **`local_cheaper`** — Uses the `OpenAIShim` adapter with the `gpt-5-mini` model alias. Enables manual testing against real OpenAI-compatible endpoints at reduced cost.

The `ModelFactory` provides these convenience aliases and automatically selects `ci_safe` in CI environments unless explicitly opted out via `EXA_TEST_ENABLE_PAID_LLM=1`.

### 5.5 ACI (Agent-Computer Interface) Tool Guidance

The `[agents]` section controls whether structured tool-usage guidance is injected into
dynamic (ReAct) execution prompts:

```toml
[agents]
# Inject each visible tool's ACI block (summary, when/when-not-to-use, worked example,
# anti-example) into the ReAct prompt. Requires a daemon restart to take effect.
# Default: false.
inject_aci_docs = true

# Aggregate character budget for injected ACI guidance across all visible tools in one
# prompt. Further capped by the model's own plan budget when present. Requires a daemon
# restart to take effect. Default: 12000. Range: 1000-50000.
aci_doc_prompt_max_chars = 12000
```

When enabled, every ReAct iteration's prompt gains a bounded, delimiter-safe guidance
fragment for each visible tool that declares a compliant `aciDoc` block and a side-effect
scope; a tool with neither is silently omitted, never partially rendered. Fragments are
included whole or skipped whole against the aggregate budget above — a large tool's
fragment being skipped does not prevent a smaller tool's fragment later in the list from
still fitting.

**Restart required**: both keys are restart-swap configuration — `exactl config set` (or
editing `exa.config.toml` directly) persists the new value immediately, but only plan
executions started **after** the next `exactl daemon restart` observe it. Use the standard
CLI path for either key:

```bash
exactl config get agents.inject_aci_docs
exactl config set agents.inject_aci_docs true
exactl config set agents.aci_doc_prompt_max_chars 8000
exactl daemon restart
```

**Disabled compatibility**: with `inject_aci_docs` at its default `false`, the assembled
prompt is byte-identical to the pre-Phase-112 baseline — no ACI section, no budget
computation, and no `agent.prompt_assembled` event with `prompt_kind: "react"` is emitted
at all for that iteration. Existing deployments upgrade with no prompt or behavior change
until the flag is explicitly enabled.

## 8. Model Context Protocol (MCP) Server

Exaix includes a built-in MCP server, allowing generic AI clients (like Claude Desktop or IDE extensions) to interact with your workspace using standardized tools.

### 8.1 Starting the Server

The standard way to run the MCP server is via the `exactl` CLI:

```bash
# Start in stdio mode (default, for local clients)
exactl mcp start

# Start over Streamable HTTP on a local port (for remote/HTTP clients)
exactl mcp start --sse --port 3000
```

The server is built on the official `@modelcontextprotocol/server` SDK and negotiates the current spec protocol version (2025-11-25) — not the legacy `2024-11-05` revision. The default `exactl mcp start` serves **stdio**; `--sse --port <N>` serves **Streamable HTTP** (the current spec's primary HTTP transport).

**Authentication (opt-in).** By default the server is unauthenticated. To require a bearer token from every client, enable `mcp.require_auth` and put the secret in an environment variable (never in plaintext config):

```toml
# exa.config.toml
[mcp]
require_auth = true
# auth_token_env defaults to "MCP_AUTH_TOKEN" — the env var holding the bearer secret
```

```bash
export MCP_AUTH_TOKEN="your-secret-token"
exactl mcp start --sse --port 3000
```

A client without (or with the wrong) bearer token is rejected with `401`; a client supplying `Authorization: Bearer $MCP_AUTH_TOKEN` is accepted. When `require_auth` is enabled but the token env var is unset, the server fails fast at startup rather than silently rejecting every request.

### 8.2 Available Tools

When connected, AI agents have access to high-level domain tools:

- **`exaix_create_request`**: Create a new request in your workspace.
- **`exaix_list_plans`**: List pending plans.
- **`exaix_approve_plan`**: Approve a plan for execution.
- **`exaix_query_journal`**: Search the Activity Journal for past events.
- **FileSystem & Git**: Standard tools (`read_file`, `write_file`, `git_status`, etc.) are also available, scoped to your workspace.

### 8.3 Client Integration

**Claude Desktop:**
Add the following to your `claude_desktop_config.json` (the command mirrors the repo's own fine-grained `deno task cli` permission model — no `--allow-all`):

```json
{
  "mcpServers": {
    "exaix": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-ffi",
        "--allow-import",
        "--allow-run=git,deno,npm,node,exoctl,ls,grep,echo,printf,pwd,whoami,id,date,uptime,which,type,command,hash,alias",
        "/path/to/Exaix/apps/exactl/main.ts",
        "mcp",
        "start"
      ],
      "env": {
        "EXAIX_ROOT": "/path/to/Exaix"
      }
    }
  }
}
```

See `templates/mcp/` for more client configuration examples.

### 8.4 Connecting Outbound (`exactl mcp connect`)

Section 8.1–8.3 cover Exaix acting as an MCP _server_. `exactl mcp connect` is the reverse direction: Exaix acting as an MCP _client_, reaching out to a real external MCP server (a documentation server, a code-hosting platform's MCP endpoint, or any spec-compliant server you point it at).

```bash
# List every tool a server exposes
exactl mcp connect <url> --list-tools

# Call a named tool with JSON arguments
exactl mcp connect <url> --call-tool <name> --args '{"key":"value"}'
```

Connection is automatic dual-transport: Streamable HTTP is tried first (the current MCP spec's primary transport), falling back to legacy SSE if the server only supports the older protocol — no flag needed either way.

**Authentication.** Some servers require a bearer token (a Personal Access Token or similar). Set it via an environment variable — never a CLI flag, so it never appears in `ps`-visible process arguments:

```bash
EXA_MCP_BEARER_TOKEN=<your-token> exactl mcp connect <url> --list-tools
```

`EXA_MCP_BEARER_TOKEN` is forwarded as an `Authorization: Bearer <token>` header on every request to the target server. Only this bearer-token mode is supported — interactive OAuth login flows and `client_credentials`/JWT-assertion grants are not.

**Example — GitHub's official remote MCP server:**

```bash
EXA_MCP_BEARER_TOKEN=$(gh auth token) exactl mcp connect https://api.githubcopilot.com/mcp/ --list-tools
```

## 9. Security

Exaix is built with a "Safety First" architecture, focusing on local execution and explicit permissions.

### 9.1 Key Security Features

- **Sandboxing:** File system access is strictly scoped to your Workspace and configured Portals. Path traversal attempts are blocked.
- **API Keys:** Keys are loaded from environment variables (`ANTHROPIC_API_KEY`, etc.) and never stored in the database or logs.
- **Human-in-the-Loop:** Critical actions (plan approval, file writes via generic agents) require explicit human confirmation unless configured otherwise.
- **Git Safety:** Automated commits are signed with detailed trace IDs.
- **Least-privilege daemon spawn:** The `exactl daemon start` launcher spawns the
  daemon with a minimal, scoped permission set — not blanket `--allow-all`.

### 9.1.1 Outbound network allowlist (`[system].allow_net`)

The daemon launcher constructs its `--allow-net` flag from `[system].allow_net`:

```toml
[system]
# Omitted  → default hosts (api.anthropic.com, api.openai.com, localhost:11434)
# []       → outbound network is BLOCKED entirely
# explicit → only these hosts are reachable
allow_net = ["api.anthropic.com"]
```

| `allow_net` value          | Effect                                              |
| -------------------------- | --------------------------------------------------- |
| omitted (`undefined`)      | `--allow-net=<default host list>`                   |
| `[]` (empty array)         | no `--allow-net` flag — **all outbound is blocked** |
| `["host", "host:port", …]` | `--allow-net=host,host:port` (only these)           |

Setting `allow_net = []` is the strongest posture: the daemon cannot make any
outbound connection (use it for fully offline/local-model setups). An empty list
is **never** silently widened to `--allow-all` — only a genuine config-read error
falls back to full permissions, and that fallback is logged as a warning so you
can fix the config.

Write access is scoped to the daemon's data root; read, FFI (sqlite), dynamic
import, and env are granted because the daemon genuinely needs them. The
`exactl daemon` launcher and the dogfood launcher share one run-binary allowlist
so the two paths cannot drift.

#### How `allow_net` is enforced (two layers)

`allow_net` is enforced at two layers, so it holds no matter how the daemon was
started:

1. **Launcher flag (primary).** When you start the daemon via `exactl daemon
   start` or the dogfood launcher, the launcher bakes the computed `--allow-net`
   into the spawned daemon process. Deno enforces it at the OS level — the
   narrowing applies to specific hosts.

2. **Startup self-check (defence-in-depth).** Some launch paths cannot read
   `allow_net` at startup — most importantly the **compiled `exaix` binary** (its
   `--allow-*` flags are frozen at `deno compile` time) and `deno task dev` (flags
   are fixed in the task). For these, the daemon performs a startup check: if
   `allow_net = []` (block all) but the process was nonetheless granted network
   access, **the daemon refuses to start** (fail-closed) and logs the reason.
   This guarantees the strict-block policy is honoured even by the compiled
   binary.

   > **Caveat (host allowlists, not strict block):** A _non-empty_ host
   > allowlist (e.g. `["api.anthropic.com"]`) can only be enforced by the
   > launcher's `--allow-net=<hosts>` flag, because the OS reports network
   > permission at the blanket level, not per-host. If you run the **compiled
   > binary** or `deno task dev` directly, a host allowlist is **not** narrowed —
   > only the strict block (`allow_net = []`) is self-enforced. For per-host
   > narrowing, launch via `exactl daemon start`, or rebuild the binary with the
   > desired `--allow-net=<hosts>` flag.

### 9.2 Best Practices

1. **Review Plans:** Always inspect the diffs in the TUI (`exactl plan show`) before approving.
2. **Audit Logs:** Use `exactl journal` to audit agent activity.
3. **Keep Keys Private:** Never commit your `.env` or `exa.config.toml` if it contains secrets (though it shouldn't).

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
2. **Daily Budget Enforcement**: Prevents exceeding your daily spending limit
3. **Provider-Specific Rates**: Different rates for different models and providers
4. **Historical Reporting**: Query past usage and costs via Activity Journal

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

Prompt-window enforcement is configured separately through the context window management
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
2. **Estimated Cost**: Predicted cost for the current request
3. **Provider Limits**: Any provider-specific restrictions

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

### 12.4 Per-Action HITL Governance

> **This is a Team/Enterprise Edition feature.** It is off by default and only activates when
> `EXAIX_EDITION=team` and `config.hitl.enabled=true`.

Per-action HITL adds a **third human checkpoint** (alongside plan approval and amendment approval)
that pauses individual tool invocations based on per-argument policy rules.

**Blueprint authors** declare which tool calls need secondary approval via the YAML frontmatter:

```yaml
hitl:
  require_secondary_approval:
    - tool: git_commit
      path_pattern: "**/migrations/**"
      reason: "Migrations require secondary approval"
    - tool: run_command
      command_pattern: "*rm -rf*"
      reason: "Destructive commands require secondary approval"
    - tool: write_file
      path_pattern: "**/.env*"
      reason: "Env file writes require secondary approval"
```

**Administrators** declare non-bypassable rules in `exa.config.toml`:

```toml
[hitl]
enabled = true
mandatory_rules = [
  { tool = "run_command", command_pattern = "*rm -rf*", reason = "Admin: no destructive rm" }
]
```

A mandatory rule applies to **all** blueprints and cannot be overridden. If no approver is
available (e.g. CLI mode without a confirmation interceptor), the tool is **denied** (fail-closed).
Blueprint-only rules degrade gracefully (tool proceeds without interruption).

**Read-only tools** (e.g. `read_file`, `search_files`) are never automatically paused — HITL
must be explicitly configured to gate them. This is recommended only for sensitive-path
confidentiality (secrets, PII), not for routine reads, to avoid stalling the agent's reasoning loop.

---

## 13. Evaluation & Scoring

Exaix includes a built-in evaluation framework for measuring agent behaviour
quantitatively. It provides weighted scoring, history tracking, and CI-gated
quality thresholds.

```bash
# Run self-contained evaluation packs (no sandbox needed)
exactl eval run --pack blueprint-eval

# Run with a score threshold
exactl eval run --pack blueprint-eval --score-threshold 0.7

# View run history
exactl eval history --last 10
```

For the complete CLI reference, scoring model, scenario authoring guide, and
CI integration, see **[`docs/Exaix_Evaluation.md`](Exaix_Evaluation.md)**.

### Subsystem evaluation

Scenarios are tagged by the subsystem they measure — tools, mcp-server, mcp-client, identities,
skills, flows — so coverage can be read per subsystem rather than per directory:

```bash
# Every mock-tier scenario across all six subsystems
deno task eval:subsystems

# The cheap tier: one or more representatives per subsystem
deno task eval:subsystems:core

# The catalog/flow/identity/skill/tool parity gates
deno task test:parity

# Per-subsystem summary with pass counts and trend deltas
exactl eval report --group-by subsystem
```

> **Run these by hand.** None is attached to a CI job or to the pre-commit gates. `eval:subsystems`
> spawns daemons across roughly seventy scenarios; the nightly tier below spends provider budget.

**The nightly provider-live recipe.** The mock tier proves mechanics. Anything about _which_ tool an
agent reaches for, or how good its output is, needs a real model — the mock provider emits no tool
calls at all, so a trajectory score there is always 0.00 and never partial.

```bash
EXA_LLM_PROVIDER=google \
deno run -A tests/scenario_framework/runner/main.ts \
  --tag subsystem:mcp-client --tag provider-live \
  --mode auto --eval-mode --trials 3
```

`--tag provider-live` turns off the CI-safety filter that normally drops those scenarios; it does
not widen the selection into other packs. Do not pin `EXA_LLM_PROVIDER` inside a scenario — step
`env` is merged last and would override the value you set here.

Scenario sandboxes are reclaimed on success and kept on failure; reclaim the backlog with
`deno task scenario:prune` (dry-run by default). See
[`tests/scenario_framework/README.md`](../tests/scenario_framework/README.md) §2.5 and §4b.

---

## Concurrent Guardrail Runner

The concurrent guardrail runner screens each ReAct iteration's generated output
against configurable policies using a fast-slot LLM. It runs **in parallel** with
the primary agent loop and never blocks execution.

### Configuration

The guardrail is configured via an optional `[guardrail]` block in
`exa.config.toml`:

```toml
[guardrail]
enabled = false                         # opt-in, disabled by default
check_interval_iterations = 1           # screen every Nth iteration (1 = every)
screen_final_output = true              # also screen output before Review gate

[[guardrail.policies]]
policy_id = "safety-policy"
description = "Detect harmful content in agent output"
blueprint = "guardrail/safety"
severity = "block"                      # "warn" (logs only) or "block" (halts)
```

### Behaviour

- **Fire-and-forget**: `screen()` is called after each iteration but never
  awaited on the critical path.
- **Fail-open**: If the screening model errors or times out, the error is
  journaled as `guardrail.screen.error` and execution continues.
- **Blocking violations**: A `block`-severity violation halts the loop via the
  Plan Amendment gate (`guardrail_violation` trigger). The pre-execution
  Quality Gate remains the hard gate.
- **Zero overhead when disabled**: With `enabled = false`, no runner is
  constructed and no code path changes.

### Edition

**Team/Enterprise only.** In Solo builds, the guardrail runner is never
constructed even if `enabled = true`. See `ARCHITECTURE.md` for the
architecture overview.

---

### End of User Guide

## 9. Dogfooding & Development

For developers contributing to Exaix itself, see the **[Dogfooding Guide](Exaix_Dogfooding.md)** for a self-hosted workflow using `configs/dogfood.toml`, the daemon lifecycle script, and the bootstrap workflow.
