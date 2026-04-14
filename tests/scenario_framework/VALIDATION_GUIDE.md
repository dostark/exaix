# Exaix Validation & Scenario Framework Guide

This guide provides step-by-step instructions for setting up a clean validation environment using the Exaix Scenario Framework. It covers everything from initial workspace deployment to executing complex validation scenarios.

---

## 1. Automated Setup (Recommended)

The easiest way to deploy a fully configured validation sandbox is using the automated `setup_sandbox.ts` script. This handles workspace deployment, provider configuration, database initialization, portal mounting, and framework deployment.

```bash
# Navigate to the Exaix repository root
cd "$HOME/git/Exaix"

# Define your sandbox root directory
export EXAIX_VALIDATION_ROOT="$HOME/exa-validation-sandbox"

# Option A: Fast Local Testing (Mock Provider)
# Set up a sandbox locally without making external API calls
deno run -A scripts/setup_sandbox.ts --dir "$EXAIX_VALIDATION_ROOT" --provider "mock" --model "test"

# Option B: Real LLM Validation (Google Gemini Flash)
# To test real agent behaviors, provide your API key and configure the model
export GOOGLE_API_KEY="your-api-key-here"
deno run -A scripts/setup_sandbox.ts --dir "$EXAIX_VALIDATION_ROOT" --provider "google" --model "gemini-1.5-flash"
```

Once the script completes, it will output the necessary environment variables to export to interact with the sandbox.

```bash
# Export the binary path so the sandbox exactl takes precedence
export PATH="$EXAIX_VALIDATION_ROOT/bin:$PATH"

# Export the config path so the daemon uses the sandbox configuration
export EXA_CONFIG_PATH="$EXAIX_VALIDATION_ROOT/workspace/exa.config.toml"

# Set API keys if necessary (e.g., if using a real provider)
# export ANTHROPIC_API_KEY="your-key-here"

# Start the daemon in the background
exactl daemon start
```

---

## 2. Manual Setup (Advanced)

If you need fine-grained control over the deployment process, you can perform the setup manually:

### 2.1. Prepare the Sandbox Environment

Create a dedicated directory for your validation work to ensure isolation from your development environment.

```bash
# Define your sandbox root
export EXAIX_VALIDATION_ROOT="$HOME/exa-validation-sandbox"
export WORKSPACE_DIR="$EXAIX_VALIDATION_ROOT/workspace"
export FRAMEWORK_DIR="$EXAIX_VALIDATION_ROOT/framework"
export EVIDENCE_DIR="$EXAIX_VALIDATION_ROOT/evidence"

# Optional: Install the sandbox exactl binary to a dedicated folder instead of
# overwriting the global ~/.deno/bin/exactl. Downstream steps use EXA_BIN_PATH
# to resolve exactl and EXA_CONFIG_PATH to pin the config file.
export EXA_BIN_PATH="$EXAIX_VALIDATION_ROOT/bin"
export EXA_CONFIG_PATH="$WORKSPACE_DIR/exa.config.toml"

mkdir -p "$EXAIX_VALIDATION_ROOT"
```

### 2.2. Deploy a Clean Exaix Workspace

Deploy a fresh Exaix runtime. This installs the necessary directory structure (`Memory/`, `Blueprints/`, etc.) and system files.

```bash
# From the Exaix repository root.
# If EXA_BIN_PATH is set, the deploy script writes an isolated exactl shim
# to $EXA_BIN_PATH/exactl instead of installing globally. The shim will
# automatically export EXA_CONFIG_PATH so that binary always targets this
# sandbox workspace regardless of the current working directory.
deno run -A ./scripts/deploy_workspace.ts "$WORKSPACE_DIR"

# After deployment, add your sandbox bin folder to PATH so the sandbox
# binary takes precedence in this shell session:
export PATH="$EXA_BIN_PATH:$PATH"
```

### 2.3. Configure the AI/LLM Provider

For real agent validation, you must configure a functional LLM provider.

```bash
# Navigate to the deployed workspace
cd "$WORKSPACE_DIR"

# Initialize your config from the sample
cp exa.config.sample.toml exa.config.toml

# Edit exa.config.toml to set your preferred provider and model
# For example, using Google Gemini Flash:
#   [ai] provider = "google"
#   [ai] model = "gemini-1.5-flash"

# Set your API keys (Replace with your actual keys)
export GOOGLE_API_KEY="your-google-api-key"
# export ANTHROPIC_API_KEY="your-anthropic-api-key"
# export OPENAI_API_KEY="your-openai-api-key"

# Enable paid LLMs for validation if required
export EXA_TEST_ENABLE_PAID_LLM=1
```

### 2.4. Start the Daemon

Ensure the background daemon is running.

```bash
cd "$WORKSPACE_DIR"

# If EXA_BIN_PATH is set the sandbox exactl shim is used; otherwise the
# globally installed exactl is called. EXA_CONFIG_PATH ensures the daemon
# reads the config from this specific sandbox workspace.
exactl daemon start
```

### 2.5. Mount Target Portals

Portals are symlinked repositories that agents will analyze. You should mount the repositories required for your scenarios.

```bash
# Example: Mount the Exaix core repository itself
exactl portal add "$HOME/git/Exaix" portal-exaix

# Verify the mount
exactl portal list

# Restart the daemon to ensure services recognize the new portal
exactl daemon stop
exactl daemon start
```

### 2.6. Deploy the Scenario Framework

Package the validation engine and all test assets (scenarios, fixtures) into your sandbox.

```bash
cd "$HOME/git/Exaix"
./tests/scenario_framework/bin/deploy-framework \
  --destination "$FRAMEWORK_DIR" \
  --workspace "$WORKSPACE_DIR" \
  --output "$EVIDENCE_DIR"
```

## 3. Execute Validation Scenarios

Navigate to your deployed framework and run scenarios. The framework is self-contained and pre-configured to target your sandbox workspace.

```bash
cd "$FRAMEWORK_DIR/scenario_framework"

# 1. Run a Framework Smoke Test (Validates the framework logic itself)
./bin/run-scenarios --scenario framework-smoke-validation --verbose

# 2. Run Agent Flow Validations (Validates Exaix Agent behavior)
./bin/run-scenarios --pack agent_flows --verbose

# 3. Run all Smoke Scenarios
./bin/run-scenarios --tag smoke --verbose
```

For a full list of runner flags (such as filtering by `--mode` or `--profile`), refer to the [CLI Reference in `README.md`](./README.md#running-scenarios-cli-reference).

## 4. Analyzing Results

The framework captures full evidence for every execution.

- **Run Manifest**: Check `${EVIDENCE_DIR}/run_manifest.json` for the overall outcome and per-step status.
- **Evidence Files**: Each step captures stdout/stderr and any generated artifacts (like `_analysis.json`) in `${EVIDENCE_DIR}/scenarios/<scenario-id>/<step-id>/`.
- **Journal**: Inspect the workspace journal at `${WORKSPACE_DIR}/.exa/journal.ndjson` for internal execution traces.

---

## Troubleshooting

- **Daemon Issues**: Check `${WORKSPACE_DIR}/.exa/daemon.log` if the daemon fails to start or process requests.
- **Portal Boundary Errors**: Ensure the `portal-mounted` criterion is passed in your scenario if it depends on external code references.
- **LLM Failures**: Verify your API keys and check that your `exa.config.toml` matches the requirements for the agent being tested.
- **Wrong exactl version**: Run `which exactl` to confirm the binary path. If `EXA_BIN_PATH` is set, ensure `$EXA_BIN_PATH` appears before `~/.deno/bin` in your `$PATH`. If not, re-export: `export PATH="$EXA_BIN_PATH:$PATH"`.
- **Config not found**: If `exactl` cannot find `exa.config.toml`, verify `EXA_CONFIG_PATH` points to the correct file: `echo $EXA_CONFIG_PATH`. The config service checks this variable before falling back to the current working directory.
