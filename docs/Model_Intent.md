// @module ModelIntentDoc @path docs/Model_Intent.md

# Model Intent System

- **Version:** 0.1.0
- **Date:** 2026-07-02
- **Phase:** 132

---

## 1. What Model Intent Is

Model Intent lets you describe the model you want by characteristics rather than
hardcoding a specific `provider:model` ID. Instead of saying "use claude-sonnet-4",
you say "give me a size L model with thinking" — and the system picks the best
available provider+model that matches.

This decouples your request/identity from any single provider. The same intent
works locally with Ollama, in the cloud with Anthropic, or in an air-gapped
environment — without editing blueprints.

---

## 2. CLI Flags

These flags are available on `exactl request` and `exactl request create`:

| Flag                   | Values                  | Description                                      |
| ---------------------- | ----------------------- | ------------------------------------------------ |
| `--model-size`         | `S`, `M`, `L`, `XL`     | Capability tier mapped to context/cost profile   |
| `--thinking`           | boolean flag            | Enable extended chain-of-thought reasoning       |
| `--effort`             | `low`, `medium`, `high` | Reasoning token budget for thinking models       |
| `--characteristic`     | `cheapest`, `fastest`   | Soft ranking hint (repeatable)                   |
| `--preferred-provider` | provider name           | Narrow candidate pool to a specific provider     |
| `-m, --model`          | `provider:model`        | **Legacy** — hardcoded model (bypasses resolver) |

Examples:

```bash
# Declare intent — let the resolver pick the best match
exactl request "Refactor auth module" --model-size L --thinking --effort high

# Prioritise speed over cost
exactl request "Generate unit tests" --model-size S --characteristic fastest

# Narrow to a provider but keep size-based selection
exactl request "Audit dependencies" --model-size XL --preferred-provider anthropic
```

---

## 3. Preset Configuration

The default capability profiles for each size tier are defined in
`exa.config.toml` under `[model_presets]`:

```toml
[model_presets]
S = { max_cost_per_mtok = 0.5,  min_context_window = 8192,   supports_thinking = false }
M = { max_cost_per_mtok = 3,    min_context_window = 32000,  supports_thinking = true  }
L = { max_cost_per_mtok = 15,   min_context_window = 128000, supports_thinking = true  }
XL = { max_cost_per_mtok = 75,  min_context_window = 200000, supports_thinking = true  }
```

Override individual fields to tighten constraints:

```toml
# Raise cost ceiling for size M to allow better models
[model_presets.M]
max_cost_per_mtok = 5
```

The `candidates` field restricts which providers are eligible for a tier:

```toml
[model_presets.L]
candidates = ["anthropic:claude-sonnet", "openai:gpt-4o"]
```

---

## 4. How Resolution Works

`ModelResolver` resolves a `ModelIntent` → concrete `{provider, model, options}`
using this precedence:

1. **Explicit override** — if `EXA_MODEL_PRESET_OVERRIDE` env var is set and
   `model_size` is present, use the override map directly.
2. **Characteristics scoring** — if `characteristics` (soft hints) are provided,
   score each candidate provider and pick the highest-scoring match.
3. **Preset default** — use the `model_size` tier's default model for the
   preferred provider, or the first healthy provider in the candidate list.
4. **Fallback iteration** — try each fallback intent from the `fallbacks` array
   in order.
5. **Context-window overflow** — if `context_window_fallback` is set and the
   estimated input tokens exceed the resolved model's context window, bump to
   the next size tier and re-resolve.

Every resolution emits a `model_resolved` trace event with the full audit trail:
input intent, provider scores, selected model, reason code, and duration.

---

## 5. Intent Field Reference

### `required_capabilities` — hard filter

Eliminates providers that cannot support a feature. Only providers whose
`capabilities` array contains **all** listed values are considered.

| Value         | Meaning                 | Supported by                      |
| ------------- | ----------------------- | --------------------------------- |
| `chat`        | General chat/completion | All providers                     |
| `streaming`   | Token-level streaming   | Anthropic, Google, Ollama, OpenAI |
| `vision`      | Image input             | Anthropic, Google, OpenAI         |
| `tools`       | Function/tool calling   | OpenAI                            |
| `multi-model` | Multiple model backends | OpenRouter                        |

Example — require streaming and tools, excluding providers without both:

```yaml
required_capabilities: ["streaming", "tools"]
```

### `characteristics` — soft ranking hint

Does not eliminate any provider. Assigns weighted scores to candidates to
bias selection toward a preferred profile. Repeatable — multiple values
accumulate.

| Value      | Effect                                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| `cheapest` | Higher score for lower `costPerMtok`. Best for batch/non-urgent work.        |
| `fastest`  | Scores all candidates equally. Typically selects the first healthy provider. |

Use `characteristics` when multiple providers are capable and you want a
preference:

```yaml
characteristics: ["cheapest"]
```

### `preferred_provider` — narrows the candidate pool

If set, only the named provider is evaluated. Skips cross-provider scoring.

```yaml
preferred_provider: "anthropic"
```

---

## 6. Migration: Identity Blueprints

**Hardcoded `model:` in identity blueprints is deprecated.** Replace it with
declarative fields:

```diff
  ---
- model: "anthropic:claude-sonnet-4"
+ model_size: "L"
+ characteristics: ["fastest"]
  ---
```

Supported frontmatter fields:

| Field                | Type    | Description                              |
| -------------------- | ------- | ---------------------------------------- |
| `model_size`         | string  | `S`, `M`, `L`, or `XL`                   |
| `preferred_provider` | string  | Provider hint (e.g. `openai`)            |
| `thinking`           | boolean | Enable extended reasoning                |
| `effort`             | string  | `low`, `medium`, or `high`               |
| `model`              | string  | **Deprecated** — `provider:model` string |

The `model` field continues to work, but it short-circuits the resolver and
ties the identity to a specific provider+model, defeating portability.

---

## 7. Future: Phase 134 Model Registry

Phase 134 will introduce the `IModelRegistry` plugin system, enabling:

- Registration of custom model sizes beyond `S`/`M`/`L`/`XL`
- A `fastest` simplification — `--model-size fastest` resolves to the cheapest
  model meeting minimal quality thresholds, removing the need to choose a tier
- Dynamic provider capability discovery at startup
- End-user model aliases in config
