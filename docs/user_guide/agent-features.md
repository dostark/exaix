# Agent Features

Reflexion, model intent flags, confidence scoring, session memory, retry and structured output. Part of the [Exaix User Guide](README.md).

## Agent features

Agent features change how an agent produces and checks its output: self-critique, model choice, confidence scoring, session memory, retries and output validation. This page explains each feature and its settings.

### Reflexion Pattern (Self-Critique)

The Reflexion pattern enables agents to critique and improve their own outputs iteratively.

#### How It Works

1. Agent generates initial response
1. Agent self-critiques using structured criteria (accuracy, completeness, quality, safety)
1. If issues found, agent refines output
1. Process repeats until quality threshold met or max iterations reached

#### Configuration

Enable reflexion in agent role blueprint frontmatter:

```yaml
---
agent_role: "quality-reviewer"
name: "Quality Reviewer"
model: ""                  # deprecated — use model_size + characteristics instead
model_size: L              # large model for thorough evaluation
thinking: true             # extended reasoning for critique
effort: high               # high token budget for deep analysis
capabilities: ["review", "evaluation"]
output_contract: plan
default_skills: ["reflexive-critique", "portal-grounding"]
permitted_tools: ["read_file", "search_text"]
reflexive: true
max_reflexion_iterations: 3
confidence_required: 80
---
```

| Field                      | Default | Description                          |
| -------------------------- | ------- | ------------------------------------ |
| `reflexive`                | `false` | Enable self-critique loop            |
| `max_reflexion_iterations` | `3`     | Maximum refinement passes            |
| `confidence_required`      | unset   | Minimum confidence (0-100) to accept |

#### When to Use Reflexion

- **Code review agents**: Catch issues the first pass might miss
- **Technical writing**: Ensure accuracy and completeness
- **Security audits**: Multi-pass vulnerability analysis
- **Quality-critical tasks**: Any output requiring high confidence

#### Trade-offs

- **Higher quality**: More thorough analysis
- **Increased latency**: 2-4x longer response time
- **Higher cost**: Multiple LLM calls per request

### Model Intent (model resolution and intent)

Model Intent lets you describe the model you want by **capability requirements**
rather than hardcoding a specific `provider:model` ID. Instead of saying
"use claude-sonnet-4", you say "give me a size L model with thinking" — and
`ModelResolver` picks the best available provider+model that matches.

This decouples your request/agent role from any single provider. The same intent
works locally with Ollama, in the cloud with Anthropic, or in an air-gapped
environment — without editing blueprints.

#### Available intent fields in blueprint frontmatter

| Field                   | Values                                                | Behavior                                                                     |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `model_size`            | `S`, `M`, `L`, `XL`                                   | Maps to capability profile (context window, cost, thinking support)          |
| `thinking`              | `true`, `false`                                       | Require extended reasoning model                                             |
| `effort`                | `low`, `medium`, `high`                               | Reasoning token budget (only meaningful with `thinking: true`)               |
| `characteristics`       | `["cheapest"]`, `["fastest"]`                         | Soft ranking hint — scores providers, does not eliminate                     |
| `preferred_provider`    | provider name                                         | Narrow candidate pool, skip cross-provider scoring                           |
| `required_capabilities` | `chat`, `streaming`, `vision`, `tools`, `multi-model` | Hard filter — providers lacking ALL listed values are excluded               |
| `model`                 | `provider:model`                                      | **Deprecated** — bypasses ModelResolver, ties agent role to a specific model |

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

#### How a model is chosen

Size tiers map to capability profiles in the `[model_sizes]` table of `exa.config.toml`. Each tier can narrow its eligible providers with `candidates`. [Model Resolution](model-resolution.md#2-how-the-choice-gets-made) explains the order of the resolver, and [Model Settings](model-settings.md) lists every setting. In short:

- An explicit `model: "provider:model"` bypasses the resolver.
- Otherwise the resolver uses the curated candidates of the size tier, then ranks providers with your `characteristics`.
- If the prompt does not fit the context window, the resolver bumps the request to the next size tier.

During plan execution, **request-level intent overrides the blueprint**. `--model-size`, `--thinking`, `--effort`, `--characteristic` and `--preferred-provider` of `exactl request create` write into the request frontmatter. They take precedence over the `model_size:` and `thinking:` fields of the agent role blueprint for every field you set. Unset fields fall through to the blueprint. See the [request reference](../cli/request.md#exactl-request-create) for the flags.

Every resolution emits a `model_resolved` trace event. Read it with `exactl log list --filter model_resolved`.

#### Migration: agent role blueprints

**A hardcoded `model:` in an agent role blueprint is deprecated.** It still works, but it short-circuits the resolver and ties the role to one provider and model, which defeats portability. Replace it with the declarative fields:

```diff
  ---
- model: "anthropic:claude-sonnet-4"
+ model: ""                # preserved empty for schema compat
+ model_size: "L"
+ characteristics: ["fastest"]
  ---
```

### Confidence Scoring

Every agent output includes a confidence score indicating how certain the agent is about its response.

#### Understanding Confidence Scores

| Score  | Level     | Interpretation                                         |
| ------ | --------- | ------------------------------------------------------ |
| 90-100 | Very High | Confident response, proceed with caution-free approval |
| 70-89  | High      | Good confidence, standard review recommended           |
| 50-69  | Medium    | Moderate uncertainty, careful review needed            |
| 30-49  | Low       | Significant uncertainty, human verification required   |
| 0-29   | Very Low  | Agent uncertain, consider alternate approach           |

#### What a low score does

When plan amendments are enabled, a step whose confidence falls below `amendment.threshold` (default 60) pauses the plan with a low-confidence amendment. You then review and decide it with `exactl plan amendment`. See [Plan amendments](security-and-safety.md#plan-amendments).

### Session Memory

Session Memory automatically provides relevant context from past interactions to agents.

#### How It Works

1. **Request received**: User submits a request
1. **Memory lookup**: System searches for relevant past interactions
1. **Context injection**: Top-K memories added to agent prompt
1. **Execution**: Agent has historical context
1. **Learning capture**: New insights saved post-execution

#### Settings

Session memory is on by default. It injects the top 5 memories with a relevance score of at least 0.3. These values are defaults of the service, not keys of `exa.config.toml`. The one related config key is `memory.session.expand_links`, which makes retrieval follow one hop of memory links. See [Memory](memory.md) for the memory settings.

#### Memory Types

| Type           | Description                            |
| -------------- | -------------------------------------- |
| **Learnings**  | Approved insights from past executions |
| **Patterns**   | Code patterns identified in projects   |
| **Decisions**  | Architectural decisions and rationale  |
| **Executions** | Past agent execution summaries         |

#### Viewing memory context

`exactl request inspect <request-id>` shows which memories were injected for a request.

### Retry & Recovery

Provider transport retries have one owner: the shared fetch layer. The base provider
makes one attempt, so the retry budget is not multiplied by nested loops.
`max_attempts` includes the first request. A sustained HTTP 503 therefore makes at
most that many transport attempts. Rate-limit, connection and timeout errors are
retryable; HTTP 503 stays retryable.

#### Configuration

For example, set the Anthropic provider's retry budget and request timeout:

```toml
[ai_retry.providers.anthropic]
max_attempts = 3
backoff_base_ms = 1000

[ai_timeout.providers]
anthropic = 30000
```

Every provider that `ProviderFactory` builds reads its per-provider retry settings
(`ai_retry.providers.<provider>`) at construction, and falls back to its package
defaults when a block is absent. The global `ai_retry.max_attempts` field also
controls fallback-chain provider creation; it is not a universal transport
override.

The first retry waits one base delay, the second waits twice that delay, and later
retries continue exponentially. When an error carries a parsed Retry-After value,
its contribution is capped at `ai_retry.retry_after_max_ms` (default 60,000 ms)
and the longer of that value and the exponential backoff is used. The backoff
itself can exceed that cap. Cancellation interrupts the wait.

Only OpenRouter errors carry a parsed Retry-After value today. A 429 reply from
Anthropic, Google or OpenAI uses plain exponential backoff.

```toml
[ai_retry]
retry_after_max_ms = 30000
```

The cap is read when a provider is constructed, and it reaches every provider
that `ProviderFactory` builds. See the [configuration reference](../Reference_Data.md#ai-provider-retry-configuration).

#### Non-Retryable Errors and Diagnostics

- `BillingError` means HTTP 402. It is terminal; check the provider account or budget.
- Authentication, invalid-request, permission and routing errors are terminal.
- `ProviderTruncationError` identifies an empty incomplete OpenAI Responses reply.
  Raise the output budget or reduce reasoning effort. Partial text or tool calls
  remain available. OpenRouter has its own subclass of this shared error.
- Compatible-provider errors keep their sanitized status and allowlisted reason
  details; remote error text and raw request/response dumps are suppressed.

When logging is enabled, `provider.retry.scheduled` records each failed attempt
before its retry wait, with the provider, attempt limit, delay and error type.
The compatible branch suppresses these intermediate events and keeps one terminal
event. Native provider request bodies can appear in the debug event
`provider.request_debug_dump`. It contains the parsed body and can include prompt
content; transport headers are excluded. Console payloads escape control characters.

### Structured Output Validation

Agent outputs are validated against JSON schemas with automatic repair.

#### Validation Process

1. **Extract JSON**: Parse JSON from agent response
1. **Schema validation**: Check against PlanSchema
1. **Auto-repair**: Attempt to fix common issues
1. **Detailed errors**: Report specific validation failures

#### Auto-Repair Capabilities

| Issue              | Auto-Fix                |
| ------------------ | ----------------------- |
| Trailing commas    | Removed                 |
| Missing quotes     | Added around keys       |
| Unescaped newlines | Escaped                 |
| Comments in JSON   | Stripped                |
| Truncated output   | Detected (not repaired) |

#### Validation errors

When validation fails, the error names each failing field, such as a missing required field or an unknown tool, so you can fix the output or the blueprint.

## Troubleshooting

### High Latency

If agent responses are slow:

1. **Check reflexion settings**: Reduce `max_reflexion_iterations`
1. **Reduce memory context**: Turn off `memory.session.expand_links`
1. **Use faster model**: Switch to smaller/faster model variant
1. **Disable optional features**: Turn off reflexion or memory for speed

### Low Confidence Outputs

If agents consistently produce low-confidence outputs:

1. **Check prompt clarity**: Ensure request is specific
1. **Provide more context**: Add relevant files to portal
1. **Use specialist agent**: Match agent expertise to task
1. **Enable session memory**: Historical context helps

### Retry Exhaustion

If agents fail after max retries:

1. **Check service status**: Provider may be down
1. **Verify credentials**: API keys may be expired
1. **Check rate limits**: You may be hitting quotas
1. **Tune retries**: Raise `ai_retry.max_attempts` or `ai_retry.backoff_base_ms`

### Memory Not Found

If relevant memories aren't being injected:

1. **Rebuild index**: `exactl memory index rebuild`
1. **Add learnings**: Approve pending learnings
1. **Check scope**: Ensure learnings are in correct project/global scope
