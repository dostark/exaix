# Cost Tracking

Cost tracking, budgets and supported providers. Part of the [Exaix User Guide](README.md).

## Cost Tracking (Beta)

Exaix provides comprehensive cost tracking and budget management for AI provider usage. This feature helps you monitor spending, set limits, and optimize your AI usage costs.

## exactl log cost

Use `exactl log cost` to inspect persisted provider calls. Add `--group-by model` or
`--group-by portal` for per-group call counts, prompt/completion tokens,
cache-read/cache-creation tokens, and total USD cost. The same view is available
as `exactl log cost`. Filters such as `--portal`, `--model`, `--trace`, and
`--since` apply before grouping. Without `--group-by`, the command shows the
existing per-call table and totals.

```bash
exactl log cost --group-by model
exactl log cost --group-by portal --since 2026-09-01
```

`--group-by role` reports that role attribution is not available in this build.
The database has a nullable `agent_role` column for future attribution, but
generation calls do not yet populate it.

### How Cost Tracking Works

Cost tracking operates at multiple levels:

1. **Per-Request Tracking**: Each agent execution logs token usage and estimated cost
1. **Daily Budget Enforcement**: Prevents exceeding your daily spending limit
1. **Provider-Specific Rates**: Different rates for different models and providers
1. **Historical Reporting**: Query past usage and costs via Activity Journal

### Configuration

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

Each cost record carries a `cost_source`: `provider_reported` (the provider returned the cost),
`registry_computed` (a registry price split by input and output tokens) or `estimated`
(one flat per-provider rate, used when neither of the others is available).
An estimated cost counts toward the daily budget like any other cost, so treat it as a guess.

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

### Budget Enforcement

Before each agent execution, Exaix checks:

1. **Daily Budget**: Current day's spending vs `max_daily_cost_usd`
1. **Estimated Cost**: Predicted cost for the current request
1. **Provider Limits**: Any provider-specific restrictions

If a request would exceed your budget, it's rejected with a clear error message.

Beyond monetary caps, Exaix applies a **prompt-token budget ceiling** that caps the
assembled prompt size per request independently of the model's context window. This
targets cost control on large-context models (202K+ tokens) where overflow is not the
risk but spend per request still is:

```toml
[budget]
cost_target_tokens_per_request = 40000  # optional hard cap on assembled prompt tokens per request
```

When set, `AgentRunner`'s planning call and the ReAct execution loop both route the
assembled prompt through the shared `PromptBudgetAllocator`/`ContextBudgetManager`
pipeline, trimming lower-priority segments (memory, portal knowledge, skills) until the
assembled prompt fits the cap. Compactions are observable via `context.budget.consumed`
journal events (with `droppedSegmentCount > 0`) and per-trim `context.section.truncated`
events. When unset (the default), enforcement keeps today's behavior. The ceiling is a
**hard upper bound**: if protected content (the user request plus critical skill contract)
alone exceeds it, the planning call fails closed before any provider call, emitting
`context.budget.exceeded` and surfacing the configured ceiling and protected-token total —
protected content is never silently dropped to fit a cap.

The ceiling is validated at configuration time against the allocator's minimum feasible
total (`MIN_COST_TARGET_TOKENS_PER_REQUEST`) — a value below it is rejected when the config
is loaded rather than deferred to failure on every request. The effective ceiling is
resolved at config load as Config-DB override (set via
`exactl config set budget.cost_target_tokens_per_request <n>`)

> TOML > the legacy `budget_enforcement.costTargetTokens` field, and takes effect on the
> next daemon restart (its swap class is RESTART); `budget.cloud_enforcement_enabled` /
> `budget.local_enforcement_enabled` gate enforcement for hosted vs local models. See
> `exactl config` for the full `budget` key surface.

### Monitoring Usage

Query cost information through the Activity Journal:

```bash
# View recent cost-related activities
exactl log list --payload %cost% --limit 10

# Find high-cost operations
exactl log list --payload %tokens% --limit 20 -o json | jq '.[] | select(.payload.cost > 1.0)'

# Daily cost summary (requires external processing)
exactl log list --filter since=$(date +%Y-%m-%d) --payload %cost% -o json > daily_costs.json
```

### Cost Optimization Tips

- **Use Appropriate Models**: Smaller models for simple tasks, larger models for complex reasoning
- **Set Realistic Budgets**: Start with conservative limits and adjust based on usage
- **Monitor Regularly**: Use journal queries to identify expensive operations
- **Batch Requests**: Combine related tasks to reduce overhead
- **Cache Results**: Memory banks help avoid redundant work

### Supported Providers

Cost tracking supports all major AI providers:

| Provider                                                            | Token Tracking | Cost Estimation                                      | Budget Enforcement                                         |
| ------------------------------------------------------------------- | -------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Anthropic                                                           | ✅             | ✅                                                   | ✅                                                         |
| OpenAI                                                              | ✅             | ✅                                                   | ✅                                                         |
| Google                                                              | ✅             | ✅                                                   | ✅                                                         |
| OpenAI-compatible (`openai-chat`, profiles `openai` and `deepseek`) | ✅             | ✅ from registered rates, otherwise unknown (`null`) | ✅ only with known rates (`pricing_unavailable` otherwise) |
| Ollama                                                              | ✅             | ❌ (free)                                            | ❌                                                         |
| Mock                                                                | ✅             | ❌                                                   | ❌                                                         |
