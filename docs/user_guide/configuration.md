# Configuration

Configuration areas, execution settings and the config commands. Part of the [Exaix User Guide](README.md).

## Config commands

Exaix manages runtime configuration through the **Config DB** (`.exa/config.db`). The `exactl config` command group reads and changes the keys that the packages register with `configurable()`. Run `exactl config show --sources` to see every key with its source. Every option is in the generated [config reference](../cli/config.md).

A key resolves in this order: the Config DB override, the registry default, then the schema default. `exactl config get <key>` prints the effective value and `exactl config unset <key>` removes an override. `exactl config set <key> <value>` validates the value against the bounds of the key and applies rate limiting. `exactl config validate <key>` checks a value without writing it.

Tips:

- **Audit and roll back.** Every change goes into an append-only history. `exactl config history <key>` lists it newest first. `exactl config rollback <key> <id>` restores an older value by history id. `exactl config compact` collapses the history to one row per key.
- **Lock a key you must not change.** `exactl config lock add <key> --reason "<text>"` stops every surface from writing the key: the CLI, MCP and the daemon. `exactl config lock remove` and `exactl config lock list` undo and list locks. Use a lock when a key may be compromised.
- **Keep secrets away from agents.** `exactl config block add "<pattern>" --reason "<text>"` denies matching keys to MCP agents. A lock stops all writers. The blocklist stops MCP writers only.
- **Edit in bulk.** `exactl config edit` opens the overrides as `key=value` lines in `$EDITOR`. The changes pass through the same funnel of lock check, validation and debounce.
- **Group overrides in profiles.** `exactl config set --profile <name> <key> <value>` writes into a named profile. `exactl config profile use <name>` switches to it, and `exactl config get --profile <name> <key>` reads from it.

**Integrity checksum.** The daemon computes a SHA-256 checksum of the effective Config DB at boot and again every 60 seconds by default. A change made outside Exaix, for example with `sqlite3 .exa/config.db`, journals `config.integrity_mismatch`. Read the integrity events with `exactl log list --filter config.integrity_mismatch`. Note that `exactl log verify` checks the hash chain of the activity journal, not the Config DB.

---

## Configuration files

Exaix is designed to be fully configurable without a source change. The configuration file is `exa.config.toml` in your workspace root. The scaffold copies `templates/exa.config.sample.toml` to the workspace as `exa.config.sample.toml`. Copy it to `exa.config.toml` and change the settings you need.

### The "No Magic Values" policy

All timeouts, limits, model names and provider settings come from configuration, not from hardcoded values in the application. Every tunable default is registered with `configurable()` and so shows in `exactl config show`. Do not edit `packages/core/src/types/constants.ts` to change a setting. Set the key instead.

### Key configuration areas

- **[system]:** Workspace paths, logging level and the outbound network allowlist.
- **[watcher]:** File watching settings (debounce, stability check).
- **[models]:** AI provider and model configurations.
- **[agents]:** Agent blueprint settings.
- **[mcp]:** The MCP server name, transport and authentication.
- **[quality_gate]:** Request quality gate thresholds, mode and enrichment behaviour.

```toml
[watcher]
debounce_ms = 200

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

After a change, run `exactl daemon restart` so the daemon reads the new file and fails fast on an invalid one. The sample file documents every setting.

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

- **Live-verified:** Anthropic, OpenAI and Google. Real API calls confirm provider-enforced tool selection end to end.
- **OpenRouter is partly verified.** Tool support depends on the model that OpenRouter routes to, not on OpenRouter itself. Check that the `supported_parameters` of a model include `tools` in the OpenRouter `/api/v1/models` listing before you rely on native tool selection through it.
- Plan-step execution uses ReAct by default. MCP and CLI delegation remain explicit execution capabilities.

#### Model bindings for flow steps

Flow-step bindings, catalog entries and overlays moved to [Model Settings](../Model_Settings.md#model-bindings-for-flow-steps).

#### OpenAI-compatible Chat Completions (`openai-chat`)

The `openai-chat` provider moved to [Model Settings](../Model_Settings.md#openai-compatible-chat-completions-openai-chat).

### Testing & CI Model Aliases

The `models` table aliases moved to [Model Settings](../Model_Settings.md#testing-and-ci-model-aliases).
