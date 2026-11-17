# Getting Started

What Exaix is, key concepts, deploying a workspace, local model setup and first requests. Part of the [Exaix User Guide](README.md).

## Introduction

This guide explains how to deploy and use an Exaix workspace. Unlike the development repository (where the code
lives), a **User Workspace** is where your actual agents, knowledge, and portals reside.

### When to Use Exaix

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

### Key Concepts

- **Request:** What you want the agent to do (markdown file or CLI command).
- **Request Analysis:** A pre-processing step that extracts structured goals, requirements, and constraints from your request. This helps ensure the agent's plan is grounded in your actual intent.
- **Actionability Score:** A 0–100 score indicating if your request is ready for execution. A low score (typically <60) means the request is underspecified or ambiguous.
- **Quality Gate:** An automatic quality check that runs before agent execution. It scores your request and either lets it proceed, auto-enriches it, asks clarifying questions, or rejects it outright if it is too vague to be actionable. See [Request quality gate](requests-plans-reviews.md#request-quality-gate) for full details.
- **Clarification Round:** One turn of the Q&A loop driven by the quality gate. The system asks 3–5 targeted questions; your answers are folded into a refined `IRequestSpecification` that guides the agent.
- **Request Specification (`IRequestSpecification`):** A structured contract produced by the clarification loop. Contains `summary`, `goals`, `successCriteria`, `scope`, `constraints`, and `context` fields. Used as ground truth for evaluation downstream.
- **Complexity:** The system classifies a request as `Simple`, `Medium`, `Complex`, or `Epic` to select the engine that fits the task and its cost.
- **Plan:** Agent's proposal for how to accomplish the request.
- **Approval:** Human review gate before agent executes.
- **Trace ID:** UUID linking everything together for audit.

### How to Improve Your Actionability Score

The **Actionability Score** is a measure of how "grounded" and "specified" your request is. A higher score leads to more accurate plans and fewer agent errors.

#### Strategies for High-Score Requests

1. **Define Explicit Goals:** Instead of "Fix the bug," use "Fix the null pointer exception in `handler.ts` when the user ID is missing."
1. **Reference Specific Files:** Use absolute paths or workspace-relative paths (e.g., `packages/storage-sqlite/src/database_service.ts`). This allows the analyzer to verify the context exists.
1. **Provide Acceptance Criteria:** Use phrases like "The task is complete when..." or "Must pass all unit tests in `tests/`."
1. **Specify Constraints:** Mention any library versions, style guides, or performance requirements (e.g., "Must use Deno.test and maintain < 100ms latency").
1. **Use Markdown Requests:** For complex tasks, create a `.md` file in `Workspace/Requests/` with headers for "Goal," "Context," and "Constraints" instead of a one-line CLI string.

#### Resolving Ambiguity

If `exactl request show` reports an actionability score below 60, look for the **Ambiguities** section in the output. To resolve them:

- **Clarify the Scope:** If the agent is unsure which files to edit, provide the list.
- **Provide Samples:** If the task involves a new format, include a snippet of the desired output.
- **Run `exactl request analyze`:** Use this command to re-run the analysis after you've updated the request description to see if the score improves.

### Quick Request Examples

Submit requests via the CLI to get started quickly:

```bash
# 1. Simple task
exactl request create "Refactor src/utils.ts to use async/await"

# 2. High priority task with specific agent
exactl request create "Audit security in src/api/" --agent security-auditor --priority high

# 3. Task targeting a specific portal
exactl request create "Update README in the MyProject portal" --portal MyProject

# 4. Use a specific model configuration
exactl request create "Generate unit tests for src/math.ts" --model fast

# 5. Analyze a request without executing it
exactl request analyze <request-id> --engine hybrid
```

## Installation & Deployment

### Standard Deployment

From the repository root, run the deploy script to create a user workspace (default: `~/Exaix`):

```bash
deno run -A scripts/deploy_workspace.ts --destination ~/Exaix
```

**What the deploy script does:**

- Creates the standard runtime folders (`System`, `Memory`, `Workspace`, `Portals`).
- Copies runtime artifacts (`deno.json`, `import_map.json`, `scripts/`, `migrations/`, `packages/`, `apps/`) into the target workspace.
- Runs `deno task cache` and `deno task setup` to initialize the database.
- Installs the `exactl` CLI globally to `~/.deno/bin/`. If `EXA_BIN_PATH` is set, it writes an `exactl` shim into that directory instead.

### Post-Deployment Setup

After deployment, ensure `~/.deno/bin` is in your PATH (one-time setup):

```bash
# Add to your shell profile
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Then optionally customize your configuration. The scaffold copies `templates/exa.config.sample.toml` into the workspace as `exa.config.sample.toml`:

```bash
cd /path/to/target-workspace

# Review and customize config (optional)
cp exa.config.sample.toml exa.config.toml
nano exa.config.toml

# Start the daemon
exactl daemon start
```

`deno task start` starts the daemon in the same way.

### Ollama Setup (Local LLM)

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

For one run, set the provider and model in the environment: `EXA_LLM_PROVIDER=ollama EXA_LLM_MODEL=llama3.2 exactl daemon start`. For a permanent setup, add a `[models.local]` entry with `provider = "ollama"` and `model = "llama3.2"` to `exa.config.toml`, and name it in `[agents] default_model`. [Model Settings](model-settings.md) lists the model entries, the variables and the troubleshooting steps for every provider.

**Troubleshooting:**

| Issue                  | Solution                                   |
| ---------------------- | ------------------------------------------ |
| "connection refused"   | Run `ollama serve` to start the service    |
| Slow inference         | Use smaller model or enable GPU support    |
| Out of memory          | Switch to smaller model (3b or 1b variant) |
| GPU not detected (WSL) | Install NVIDIA drivers on Windows host     |

### Cloud LLM Setup (Anthropic, OpenAI, Google)

Setting up cloud providers (API keys, model configuration, provider comparison), enterprise providers, the provider strategy and subscription-billed CLI providers moved to [Model Settings](model-settings.md#cloud-providers-anthropic-openai-google).

### Advanced Deployment Options

Add `--no-run` to `deploy_workspace.ts` to skip the automatic `deno task cache` and `deno task setup`. This is safer in constrained environments. To scaffold only the target layout and copy the templates, run `deno run -A scripts/scaffold.ts <target-dir>`. Then initialize the runtime in the target directory yourself:

```bash
cd <target-dir>
deno task cache
deno task setup
deno task start
```
