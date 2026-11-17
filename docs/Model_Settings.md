---
title: "Model settings"
description: "How to choose and configure a provider, service, transport and model: setup, environment variables, bindings, presets and the generated reference tables"
---

# Model Settings

The one place for every way to configure a provider, a service, a transport and a model, in production, in tests and in scenarios. The [reference tables](#reference-tables) at the end are generated from the code, and the rest is written by hand. The [User Guide](Exaix_User_Guide.md) points here. [Model Resolution](Model_Resolution.md) explains how Exaix picks a model for a request.

## Contents

- [Choosing a provider, service, transport and model](#choosing-a-provider-service-transport-and-model)
- [Cloud providers](#cloud-providers-anthropic-openai-google), [enterprise providers](#enterprise-providers-vertex-ai-openrouter), [provider strategy](#provider-strategy) and [subscription CLI providers](#subscription-billed-cli-providers-codex-cli)
- [Team model registry](#team-model-registry-live-catalog)
- [Environment variables](#environment-variables)
- [Model bindings for flow steps](#model-bindings-for-flow-steps) and [`openai-chat`](#openai-compatible-chat-completions-openai-chat)
- [Testing and CI model aliases](#testing-and-ci-model-aliases)
- [Reference tables](#reference-tables), generated from the code

## Choosing a provider, service, transport and model

| Where the run happens          | What chooses the settings, strongest first                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production (daemon and exactl) | The operator binding layers when they exist, see [Model bindings for flow steps](#model-bindings-for-flow-steps). Otherwise `EXA_LLM_PROVIDER` and `EXA_LLM_MODEL`, then the `[ai]` section of `exa.config.toml`, then the built-in `mock` provider. |
| A flow step                    | The `--bind` and `--overlay` options of `exactl request create`, the step binding of the flow and the catalog. `exactl flow bindings <flow>` previews the result.                                                                                    |
| An in-process live test        | `EXA_TEST_BIND`, else the `default` binding of the `live-<service>` row of `tests/configs/model_presets.toml`. The row of the bound service also decides whether the test runs.                                                                      |
| A scenario                     | The preset row that `--cell <tool or provider>` selects. The runner `tests/scenario_framework/runner/main.ts` adds `--overlay <file>` and `--bind <spec>` layers above it.                                                                           |

A key in the environment never starts a billable run. A run starts when its opt-in variable is set and, for a billable service, the key is set. A transport (`cloud` or `local`) and an interface (`api` or `cli`) belong to the service, so choosing a service chooses them. No environment variable sets them alone.

## Cloud providers (Anthropic, OpenAI, Google)

Exaix supports premium cloud models for higher reasoning capabilities. These require API keys and an internet connection.

### API key configuration

Set your API keys as environment variables in your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY="your-key-here"

# OpenAI (GPT)
export OPENAI_API_KEY="your-key-here"

# Google (Gemini)
export GOOGLE_API_KEY="your-key-here"
```

### Model configuration

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
[model_sizes.M]
max_cost_per_mtok = 3
min_context_window = 32000
supports_thinking = true
# Try these providers first, in order, for a size-M request (reason: preferred_list).
candidates = ["anthropic", "ollama"]

# Optional intra-list reorder hints for a given --characteristic.
[model_sizes.M.characteristics]
cheapest = ["ollama"]
```

- Entries are **provider names** (e.g. `anthropic`), not `provider:model` pairs — the resolver
  picks the model for that provider.
- A **local or free** provider (Ollama, or any provider whose endpoint is genuinely $0) is
  **exempt from cost filtering**, so it can win even under a tight budget. An unknown-priced
  model is never treated as "cheapest" — only a genuinely known price qualifies.
- Curate these lists from the CLI instead of editing TOML by hand — see
  [`exactl model candidates` and `exactl model list`](Model_Resolution.md#3-curating-your-preferred-providers).
- **Editions:** the Solo floor is a static, offline catalog. A live catalog and stricter routing arrive with the Team edition, see [Team model registry](#team-model-registry-live-catalog). [Model Resolution](Model_Resolution.md) explains the precedence chain, characteristic scoring, multi-route pricing and cost accuracy.

### Provider comparison

| Provider      | Best For                         | Recommended Model  | Cost |
| ------------- | -------------------------------- | ------------------ | ---- |
| **Anthropic** | Complex reasoning, large context | `claude-opus-4.5`  | $$$  |
| **OpenAI**    | General purpose, speed           | `gpt-5.2-pro`      | $$   |
| **Google**    | Long context, multimodal         | `gemini-3.8-flash` | $$   |
| **Ollama**    | Privacy, zero cost, offline      | `llama3.2`         | Free |

## Enterprise providers (Vertex AI, OpenRouter)

For users who hit free-tier quotas on a paid subscription, or who want one key for many models:

**Google Vertex AI** — uses a Google Cloud **service account** (project-based quotas/billing) instead of a simple API key.

1. Create a GCP project with the Vertex AI API enabled and billing on.
1. Create a service account with the **Vertex AI User** role and download its JSON key.
1. Provide the JSON (single line) via the configured env var, then point a model at the `vertex-ai` provider:

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
model = "~deepseek/deepseek-flash-latest"   # a floating alias; any model from openrouter.ai/models works
```

How Exaix uses OpenRouter:

- **Model capabilities.** Exaix reads each model's entry from `/api/v1/models`. A request with tools to a model that lists no tool support is refused before any chat call. If the catalog lookup fails, the call is not refused, and `openrouter.capability_lookup.failed` is journaled. A failure before the first OpenRouter provider is created is not journaled, because the registry bootstrap has no logger. Journaling starts when a provider is created with one.
- **Context window.** The Solo model registry uses the model's catalog context window after any static override. Providers created by the same factory share the catalog cache. Catalog requests have a five-second limit, separate from the generation timeout. If the lookup is unavailable, the registry uses the provider-level fallback. Metadata reads do not save environment credentials.
- **`require_parameters`.** A request that carries tools, a response format or reasoning sends `provider.require_parameters: true`. OpenRouter then routes only to providers that accept every field. To turn it off, set `[ai_openrouter.routing.provider] require_parameters = false`.
- **Structured output.** A schema that `json_schema` can represent strictly uses `json_schema`. Any other schema uses `json_object`, with the schema in the prompt. If a route refuses `json_schema`, Exaix retries once with `json_object`. Every reply is validated locally, and an invalid reply fails closed.
- **Thinking.** With thinking off, Exaix sends `reasoning.enabled: false` for models whose reasoning is optional. A model whose reasoning cannot be turned off receives its lowest listed effort. A response cut off at the token limit raises a typed truncation error.
- **Prompt caching.** Exaix adds `cache_control` breakpoints only for the models that OpenRouter's prompt-caching guide lists. To turn breakpoints off, set `[ai_openrouter] cache_control = false`. On some routes a cache write costs more than a plain input token, so a one-shot prompt can cost more.
- **Routing.** `[ai_openrouter.routing]` passes through up to three fallback `models`, and the `provider` fields `order`, `only`, `ignore`, `sort`, `allow_fallbacks`, `quantizations`, `max_price`, `zdr` and `data_collection`.
- **Replay.** Replayed assistant messages carry `reasoning_details` unchanged. `reasoning_content` is not sent.
- **Selection.** Price ranking, size presets, thinking and effort use the selected model's catalog data before provider-level values. An unknown price cannot win "cheapest" over a known price. For OpenRouter, an unavailable catalog leaves the price, window and reasoning capability unknown; no global model guesses are supplied. An unknown cost passes the size-preset cost filter, and an unknown window passes only for a provider with a catalog lookup, while unknown prices rank behind known prices for "cheapest".
- **Cost.** `usage.cost` is retained as reported USD, including a reported zero. When it is absent, ReAct can estimate the cost from measured tokens and the model's catalog prices. The estimate stays labeled `predicted`. Prompt previews use the catalog input price without inventing output tokens.

The adapter's modules are listed in [packages/ai-openrouter/README.md](../packages/ai-openrouter/README.md).

Per-model caveats:

- Tool support depends on the model's catalog entry, not on OpenRouter.
- A model with mandatory reasoning, such as `z-ai/glm-5.3-flash`, cannot turn reasoning off.
- A model that lists reasoning but no effort levels receives `enabled: false` when thinking is off.
- `qwen/qwen3.7-flash` is not in the caching list, so it receives no breakpoint.
- A floating alias such as `~deepseek/deepseek-flash-latest` can resolve to a different model over time. The response records the resolved model id.

## Provider strategy

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

## Subscription-billed CLI providers (codex-cli)

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

1. Point a model at the `codex-cli` provider:

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
- Fresh calls with a closed, flat output schema use Codex's native schema enforcement.
  Single-criterion evaluation judges use this path to return a numeric score,
  reasoning, issues, and a pass/fail result. Unsupported schemas and resumed calls
  warn when native enforcement is unavailable; callers still validate returned data.
- Every call runs with `--sandbox read-only`, so `codex-cli` calls never write to your
  filesystem — the same read-only posture Exaix already enforces for headless CLI-delegate
  planning calls.
- **CLI providers do not receive native Exaix tool definitions.**
  `codex-cli`/`claude-cli`/`opencode-cli` do not advertise `supportsNativeTools`.
  A forced Exaix ReAct step instead describes available `ToolRegistry` tools and
  the text action format in its prompt. Exaix executes any parsed action that
  passes the role's `permitted_tools` check. A live Codex CLI run called
  `query_symbols` through this text path when its request specified the TOML
  action; tool choice from an unsteered CLI response is not guaranteed. The
  CLI's own native tools remain separate. Direct-API providers can receive
  native Exaix tool definitions when `native_tools_enabled` is on; a
  `[cli_delegate]` step hands the whole task to the CLI's own loop (see §2.5a
  and the flow-strategy guidance).

`[session_delegate] tool = "codex"` (Mode 3 headless session delegation) is a **separate**
Codex integration path with its own sandbox model — see
[§2.5.7](user_guide/session-delegation.md#codex-sandbox-and-permitted-path-security). This subsection covers only the
ReAct-loop analysis/planning provider above.

## Team model registry (live catalog)

The Team edition can keep its model catalog current. It is off by default, and with it off Team behaves exactly like Solo. [Model Resolution](Model_Resolution.md#5-the-team-live-catalog) explains what each setting does. The `[model_registry]` block sets it up:

Top-level keys must come before any `[model_registry.*]` sub-table (standard TOML ordering):

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

> **Data license note (Team benchmark ingest):** `model_registry.benchmark_source` pulls
> community-maintained scores from [models.dev](https://models.dev/), which is MIT-licensed —
> confirmed safe to ingest and redistribute as advisory scoring data.

## Environment variables

Environment variables set API authentication, the runtime overrides of the provider and model, and the opt-ins of live runs. [Reference tables](#reference-tables) list every key, opt-in and override variable with the services, preset rows and scenarios that use it.

### Provider API keys

Cloud providers require API keys set as environment variables. [Keys and opt-ins](#keys-and-opt-ins) names the variable of every service, including DeepSeek, OpenRouter and OpenCode Go.

**Setup (permanent):**

```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export ANTHROPIC_API_KEY="your-key-here"' >> ~/.bashrc
echo 'export OPENAI_API_KEY="your-key-here"' >> ~/.bashrc
echo 'export GOOGLE_API_KEY="your-key-here"' >> ~/.bashrc
source ~/.bashrc
```

### Runtime configuration overrides

Four environment variables override the default AI provider and model: `EXA_LLM_PROVIDER`, `EXA_LLM_MODEL`, `EXA_LLM_BASE_URL` (the older name is `EXA_LLM_ENDPOINT`) and `EXA_LLM_TIMEOUT_MS`. [Other variables](#other-variables) states the effect of each. Restart the daemon after you change one.

**Usage Example:**

```bash
# Temporarily use local Ollama for a single request
EXA_LLM_PROVIDER=ollama EXA_LLM_MODEL=llama3.2 exactl request create "Explain the codebase"

# Set for the current session
export EXA_LLM_PROVIDER=anthropic
export EXA_LLM_MODEL=claude-opus-4.5
exactl daemon start
```

**Precedence:** Without an operator binding layer, `EXA_LLM_PROVIDER` and `EXA_LLM_MODEL` take precedence over the `[ai]` section of `exa.config.toml`, which takes precedence over the built-in `mock` default. With an operator binding layer, flow steps ignore all `EXA_LLM_*` variables. The binding lock records whether `EXA_LLM_PROVIDER` or `EXA_LLM_MODEL` was set and ignored.

**Validation:** These variables have no Zod schema. An unknown `EXA_LLM_PROVIDER` logs a warning and falls back to `mock`. `EXA_LLM_TIMEOUT_MS` accepts any integer, including values below 1000.

**Best Practice:** Use `exa.config.toml` for persistent configuration. Use environment variables for temporary overrides or testing different providers.

### Test and live-run variables

The live tests bind their provider and model with `EXA_TEST_BIND`. `EXA_TEST_ENABLE_PAID_LLM` is the paid-call opt-in, and `EXA_TEST_LLM_MODEL` is the model of the provider tests. [Live-test rows](#live-test-rows) lists what each row needs.

**Live runs are configured and gated by cell presets.** A live test reads the `live-<service>` row of `tests/configs/model_presets.toml` that names its service, through `tests/helpers/live_presets.ts`. The row gives the binding, the `catalog` entries (service, transport, endpoint, models) and the `requires_bin`, `requires_key` and `requires_optin` predicates, so a test and a scenario cell skip for the same named reason. A test that cannot run prints that reason, for example `opt-in env 'EXA_TEST_ENABLE_PAID_LLM' is unset`, and is reported as ignored. A new live service is a new row.

A key in the environment never starts a run. An opt-in variable counts when it is non-empty, and CI jobs never set it. An opted-in local run expects a working server, so a missing server or model fails the test and names the step that fixes it. Choose the provider with `EXA_TEST_BIND` (the `--bind` layer), which also changes which preset gates the run: the preset of the bound service decides. `exactl eval run --cell <tool or provider>` selects a scenario row. The runner `tests/scenario_framework/runner/main.ts` adds `--overlay` and `--bind` layers, as in [Evaluation](Exaix_Evaluation.md). `tests/integration/live_gating_guard_test.ts` fails when a test reads an opt-in variable or a provider key by its own code.

**Live runs on the Codex CLI.** Run `EXA_MATRIX_CODEX=1 EXA_TEST_BIND='default=service=codex-cli,service_model_id=gpt-5.6-terra' deno test --allow-all <test file>` with `codex` on `PATH` and logged in. A CLI service binds as a generate provider, in the way a judge does, and it needs no key. Each call starts a `codex exec` process, so the provider budget is 300000 ms. Codex is an agent that uses its own tools, so a test that asserts which Exaix tool the model chooses, or that needs native tool calls, does not apply to it. Those tests (symbol query, native tool rounds and memory maturation) skip with the reason `codex-cli is a CLI agent that runs its own tools`. The ReAct loop test and the extraction quality test run.

**Live-test defaults:** The ReAct and extractor live tests use the `live-deepseek` row (`deepseek-v4-pro`). The memory maturation live test uses the `live-opencode-go` row (`deepseek-v4.1-flash` at `https://opencode.ai/inference/go/openai/v1/chat/completions`), which declares its own service. The native-round replay test uses the DeepSeek row by default. Set `EXA_TEST_BIND` to select the Google row (`gemini-3.8-flash`) instead. It runs only with `EXA_TEST_ENABLE_PAID_LLM=1` and `GOOGLE_API_KEY`.

**CI Safety:** In test or CI mode, the daemon refuses to boot a billable provider unless `EXA_TEST_ENABLE_PAID_LLM=1`. Configured fallback chains are exempt. Test mode is set by `EXA_TEST_MODE` or `EXA_TEST_CLI_MODE=1`. CI mode is set by `EXA_CI_MODE`, or by `CI` when `EXA_CI_MODE` is unset. Never set `EXA_TEST_ENABLE_PAID_LLM=1` in CI jobs unless the run is on a trusted branch with properly stored secrets.

**Usage Example:**

```bash
# Manual OpenAI integration test (opt-in, calls the real API)
export EXA_TEST_ENABLE_PAID_LLM=1
export OPENAI_API_KEY="sk-..."
deno test --allow-all tests/integration/llm_free_provider_test.ts

# ReAct live test: DeepSeek by default
export DEEPSEEK_API_KEY="..."
deno test --allow-all packages/execution/tests/agents/react_loop_strategy_live_test.ts

# Local Ollama live check (a server must run and the model must be pulled)
EXA_MATRIX_OLLAMA=1 deno test --allow-all tests/integration/ollama_chat_live_test.ts

# The same test bound to an OpenAI model
export EXA_TEST_BIND='default=service=openai,service_model_id=gpt-5-mini'
export OPENAI_API_KEY="..."
deno test --allow-all packages/execution/tests/agents/react_loop_strategy_live_test.ts
```

### Troubleshooting environment variables

**Provider or endpoint not taking effect:**

1. **Variable name is spelled exactly** (case-sensitive)
1. **Provider name is a `ProviderType` value:** `ollama`, `anthropic`, `openai`, `google`, `vertex-ai`, `openrouter`, `mock`, `llamacpp`, `claude-cli`, `opencode-cli`, `codex-cli`, `openai-chat`. An unknown name falls back to `mock`.
1. **URL includes the protocol** (`http://` or `https://`). `EXA_LLM_BASE_URL` is used as given, so check it before the first request.
1. **Timeout is an integer in milliseconds.** It is not range-checked.

**Environment variables not taking effect:**

1. **Restart the daemon** after setting env vars: `exactl daemon restart`
1. **Check the daemon logs** to see which values were loaded: `exactl daemon logs`
1. **Verify the variable is set** in the daemon's environment: `env | grep EXA_LLM`

For more details, see `templates/exa.config.sample.toml` and [Technical Specification](../exaix-dev-docs/dev/Exaix_Technical_Spec.md).

## Model bindings for flow steps

A binding selects the **service** that serves a canonical **model** from a **model provider**,
through a `cloud` or `local` **transport** and an `api` or `cli` **interface**. A service can
publish a different `service_model_id` for that model. Binding fields are optional: a layer
sets only the fields it names, and other fields come from lower layers or the catalog.
`effort` and `thinking` also bind per step; their effective values are checked against the
selected provider and model before generation. With no active binding layer, flows use
the daemon's boot provider as before. Non-flow requests keep their existing provider path.

Add catalog entries and selectors to `exa.config.toml`:

```toml
[system]
root = "/home/user/Exaix"

[catalog.models."openai/compat-fixture-v1"]
model_provider = "openai"
capabilities = []

[catalog.services.compat-fixture]
adapter = "openai-chat"
profile = "local-test"
endpoint = "http://127.0.0.1:8000/v1/chat/completions"
allow_insecure_loopback = true
transport = "local"
interface = "api"
key_env = "EXA_COMPAT_TEST_API_KEY"
serves = { "openai/compat-fixture-v1" = "compat-fixture-v1" }

[catalog.preferences]
openai = ["compat-fixture"]

[bindings]
"flow:research/step:explore-*" = { model = "openai/compat-fixture-v1", transport = "local" }
```

`[catalog.models."provider/model"]` declares model ownership, optional `context_window`,
and `capabilities` (`native_tools`, `thinking`, `effort`). `[catalog.services.<id>]` declares
the adapter, optional qualified `profile` and `endpoint`, `transport`, `interface`, optional
`key_env`, `requires_optin`, `tool`, `daily_cost_cap_usd`, and `serves` mapping from canonical
model to service model ID. `[catalog.preferences]` orders services for each model provider.
The sample uses the `local-test` fixture profile: HTTP is allowed only on private loopback
with `allow_insecure_loopback = true`. Production `openai-chat` bindings support the qualified
`openai` and `deepseek` HTTPS profiles; arbitrary compatible endpoints are not qualified.
Use an adapter-matching `key_env`. API key lookup checks the daemon environment, then the
credential store. `requires_optin` must be present with value `1` in the daemon environment.

Selectors in `[bindings]` and overlays are `default`, `role:<agent-role>`, `flow:<flow-id>`,
and `flow:<flow-id>/step:<step-id-or-glob>`. `judge` and `judge:<role>` parse now, but their
resolver path is not part of flow bindings yet; use an exact gate step selector for a gate judge here.
Within one layer, a more specific selector wins a field; equal-specificity matching globs
with the same literal prefix are rejected as ambiguous. Layers apply per field from low to
high priority: flow YAML `binding:`, config `[bindings]`, daemon overlay, per-run overlay,
then `--bind`. A model-only entry can use catalog preferences to pick its service; a
transport/interface-only entry can inherit a uniquely projected `[ai]` default model.

In the scenario runner, a run that carries overlays, judges or pins writes a binding-evidence
file for every pack, not only `provider_live`. The file is keyed by scenario and trial, and each
judge row names the `requestStepId` it resolved against, so a judge uses the same ordered overlay
list as the request it grades. A run refused before the daemon starts writes a refusal record with
`outcome: "refused"` and `qualified: false` instead of nothing. A bound CLI judge's timeout follows
its transport adapter, so a `claude-cli` service serving a cloud-owned model still gets the CLI
subprocess timeout.

Place a versioned JSON or TOML overlay in `.exa/overlays/` under `system.root` to affect
later runs. Daemon overlays load in lexical filename order. A JSON overlay looks like this:

```json
{
  "schema": 1,
  "bindings": {
    "flow:research/step:explore-*": { "model": "deepseek/deepseek-v4-pro" }
  }
}
```

For one run, pass a JSON or TOML overlay to `exactl request create --flow research --overlay
<overlay-file> "Explore the issue"`; `--overlay` is repeatable. The CLI parses a file
as TOML when its name ends in `.toml` and as JSON otherwise. Add `--bind
'flow:research/step:explore-1=model=deepseek/deepseek-v4-pro,service=openai-chat'` for an
inline, repeatable override. `--bind` takes `selector=field=value[,field=value]`; choose
strings for its fields. `exactl flow bindings research --overlay <overlay-file> --json`
previews the effective fields, sources, and validation issues without running the flow.
`exactl request create --file <request.md>` accepts the same flags. The CLI writes a per-run
operator file under `.exa/run-bindings/` before writing the request; the daemon claims it
only when trace ID, request path, and request SHA-256 match. Request frontmatter cannot
supply a binding. A repeated claim for the same request is allowed for resume.
A per-run overlay, `--bind` or `--locked` needs no other binding layer. The daemon applies
it even with no `[bindings]`, no `.exa/overlays/` directory and no flow `binding:`, because
the run file for the request activates the binding setup.

Binding and overlay changes are read at each flow run, so they need no daemon restart.
The daemon's network grant is calculated from configured catalog hosts at startup when
`system.allow_net` is unset. A later overlay that names a new host fails with
`needs_restart`: add the host to the startup catalog and restart the daemon. When
`system.allow_net` is explicit, its host list is authoritative; an outside host fails
with `host_not_allowed`. Local endpoints must pass the private/loopback check.
Changing an environment variable in a running daemon still requires a restart.

A binding run resolves and validates all LLM-calling steps before the first LLM call and
writes a snapshot lock under `.exa/bindings/` (`<trace-id>.lock.json`). Use `exactl request create
--flow research --locked <lock-file> "Repeat the run"` to replay it. The lock records
resolved identities, source layers, catalog/config/overlay checksums, and whether
`EXA_LLM_PROVIDER` or `EXA_LLM_MODEL` was ignored. These boot-time variables never
override a bound step. `--locked` compares the lock's flow content, step pins, catalog and
every resolved binding (service, adapter, model, effort and sources) with the current
resolution. Any difference fails the run with `lock_mismatch` before the first LLM call.
`exactl request create` also records a SHA-256 of the lock's parsed content, so whitespace and a trailing newline do not matter, and the daemon refuses a lock whose content no longer matches it. A trace ID has one lock: a second run with the same trace reuses
it only when the resolution is equal, and a different resolution fails with `lock_mismatch`.
The `binding.snapshot.created` event carries the lock path and hash, `hosts` (the endpoint
`host:port` of each bound service), `env_ignored`, the config and overlay checksums, the
run overlay count and `replayed` (true for a `--locked` run).
A bound step whose service names a key variable fails with `key_missing` before any call
when no key is available, and a key stored or rotated after the daemon started is used by
the next run. The daemon keeps one provider per distinct binding for the runs that hold it,
frees it when the run ends (`binding.run.released` reports the counts), and closes evicted
providers. Unbound paths retain the boot provider. A flow step with `strategy: cli_delegate` uses
the session tool binding (`claude-code`, `codex`, or `opencode`); the generate-backed
`claude-cli`, `codex-cli`, and `opencode-cli` services instead provide one `generate()`
call at a time. A session delegate cycle uses its session tool binding; a gate judge
needs a generate-backed binding rather than a `cli_delegate` session.

Flow authors may pin `service`, `model_provider`, `model`, `service_model_id`, `transport`,
or `interface` on a step, with reason `provider-qualification`, `wire-compat-regression`,
`pricing-table`, `capability-gate`, or `compliance`. An exact conflicting operator step
binding fails with `pinned`; a broader override leaves the flow value and records
`pin_kept` in the field source. `effort` and `thinking` cannot be pinned. With any operator
binding layer active, the configured daily maximum is a **global** cap across bound
services; a service's `daily_cost_cap_usd` applies in addition. Cloud cost admission uses
an atomic reservation keyed by service and transport, while local transport is excluded
from paid usage. A missing usable price under a finite cap fails with
`pricing_unavailable` before a paid call.

Binding issues are reported by `exactl flow bindings` and fail the flow preflight:

| Code                           | Meaning                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `overlay_invalid`              | Overlay or one-off binding is malformed.                      |
| `ambiguous_selector`           | Equally specific selectors conflict.                          |
| `unknown_model`                | Canonical model is absent from the catalog.                   |
| `unknown_service`              | Named service is absent.                                      |
| `service_does_not_serve_model` | Service does not map the model.                               |
| `no_service_for_constraints`   | No service satisfies the partial fields.                      |
| `capability_missing`           | Model lacks a required capability.                            |
| `interface_unsupported`        | Interface and execution strategy do not fit.                  |
| `key_missing`                  | No API key is available from environment or credential store. |
| `optin_missing`                | Required opt-in environment variable is not set to `1`.       |
| `endpoint_invalid`             | Endpoint fails the service/profile rules.                     |
| `local_host_not_private`       | Local endpoint host is not private or loopback.               |
| `host_not_allowed`             | Explicit network grant does not include the host.             |
| `needs_restart`                | New host needs a new start-time grant.                        |
| `pricing_unavailable`          | Finite paid budget has no usable price.                       |
| `pinned`                       | Exact override conflicts with a pinned flow value.            |
| `lock_mismatch`                | Replay inputs differ from the saved lock.                     |

The implementation contract is tracked in the [flow-step model bindings plan](../exaix-dev-docs/planning/phase-204-flow-step-model-bindings.md#step-10--documentation).

## OpenAI-compatible Chat Completions (`openai-chat`)

The `openai-chat` provider talks to a Chat Completions endpoint through one shared client. Two
qualified remote profiles ship, a loopback fixture profile for tests, and a `self-hosted` profile for
a server you run yourself. Exaix does **not** claim support for arbitrary compatible providers: only
the `openai` and `deepseek` profiles are qualified, and `self-hosted` is a declared-endpoint profile
you qualify against your own server.

| Profile       | Preset                               | Model                      | Endpoint host              | Secret variable                             |
| ------------- | ------------------------------------ | -------------------------- | -------------------------- | ------------------------------------------- |
| `openai`      | `tests/configs/openai-chat.toml`     | `gpt-6-luna` (pinned)      | `api.openai.com`           | `OPENAI_API_KEY`                            |
| `deepseek`    | `tests/configs/deepseek-chat.toml`   | `deepseek-v4-pro` (pinned) | `api.deepseek.com`         | `DEEPSEEK_API_KEY`                          |
| `self-hosted` | none (declared by a catalog service) | the service's own model    | the service's own endpoint | `EXA_COMPAT_SELF_HOSTED_API_KEY` (optional) |

Copy a preset, or set the keys yourself:

```toml
[system]
allow_net = ["api.openai.com"]

[ai]
provider = "openai-chat"
model = "gpt-6-luna"

[ai.compatible]
profile = "openai"

[models.default]
provider = "openai-chat"
model = "gpt-6-luna"
timeout_ms = 60000

[agents]
default_model = "default"

[execution]
native_tools_enabled = true
```

`[ai.compatible]` keys (a named `[models.*]` entry may carry its own `compatible` block, and unset
fields inherit from the global block only for the same profile):

| Key                       | Default          | Meaning                                                         |
| ------------------------- | ---------------- | --------------------------------------------------------------- |
| `profile`                 | none, required   | `openai`, `deepseek`, `local-test` or `self-hosted`             |
| `endpoint`                | profile endpoint | Must match the profile host. Remote profiles accept HTTPS only  |
| `allow_insecure_loopback` | `false`          | `local-test` and `self-hosted` may use a loopback HTTP endpoint |
| `supports_tool_choice`    | `false`          | `self-hosted` only: the server honors an explicit `tool_choice` |
| `key_env`                 | none             | `self-hosted` only: the service's own required key variable     |
| `headers`                 | none             | `self-hosted` only: up to 8 extra request headers (see below)   |
| `max_response_bytes`      | 8 MiB            | Largest accepted response body                                  |
| `max_tool_argument_bytes` | 64 KiB           | Largest accepted tool-call argument object                      |
| `max_history_bytes`       | 8 MiB            | Largest accepted replayed conversation                          |

A limits-only global block is inherited by every `openai-chat` model that sets the same profile. A
named model can override one field, including an explicit `false`, and a finite daily budget needs a
registered rate for the returned model:

```toml
[system]
allow_net = ["api.deepseek.com"]

[ai.compatible]
profile = "deepseek"
max_response_bytes = 4194304

[models.default]
provider = "openai-chat"
model = "deepseek-v4-pro"

[models.strict]
provider = "openai-chat"
model = "deepseek-v4-pro"

[models.strict.compatible]
profile = "deepseek"
allow_insecure_loopback = false
max_history_bytes = 2097152

[rate_limiting]
max_cost_per_day = 5.0
```

**Self-hosted services (vLLM, LiteLLM, Ollama).** A `self-hosted` service declares its own endpoint
and model, so it pins neither. `CompatibleChatFieldsSchema.profile` admits it, and the schema requires
both `endpoint` and `model` for it and rejects `supports_tool_choice` and `headers` on any other profile.
The endpoint must use HTTPS (plain HTTP only on loopback with `allow_insecure_loopback`), carry no user
info, query or fragment, and its path must end with `/chat/completions`.

A service that needs extra request headers declares them in `headers`, for example
`headers = { x-opencode-session = "{session_id}" }` for OpenCode Go, which rejects a request without a session
header. A name is lowercase `x-…` or `user-agent`, and never carries a credential (keys go through `key_env`).
A value is printable ASCII of at most 256 characters, and the token `{session_id}` becomes one stable id for
each provider instance. Declare it
as a catalog service in a per-run overlay, for example for a vLLM server:

```json
{
  "schema": 1,
  "catalog": {
    "services": {
      "vllm-local": {
        "adapter": "openai-chat",
        "profile": "self-hosted",
        "endpoint": "http://127.0.0.1:8000/v1/chat/completions",
        "allow_insecure_loopback": true,
        "supports_tool_choice": false,
        "transport": "local",
        "interface": "api",
        "serves": { "meta/llama3.1:8b": "llama3.1:8b" }
      }
    },
    "models": { "meta/llama3.1:8b": { "model_provider": "meta", "capabilities": ["native_tools"] } }
  },
  "bindings": {
    "flow:research/step:explore-*": { "service": "vllm-local", "model": "meta/llama3.1:8b" }
  }
}
```

Run it with `exactl request create --flow research --overlay <overlay-file> "..."`. LiteLLM uses the same
shape with its `model_name` alias in `serves` and an HTTPS endpoint. Ollama ships as the built-in
`ollama-chat` service on `http://127.0.0.1:11434`, with the loopback opt-in already declared: select
it by an explicit `service = "ollama-chat"` binding, because no `meta` or `qwen` preference route
exists, and pull the model first.

- **Endpoint rule.** The endpoint must be HTTPS, or HTTP on `127.0.0.1` with `allow_insecure_loopback = true`.
  The path must be `/v1/chat/completions` or `/chat/completions`, and the URL may carry no credentials,
  query or fragment. A violation fails with `profile_mismatch`.
- **Key.** A service that declares `key_env` sends only that variable's key. The key is required, and it
  is read from the daemon environment, then the credential store. A service without `key_env` reads the
  optional shared `EXA_COMPAT_SELF_HOSTED_API_KEY` from the daemon environment only, and without it the
  request carries no `Authorization` header. Give each keyed server its own `key_env`, so one server's key
  never reaches another.
- **Tool choice.** `supports_tool_choice` defaults to false. The provider then sends `tools` but no
  `tool_choice` (`IProviderCallCapabilities.supportsToolChoice` is false), which suits Ollama. Set it to
  `true` for a vLLM server started with `--enable-auto-tool-choice` and `--tool-call-parser`, or a
  LiteLLM upstream that supports it.
- **Cost.** A `self-hosted` call is unpriced: it records a null cost with `cost_status: unknown` and passes
  the default `[rate_limiting]` check without `pricing_unavailable`.
- **Network.** A service introduced by a run-time overlay is not in the daemon's start-time `--allow-net`
  grant. Put its host in `system.allow_net` of the base config, or the run fails with `needs_restart`.

Switching `profile` resets the endpoint and loopback grant, so a local endpoint never carries over
to a remote profile. A missing profile or a missing registration fails before the provider is built. It never
falls back to the mock provider.

**Secrets and network.** The key comes from the daemon's own environment and never from the preset.
`exactl daemon start` grants network access from `system.allow_net`, so a DeepSeek deployment must
list `api.deepseek.com`. Without the host, provider creation fails with `net_permission_denied`. The
`deno task start:fg` script grants only `EXA_`, `HOME` and `USER` environment variables and a fixed
host list. For a remote profile, add the secret variable to its `--allow-env` list and the endpoint
host to its `--allow-net` list, or the provider fails with `env_permission_denied` or
`net_permission_denied`.

**Behavior.**

- With `native_tools_enabled = true` the provider receives real `tools[]` and runs one tool call
  per round. A response that carries more than one tool call is rejected before any tool runs, and
  Exaix never drops the extra calls. Parallel tool-call batches are not supported. DeepSeek cannot forbid
  parallel calls, so a live DeepSeek run can still hit that rejection. With the flag off, ReAct uses
  the TOML action-block path.
- Planning uses strict `json_schema` output on `openai` when the schema allows it. `deepseek` always
  uses `json_object` mode plus a schema instruction, and Exaix validates the result locally. In
  strict mode, nested optional nulls introduced by the provider schema are removed through local
  references and applicable `anyOf` branches. Nulls permitted by the original schema remain.
- `deepseek` supports explicit thinking (`--thinking true`) and replays `reasoning_content` across
  tool rounds. The pinned `openai` model rejects unsupported explicit effort or `thinking: true`
  with `unsupported_call_option`; `thinking: false` is omitted from its request. DeepSeek sends
  supported enabled or disabled thinking controls.
- Native dynamic rounds check section and total input limits before sending a request. The
  objective and original input count toward `plan`, prior turns and round control toward
  `loopHistory`, and instructions and tool framing toward `system`. The resolved output token
  allowance is reserved even when a caller did not inject an allocator. Overflow emits a traced
  `ContextBudgetExceeded` event and stops before provider I/O or another tool effect.
- One deadline (`timeout_ms`) bounds each provider call. A malformed, oversized
  or unadvertised response fails with `protocol_invalid`.
- Cost comes from registered rates for the exact returned model. An unknown rate records a null cost
  with `cost_status: unknown`. With a finite `rate_limiting.max_cost_per_day`, a remote call with no
  registered rate fails with `pricing_unavailable` before any request is sent. Registered
  `deepseek-v4-pro` rates are the peak-hour rates, so DeepSeek estimates are an upper bound.
- Fixture capture (`EXA_CAPTURE_FIXTURES_DIR`) is rejected for this provider with `capture_unsupported`.

**Failure reasons.** Failures carry one of these allowlisted reason codes and never include prompts,
keys or tool contents:

| Code                      | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `credential_missing`      | The secret variable for the profile is unset                              |
| `env_permission_denied`   | The daemon may not read the secret variable                               |
| `net_permission_denied`   | The daemon may not reach the profile host                                 |
| `profile_mismatch`        | The endpoint, model or key does not match the profile                     |
| `registration_missing`    | The `openai-chat` provider is not registered                              |
| `paid_provider_blocked`   | A test/CI daemon boot selected a billable provider without opt-in         |
| `capture_unsupported`     | Fixture capture is enabled for this provider                              |
| `unsupported_call_option` | A call asked for an effort or thinking option the profile cannot honor    |
| `pricing_unavailable`     | A finite cost budget is set and the returned model has no registered rate |
| `protocol_invalid`        | The response was malformed, oversized, multi-call or unadvertised         |

**Live qualification.** The `openai` profile passed a live scenario on 2026-09-28, and the `deepseek`
profile (`deepseek-v4-pro`) passed eight consecutive live runs on 2026-09-29. Live runs still fail
rarely. DeepSeek cannot forbid parallel tool calls, so a multi-call reply is rejected, and the final
planning round can return an empty reply or a plan that violates the schema. Exaix does not retry
those. Unit and fixture tests never prove live compatibility.

## Testing and CI model aliases

The `models` table in `exa.config.toml` defines named model entries. Exaix does not predefine any entries. The example below defines two entries that suit CI and manual testing:

```toml
[models.ci_safe]
provider = "mock"
model = "mock"

[models.local_cheaper]
provider = "openai"
model = "gpt-5-mini"
```

- **`ci_safe`** — Uses the `mock` provider, so it makes no API call and costs nothing. Exaix does not select it automatically. A flow, test or command must name it.
- **`local_cheaper`** — Uses the `openai` provider with the `gpt-5-mini` model. It calls the real OpenAI API and is billed to `OPENAI_API_KEY`.

The paid-provider guard does not read these entries. It applies to billable providers in test or CI mode, as described in section 5.3.3.

## Reference tables

The tables of this section are generated by `deno task docs:models` from the binding catalog, the rows of `tests/configs/model_presets.toml` and the scenario files. Do not edit between the markers.

### Services

Each service fixes its transport and interface. The built-in services come from `packages/model-registry/src/binding_catalog.ts`. The `live-*` rows of `tests/configs/model_presets.toml` add the others, such as `opencode-go`.

<!-- model-settings:services:start -->

| Service        | Adapter        | Transport | Interface | Key variable         | Opt-in variable | Endpoint                                                      |
| -------------- | -------------- | --------- | --------- | -------------------- | --------------- | ------------------------------------------------------------- |
| `anthropic`    | `anthropic`    | `cloud`   | `api`     | `ANTHROPIC_API_KEY`  | -               | -                                                             |
| `claude-cli`   | `claude-cli`   | `local`   | `cli`     | -                    | -               | -                                                             |
| `claude-code`  | `cli-delegate` | `local`   | `cli`     | -                    | -               | -                                                             |
| `codex`        | `cli-delegate` | `local`   | `cli`     | -                    | -               | -                                                             |
| `codex-cli`    | `codex-cli`    | `local`   | `cli`     | -                    | -               | -                                                             |
| `deepseek`     | `openai-chat`  | `cloud`   | `api`     | `DEEPSEEK_API_KEY`   | -               | `https://api.deepseek.com/v1/chat/completions`                |
| `google`       | `google`       | `cloud`   | `api`     | `GOOGLE_API_KEY`     | -               | -                                                             |
| `mock`         | `mock`         | `local`   | `api`     | -                    | -               | -                                                             |
| `ollama-chat`  | `openai-chat`  | `local`   | `api`     | -                    | -               | `http://127.0.0.1:11434/v1/chat/completions`                  |
| `openai`       | `openai`       | `cloud`   | `api`     | `OPENAI_API_KEY`     | -               | -                                                             |
| `openai-chat`  | `openai-chat`  | `cloud`   | `api`     | `OPENAI_API_KEY`     | -               | `https://api.openai.com/v1/chat/completions`                  |
| `opencode`     | `cli-delegate` | `local`   | `cli`     | -                    | -               | -                                                             |
| `opencode-cli` | `opencode-cli` | `local`   | `cli`     | -                    | -               | -                                                             |
| `opencode-go`  | `openai-chat`  | `cloud`   | `api`     | `OPENCODE_API_KEY`   | -               | `https://opencode.ai/inference/go/openai/v1/chat/completions` |
| `openrouter`   | `openrouter`   | `cloud`   | `api`     | `OPENROUTER_API_KEY` | -               | -                                                             |

<!-- model-settings:services:end -->

### Keys and opt-ins

Every key and opt-in variable that a service, a preset row or a scenario names, with the places that use it. A billable service needs its key and `EXA_TEST_ENABLE_PAID_LLM`. A local runtime or a subscription CLI needs its `EXA_MATRIX_*` opt-in. An opt-in counts when it is non-empty.

<!-- model-settings:keys:start -->

| Variable                            | Kind   | Services                | Preset rows                                                                                            | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                 | key    | `anthropic`             | `exactl-generic`, `exactl-native`, `live-anthropic`, `planning-live-anthropic`, `split-strong-local`   | `session-delegate-matrix-live`, `swe-add-api-routes-constants`, `swe-add-batch-operations`, `swe-add-feature-endpoint`, `swe-add-feature-endpoint-flow-feature-development`, `swe-add-feature-endpoint-flow-refactoring`, `swe-add-search-feature`, `swe-async-ordering-bug`, `swe-docstring-storage-module`, `swe-explain-request-flow`, `swe-extract-sort-utility`, `swe-refactor-extract-function`, `swe-refactor-extract-function-placebo`, `swe-rename-done-to-completed`, `swe-rename-priority-type`, `swe-write-api-readme`, `swe-write-tests-uncovered-testengineer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `DEEPSEEK_API_KEY`                  | key    | `deepseek`              | `deepseek-chat`, `live-deepseek`, `planning-live-deepseek`                                             | `code-analyst-smoke`, `deepseek-compatible-native-live`, `default-smoke`, `dogfood-developer-smoke`, `flow-binding-deepseek-override-live`, `flow-quality-api-documentation`, `flow-quality-bug-investigation`, `flow-quality-pr-review`, `model-intent-e2e`, `p235-s1-c1`, `p235-s1-c2`, `p235-s1-c3`, `p235-s1-c4`, `p235-s1-c5`, `p235-s3-c1`, `p235-s3-c2`, `p235-s3-c3`, `p235-s3-c4`, `p235-s3-c5`, `p235-s6-c1`, `p235-s6-c2`, `p235-s6-c3`, `p235-s6-c4`, `p235-s6-c5`, `p235-s6-c6`, `p235-s8-c1`, `p235-s8-c2`, `p235-s8-c3`, `p235-s8-c4`, `p235-s8-c5`, `p235-s8-c6`, `p235-s8-c7`, `p235-s8-c8`, `p235-s8-c9`, `performance-engineer-smoke`, `product-manager-smoke`, `qa-engineer-smoke`, `quality-judge-smoke`, `research-synthesizer-smoke`, `security-expert-smoke`, `senior-coder-smoke`, `skill-effectiveness-code-review`, `skill-effectiveness-portal-grounding`, `skill-effectiveness-security-first`, `skill-effectiveness-tdd-methodology`, `skill-effectiveness-typescript-patterns`, `software-architect-smoke`, `technical-writer-smoke`, `test-engineer-smoke`, `voting-judge-smoke` |
| `EXA_COMPAT_FIXTURE_PORT`           | opt-in | -                       | `self-hosted-fixture`                                                                                  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_COMPAT_TEST_API_KEY`           | key    | -                       | -                                                                                                      | `flow-step-model-bindings`, `openai-compatible-native`, `openai-compatible-native-approval`, `openai-compatible-native-budget`, `openai-compatible-native-dynamic`, `openai-compatible-native-failure`, `openai-compatible-native-limits`, `openai-compatible-native-write`, `operator-override-axes`, `scenario-bindings-split`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `EXA_MATRIX_AGENT_ROLE_LIVE`        | opt-in | -                       | -                                                                                                      | `code-analyst-smoke`, `default-smoke`, `dogfood-developer-smoke`, `performance-engineer-smoke`, `product-manager-smoke`, `qa-engineer-smoke`, `quality-judge-smoke`, `research-synthesizer-smoke`, `security-expert-smoke`, `senior-coder-smoke`, `software-architect-smoke`, `technical-writer-smoke`, `test-engineer-smoke`, `voting-judge-smoke`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `EXA_MATRIX_CALIBRATION_SANDBOX`    | opt-in | -                       | `live-calibration-sandbox`                                                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_CLAUDE_SONNET5`         | opt-in | -                       | -                                                                                                      | `session-delegate-meta-workflow-queue-live`, `session-delegate-outcome-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `EXA_MATRIX_CODEX`                  | opt-in | -                       | `live-codex-cli`, `planning-live-codex`                                                                | `dogfood-context-live`, `flow-strategy-react`, `portal-knowledge-adaptive-tools`, `session-delegate-matrix-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `EXA_MATRIX_DELEGATION`             | opt-in | -                       | `live-delegation-claude-code`, `live-delegation-opencode`                                              | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_LEARNING_EFFECTIVENESS` | opt-in | -                       | `live-learning-effectiveness`                                                                          | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_LLAMACPP`               | opt-in | -                       | `live-llamacpp`                                                                                        | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_MCP_DEEPWIKI`           | opt-in | -                       | `live-mcp-deepwiki`                                                                                    | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_MCP_GITHUB`             | opt-in | -                       | `live-mcp-github`                                                                                      | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_MODELS_DEV`             | opt-in | -                       | `live-models-dev`                                                                                      | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_OLLAMA`                 | opt-in | -                       | `live-ollama`, `live-ollama-chat`, `ollama-chat`, `split-strong-local`                                 | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_MATRIX_OPENCODE`               | opt-in | -                       | `planning-live-opencode`                                                                               | `dogfood-context-live`, `session-delegate-matrix-live`, `session-delegate-meta-workflow-queue-live`, `session-delegate-outcome-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `EXA_MATRIX_SESSION_DELEGATE_CYCLE` | opt-in | -                       | `live-session-delegate-cycle`                                                                          | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXA_TEST_ENABLE_PAID_LLM`          | opt-in | -                       | `live-anthropic`, `live-deepseek`, `live-google`, `live-openai`, `live-opencode-go`, `live-openrouter` | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GITHUB_TOKEN`                      | key    | -                       | `live-mcp-github`                                                                                      | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GOOGLE_API_KEY`                    | key    | `google`                | `exactl-google`, `live-google`, `planning-live-google`                                                 | `flow-binding-google-override-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `OPENAI_API_KEY`                    | key    | `openai`, `openai-chat` | `exactl-openai`, `live-openai`, `openai-chat`, `planning-live-openai`                                  | `openai-compatible-native-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `OPENCODE_API_KEY`                  | key    | `opencode-go`           | `live-opencode-go`                                                                                     | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `OPENROUTER_API_KEY`                | key    | `openrouter`            | `exactl-openrouter`, `exactl-openrouter-deepseek-flash`, `live-openrouter`, `planning-live-openrouter` | `session-delegate-matrix-live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

<!-- model-settings:keys:end -->

### Live-test rows

An in-process live test reads the row of its service. Select another provider, service or model with `EXA_TEST_BIND='default=<binding>'`, where `<binding>` is the value of the Binding column or the binding of another service. The gate then follows the bound service.

<!-- model-settings:live:start -->

| Row                           | Provider       | Binding                                                    | Binary on PATH | Key variable         | Opt-in variable                     |
| ----------------------------- | -------------- | ---------------------------------------------------------- | -------------- | -------------------- | ----------------------------------- |
| `live-anthropic`              | `anthropic`    | `service=anthropic,service_model_id=claude-haiku-5-5`      | -              | `ANTHROPIC_API_KEY`  | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-calibration-sandbox`    | `claude-cli`   | -                                                          | `claude`       | -                    | `EXA_MATRIX_CALIBRATION_SANDBOX`    |
| `live-codex-cli`              | `codex-cli`    | `service=codex-cli,service_model_id=gpt-5.6-terra`         | `codex`        | -                    | `EXA_MATRIX_CODEX`                  |
| `live-deepseek`               | `openai-chat`  | `service=deepseek,service_model_id=deepseek-v4-pro`        | -              | `DEEPSEEK_API_KEY`   | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-delegation-claude-code` | `claude-cli`   | -                                                          | `claude`       | -                    | `EXA_MATRIX_DELEGATION`             |
| `live-delegation-opencode`    | `opencode-cli` | -                                                          | `opencode`     | -                    | `EXA_MATRIX_DELEGATION`             |
| `live-google`                 | `google`       | `service=google,service_model_id=gemini-3.8-flash`         | -              | `GOOGLE_API_KEY`     | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-learning-effectiveness` | `claude-cli`   | -                                                          | `claude`       | -                    | `EXA_MATRIX_LEARNING_EFFECTIVENESS` |
| `live-llamacpp`               | `llamacpp`     | -                                                          | -              | -                    | `EXA_MATRIX_LLAMACPP`               |
| `live-mcp-deepwiki`           | `mcp`          | -                                                          | -              | -                    | `EXA_MATRIX_MCP_DEEPWIKI`           |
| `live-mcp-github`             | `mcp`          | -                                                          | -              | `GITHUB_TOKEN`       | `EXA_MATRIX_MCP_GITHUB`             |
| `live-models-dev`             | `models.dev`   | -                                                          | -              | -                    | `EXA_MATRIX_MODELS_DEV`             |
| `live-ollama`                 | `ollama`       | -                                                          | -              | -                    | `EXA_MATRIX_OLLAMA`                 |
| `live-ollama-chat`            | `openai-chat`  | `service=ollama-chat,model=meta/llama3.1:8b`               | -              | -                    | `EXA_MATRIX_OLLAMA`                 |
| `live-openai`                 | `openai`       | `service=openai,service_model_id=gpt-5-mini`               | -              | `OPENAI_API_KEY`     | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-opencode-go`            | `openai-chat`  | `service=opencode-go,service_model_id=deepseek-v4.1-flash` | -              | `OPENCODE_API_KEY`   | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-openrouter`             | `openrouter`   | `service=openrouter,service_model_id=openai/gpt-4o-mini`   | -              | `OPENROUTER_API_KEY` | `EXA_TEST_ENABLE_PAID_LLM`          |
| `live-session-delegate-cycle` | `opencode-cli` | -                                                          | `opencode`     | -                    | `EXA_MATRIX_SESSION_DELEGATE_CYCLE` |

<!-- model-settings:live:end -->

### Scenario cells

A scenario selects these rows with `matrix.from_catalog`, and `--cell <tool or provider>` runs one of them. Each row names the daemon configuration that the cell boots, in `tests/configs/`.

<!-- model-settings:cells:start -->

| Cell                               | Tool                       | Provider       | Model                             | Binary on PATH | Key variable         | Opt-in variable           |
| ---------------------------------- | -------------------------- | -------------- | --------------------------------- | -------------- | -------------------- | ------------------------- |
| `claude-code`                      | `claude-code`              | `claude-cli`   | `claude-sonnet-5`                 | `claude`       | -                    | -                         |
| `claude-haiku-4-5`                 | `claude-haiku-4-5`         | `claude-cli`   | `claude-haiku-4-5`                | `claude`       | -                    | -                         |
| `codex`                            | `codex`                    | `codex-cli`    | `gpt-5.6-terra`                   | `codex`        | -                    | -                         |
| `deepseek-chat`                    | `exactl`                   | `openai-chat`  | `deepseek-v4-pro`                 | -              | `DEEPSEEK_API_KEY`   | -                         |
| `exactl-generic`                   | `exactl`                   | `anthropic`    | `claude-sonnet-5`                 | -              | `ANTHROPIC_API_KEY`  | -                         |
| `exactl-google`                    | `exactl`                   | `google`       | `gemini-3.8-flash`                | -              | `GOOGLE_API_KEY`     | -                         |
| `exactl-native`                    | `exactl`                   | `anthropic`    | `claude-sonnet-5`                 | -              | `ANTHROPIC_API_KEY`  | -                         |
| `exactl-openai`                    | `exactl`                   | `openai`       | `gpt-5.6-terra`                   | -              | `OPENAI_API_KEY`     | -                         |
| `exactl-openrouter`                | `exactl`                   | `anthropic`    | `claude-sonnet-5`                 | -              | `OPENROUTER_API_KEY` | -                         |
| `exactl-openrouter-deepseek-flash` | `exactl`                   | `openrouter`   | `~deepseek/deepseek-flash-latest` | -              | `OPENROUTER_API_KEY` | -                         |
| `ollama-chat`                      | `exactl`                   | `openai-chat`  | `llama3.1:8b`                     | -              | -                    | `EXA_MATRIX_OLLAMA`       |
| `openai-chat`                      | `exactl`                   | `openai-chat`  | `gpt-6-luna`                      | -              | `OPENAI_API_KEY`     | -                         |
| `opencode`                         | `opencode`                 | `opencode-cli` | `opencode-go/deepseek-v4-flash`   | `opencode`     | -                    | -                         |
| `opencode-go`                      | `opencode-go`              | `opencode-cli` | `opencode-go/deepseek-v4-flash`   | `opencode`     | -                    | -                         |
| `opencode-laguna-free`             | `opencode-laguna-free`     | `opencode-cli` | `opencode/laguna-s-2.1-free`      | `opencode`     | -                    | -                         |
| `opencode-north-mini-code`         | `opencode-north-mini-code` | `opencode-cli` | `opencode/north-mini-code-free`   | `opencode`     | -                    | -                         |
| `planning-live-anthropic`          | `exactl`                   | `anthropic`    | `claude-sonnet-5`                 | -              | `ANTHROPIC_API_KEY`  | -                         |
| `planning-live-claude`             | `claude-code`              | `claude-cli`   | `claude-haiku-4-5`                | `claude`       | -                    | -                         |
| `planning-live-codex`              | `codex`                    | `codex-cli`    | `gpt-5.6-terra`                   | `codex`        | -                    | `EXA_MATRIX_CODEX`        |
| `planning-live-deepseek`           | `exactl`                   | `openai-chat`  | `deepseek-v4-pro`                 | -              | `DEEPSEEK_API_KEY`   | -                         |
| `planning-live-google`             | `exactl`                   | `google`       | `gemini-3.8-flash`                | -              | `GOOGLE_API_KEY`     | -                         |
| `planning-live-openai`             | `exactl`                   | `openai`       | `gpt-5-mini`                      | -              | `OPENAI_API_KEY`     | -                         |
| `planning-live-opencode`           | `opencode`                 | `opencode-cli` | `opencode-go/deepseek-v4-flash`   | `opencode`     | -                    | `EXA_MATRIX_OPENCODE`     |
| `planning-live-openrouter`         | `exactl`                   | `openrouter`   | `openrouter/auto`                 | -              | `OPENROUTER_API_KEY` | -                         |
| `self-hosted-fixture`              | `exactl`                   | `openai-chat`  | -                                 | -              | -                    | `EXA_COMPAT_FIXTURE_PORT` |
| `split-strong-local`               | `exactl`                   | `mixed`        | -                                 | -              | `ANTHROPIC_API_KEY`  | `EXA_MATRIX_OLLAMA`       |

<!-- model-settings:cells:end -->

### Other variables

Variables that no service or preset declares. The drift test checks that the file in the last column still names the variable.

<!-- model-settings:other:start -->

| Variable                    | Scope             | Purpose                                                                                                                                 | Read by                                                      |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `EXA_LLM_PROVIDER`          | production        | Overrides the AI provider of the daemon and exactl. An unknown name falls back to `mock`.                                               | `packages/ai/src/provider_factory.ts`                        |
| `EXA_LLM_MODEL`             | production        | Overrides the model name. The value goes to the provider unchanged.                                                                     | `packages/ai/src/provider_factory.ts`                        |
| `EXA_LLM_BASE_URL`          | production        | Overrides the provider endpoint. `EXA_LLM_ENDPOINT` is the older name.                                                                  | `packages/ai/src/provider_factory.ts`                        |
| `EXA_LLM_TIMEOUT_MS`        | production        | Overrides the request timeout in milliseconds.                                                                                          | `packages/ai/src/provider_factory.ts`                        |
| `EXA_MODEL_PRESET_OVERRIDE` | production, tests | Pins every model size to `mock:mock-model` for a registered preset name such as `test`.                                                 | `packages/ai/src/model_resolver.ts`                          |
| `CLAUDE_CODE_OAUTH_TOKEN`   | production        | Subscription login of the Claude CLI delegate, used instead of a metered API key.                                                       | `packages/execution/src/strategies/cli_delegate_strategy.ts` |
| `EXA_TEST_BIND`             | tests             | Binds the provider, service, transport and model of an in-process live test, in the `--bind` syntax `selector=field=value,field=value`. | `tests/helpers/llm_bindings.ts`                              |
| `EXA_TEST_LLM_MODEL`        | tests             | Model ID of the provider tests of `packages/ai`. The default is `gpt-5-mini`.                                                           | `packages/ai/tests/helpers/test_model.ts`                    |
| `OLLAMA_BASE_URL`           | tests             | Host of the Ollama server for `ollama_json_plan_test.ts`. The default is `http://localhost:11434`.                                      | `tests/integration/ollama_json_plan_test.ts`                 |
| `EXA_EVAL_LLM_PROVIDER`     | evaluation        | Provider of the judge of a scenario or a live test. The project default is `claude-cli`.                                                | `tests/scenario_framework/runner/assertions.ts`              |
| `EXA_EVAL_LLM_MODEL`        | evaluation        | Model of the judge.                                                                                                                     | `tests/scenario_framework/runner/assertions.ts`              |
| `EXA_TEST_MODE`             | tests             | Marks a test run. The daemon then refuses a billable provider unless the paid opt-in is set.                                            | `packages/core/src/config/env_schema.ts`                     |
| `EXA_CI_MODE`               | tests             | Marks a CI run. When it is unset, `CI` does the same.                                                                                   | `packages/core/src/config/env_schema.ts`                     |

<!-- model-settings:other:end -->
