# Configuration

Configuration areas, execution settings and the config commands. Part of the [Exaix User Guide](README.md).

## **Config Commands** — Manage Configuration Overrides

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
exactl config show --sources

# Validate a key against its registered schema bounds without writing
exactl config validate ai.timeout_ms
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
exactl config lock add ai.provider --reason "compromised"

# Unlock
exactl config lock remove ai.provider

# List all locked keys
exactl config lock list
```

**Integrity checksum:**

The daemon computes a SHA-256 checksum of the effective Config DB at boot and periodically
(default every 60s). A tampered DB (e.g. `sqlite3 .exa/config.db` outside Exaix) journals
`config.integrity_mismatch`.

```bash
# Verify manually
exactl log verify

# Check the journal for integrity events
exactl log list --filter config.integrity_verified
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
exactl config profile use workstation
exactl config profile list
exactl config get --profile workstation ai.timeout_ms
```

**Hygiene:**

```bash
# Compact the append-only log (collapses to one row per key)
exactl config compact
```

---

## Configuration

Exaix is designed to be fully configurable without modifying source code. The primary configuration file is `exa.config.toml` (located in your workspace root).

### The "No Magic Values" Policy

We enforce a strict "No Magic Values" policy. This means all timeouts, limits, model names, and provider settings are defined in your configuration file, not hardcoded in the application.

- **Defaults:** A `exa.config.sample.toml` is provided with sensible defaults.
- **Customization:** Copy `exa.config.sample.toml` to `exa.config.toml` to override any setting.

### Key Configuration Areas

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
1. **Use `exa.config.sample.toml` as reference** - Contains documented examples for all settings
1. **Validate after changes** - Run `exactl daemon restart` to ensure config is valid

### Environment Variable Reference

Every environment variable that sets a provider, service, transport or model is in [Model Settings](../Model_Settings.md#environment-variables): the provider keys, the `EXA_LLM_*` overrides, the test and live-run variables and the troubleshooting steps.

### Execution Configuration

The `[execution]` section controls how plan steps are executed:

```toml
[execution]
# Enable provider-enforced native tool selection. When true and the configured
# provider supports it, ReAct sends tools through the provider API. Otherwise,
# ReAct uses its TOML action-block format.
# Default: false.
native_tools_enabled = true
```

The daemon's `ReActLoopStrategy` sends a real
`tools[]`/`tool_choice` (or provider-equivalent) parameter to the configured provider's
API, constraining the model to choose from the tools Exaix actually offers. Falls back
to the standard TOML-block prose path when `native_tools_enabled` is false or the provider
does not support native tool selection. ReAct can finish a step in one model turn when it
does not need to call a tool.

**Current scope:**

- **Live-verified**: Anthropic, OpenAI, and Google. Real API calls confirm provider-enforced
  tool selection end-to-end. Google's live verification was confirmed with a standard paid-tier
  run returning `"serviceTier": "standard"` (25 dynamic tool call rows, total cost `$0.1211575`).
- **OpenRouter live status: partly verified.** The OpenRouter live matrix ran five models. In the final run, request analysis passed five of six cases, and planning and ReAct passed 13 of 14. Two cases remain open and are accepted as known failures: the Qwen request-analysis case and one Ling ReAct repeat. The scenario cutover ran on 2026-10-12: the fix-bug cell passed with score 0.986, and a kept-sandbox run on `deepseek/deepseek-v4.1-flash` journaled 33 `dynamic_tool_call` rows (score 0.998). The planning marker cell passed with score 1.000.
- **OpenRouter caveat**: tool support depends on the specific model OpenRouter routes
  to, not on OpenRouter itself — check that a model's `supported_parameters` includes
  `tools` via OpenRouter's `/api/v1/models` endpoint before relying on native tool
  selection through it.
- Plan-step execution uses ReAct by default. MCP and CLI delegation remain explicit execution capabilities.

#### Model bindings for flow steps

Flow-step bindings, catalog entries and overlays moved to [Model Settings](../Model_Settings.md#model-bindings-for-flow-steps).

#### OpenAI-compatible Chat Completions (`openai-chat`)

The `openai-chat` provider moved to [Model Settings](../Model_Settings.md#openai-compatible-chat-completions-openai-chat).

### Testing & CI Model Aliases

The `models` table aliases moved to [Model Settings](../Model_Settings.md#testing-and-ci-model-aliases).
