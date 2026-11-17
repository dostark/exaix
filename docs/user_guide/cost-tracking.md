# Cost Tracking

Cost tracking, budgets and supported providers. Part of the [Exaix User Guide](README.md).

## Cost Tracking (Beta)

Exaix tracks the cost of AI provider calls, applies a daily spending limit and helps you find expensive operations.

## Reading the cost report

`exactl log cost` lists the persisted provider calls with their cost and the source of each price. `--group-by model`, `--group-by portal` or `--group-by service` gives per-group call counts, prompt and completion tokens, cache-read and cache-creation tokens, and total USD cost. A group also shows the share of its cost per price source. Filters such as `--portal`, `--model`, `--trace` and `--since` apply before grouping. Every option is in the generated [log reference](../cli/log.md#exactl-log-cost).

### How Cost Tracking Works

Cost tracking operates at multiple levels:

1. **Per-Request Tracking**: Each agent execution logs token usage and estimated cost
1. **Daily Budget Enforcement**: Prevents exceeding your daily spending limit
1. **Provider-Specific Rates**: Different rates for different models and providers
1. **Historical Reporting**: Query past usage and costs via Activity Journal

### Configuration

The daily spending limit is `max_daily_cost_usd` in `[provider_strategy]`. It defaults to 5.00 USD and is described with the provider strategy in [Model Settings](model-settings.md). The `[cost_tracking]` block tunes how costs are recorded:

```toml
[provider_strategy]
max_daily_cost_usd = 50.0  # Daily spending limit across all providers

[cost_tracking]
batch_delay_ms = 5000      # Delay between cost batch flushes (default)
max_batch_size = 50        # Cost entries per flush (default)

[cost_tracking.rates]
# Flat estimate per provider, used only when no better price is available
anthropic = 0.000015       # $15 per million tokens
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

When enabled, Exaix derives section budgets for `system`, `plan`, `portalKnowledge`, `memory`, `skills`, and `loopHistory` before assembling the final prompt.

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

The ceiling is validated at configuration time against the allocator's minimum feasible total (`MIN_COST_TARGET_TOKENS_PER_REQUEST`). A value below it is rejected when the config loads, not on every request. The effective ceiling resolves in this order: a Config DB override (`exactl config set budget.cost_target_tokens_per_request <n>`), then the TOML value, then the legacy `budget_enforcement.costTargetTokens` field. A change takes effect on the next daemon restart. `budget.cloud_enforcement_enabled` and `budget.local_enforcement_enabled` gate enforcement for hosted and local models. `exactl config show --sources` lists the whole `budget` key surface.

### Monitoring Usage

Start with `exactl log cost --group-by model`, which shows where the money goes. For individual events, query the Activity Journal: `exactl log list --payload %cost% --limit 10` lists recent cost-related rows, and `--filter since=<date>` limits them to a day. Add `-o json` to process the rows with other tools.

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
