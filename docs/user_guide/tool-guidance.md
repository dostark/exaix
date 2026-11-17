# Tool Guidance

ACI tool guidance, read-only planning tools and parallel tool calls. Part of the [Exaix User Guide](README.md).

## ACI (Agent-Computer Interface) Tool Guidance

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

## Planning read-only tools

By default the planning/analysis call every request makes before any execution-loop code runs is
**single and tool-less**: the model sees a file listing plus a bounded portal-knowledge summary,
but cannot open a file or follow a relationship to inspect the portal it is about to plan against.
The `[planning]` block makes that call a bounded, **read-only** tool loop instead, so the model can
read files and query the portal's knowledge graph before committing to a plan.

```toml
# exa.config.toml — NEW, additive
[planning]
# Enable the bounded read-only tool loop in the planning LLM call.
# Default: false (single-call planning — today's behavior, byte-identical).
tools_enabled = false

# Max generate rounds, including the mandatory tool-less final round. 1 = no tools.
# Range: 1-10. Default: 2.
max_tool_rounds = 2

# Max tokens of a single tool result prepended back to the model on a later round.
# Longer results are truncated (never dropped). Range: 256-50000. Default: 2000.
max_tool_result_tokens = 2000

# Max tool calls executed in one round. Providers may return parallel calls even when the
# request disables them; calls past the cap get an error result and are not executed.
# Range: 1-20. Default: 3.
max_tool_calls_per_round = 3
```

**Opt-in and live.** `tools_enabled` defaults to `false`; an unset or disabled deployment produces
exactly the single-call planning request it did before. All four keys are live-read (`SwapClass.HOT`),
so `exactl config set` takes effect on the next request — no daemon restart:

```bash
exactl config set planning.tools_enabled true
exactl config set planning.max_tool_rounds 3
exactl config set planning.max_tool_result_tokens 4000
exactl config set planning.max_tool_calls_per_round 5
```

**Read-only by construction.** Only tools whose side-effect scope is `none` are offered, minus
`list_available_tools` (which would advertise write tools the planner can never call). A planning
call can never write, patch, delete, move, or run a command. The ten offered tools are:
`read_file`, `list_directory`, `search_files`, `search_text`, `git_info`, `query_relationships`,
`find_dependents`, `query_symbols`, `get_module_dependencies`, and `search_memory`. Adding a new
`none`-scoped tool to the Solo catalog automatically extends this list.

**Requirements.** The loop activates only when every gate below holds:

- The selected model's provider supports native tool-calling — `anthropic`, `openai`, `google`, or
  `openrouter`. Subscription-CLI providers (`claude`, `opencode`, `codex`), `ollama`, and the
  `mock` provider's default path do not.
- The request names a portal whose `operations` include `read` and whose `agents_allowed` permits
  the request's agent role.
- The daemon has a planner tool-registry factory and tokenizer (the default daemon boot always has).

When `tools_enabled` is on but a requirement fails, the request still runs single-call and the
journal records a `planning.tools.skipped` event whose payload `reason` is one of:

| Reason                 | Meaning                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `provider_unsupported` | The selected provider has no native tool-calling support           |
| `no_portal`            | The request has no portal, or its alias is not in `config.portals` |
| `no_registry`          | No planner tool-registry factory or tokenizer is configured        |
| `portal_read_denied`   | The portal denies `read`, or `agents_allowed` excludes the role    |

**Cost.** Enabling the loop multiplies the generate calls for a request: up to `max_tool_rounds` per
`AgentRunner.run()`, and up to three runs when the request processor's plan-validation feedback
retries apply — a worst case of `3 × max_tool_rounds` generate calls per request. Each round resends
the prompt, so prompt tokens also scale with the round count. The prompt-budget allocator reserves
headroom for tool results when the flag is on (`max_tool_calls_per_round` results per round), each
result is capped by `max_tool_result_tokens`, and
`exactl request create --dry-run-context` prints the catalog, its activation state, and the
worst-case extra tokens/cost per run without sending a request.

**Visibility and confinement.** Every executed planning tool call is journaled as a
`dynamic_tool_call` event with `phase: "planning"` and target `"planning"`, and each loop emits one
`planning.tools.completed` event with the round/tool-call count, stop reason, and summed tokens.
Tool results are treated as untrusted repository data (never instructions), are screened through the
guardrail runner when one is configured, and are confined to the request portal's real path — any
absolute, cross-portal, symlinked, or `../`-escaping path is rejected with a
`security.path_access_denied` event. `search_files` also rejects a `pattern` containing `..`
segments or an absolute prefix and never lists a path outside its search root.

**Final-round contract.** A native conversation keeps the original prompt and completed
assistant/tool-result rounds, omits tool definitions on the final request, and sets
`toolChoice: none`. Tools are never executed on that round. The legacy replay path
keeps its tool definitions with `toolChoice: none`. A completed Anthropic Haiku request
through OpenRouter confirmed the native contract; the unit checks cover each native
provider. Empty or refused responses do not establish that the contract was accepted.

**Failure handling.** If the final round returns no text (some providers ignore `toolChoice: none`),
the loop records `planning.tools.completed` with `stopReason: "empty_final"` and the request falls
back to one single-call plan instead of repeating the loop. If a round throws, the loop emits one
`planning.tools.aborted` event with the rounds, tool calls and tokens spent before the failure, then
re-raises the error.

## Parallel tool calls

A model response can ask for several tools at once. `tools.parallel_calls` decides how many of those calls Exaix
runs. The setting applies to the native ReAct loop and to the planning tool loop.

| Mode             | Behaviour                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto` (default) | Keeps the provider default. Exaix sends no parallel flag, and each response runs up to its loop cap.                                                         |
| `off`            | Asks the provider for one call per response, where the provider accepts that flag. Exaix runs at most one call per response either way and refuses the rest. |

Each limit has a default and bounds. A value outside the bounds is rejected when the config loads.

| Key                                 | Default | Min   | Max      | Effect                                                                                           |
| ----------------------------------- | ------- | ----- | -------- | ------------------------------------------------------------------------------------------------ |
| `tools.parallel_calls`              | `auto`  | -     | -        | `auto` or `off`, as described above.                                                             |
| `tools.max_calls_per_turn`          | 4       | 1     | 20       | Calls one ReAct native response may run in `auto`. Extra calls receive an error result.          |
| `tools.max_concurrent_calls`        | 4       | 1     | 8        | Stored in the round policy. Calls do not overlap in this phase.                                  |
| `tools.max_response_calls`          | 64      | 1     | 128      | Calls one response may carry. It must be at least both loop caps, or the config is rejected.     |
| `tools.max_call_argument_bytes`     | 65536   | 1024  | 1048576  | Argument bytes allowed for one call. A round with a larger call is refused before any call runs. |
| `tools.max_round_replay_bytes`      | 1048576 | 16384 | 16777216 | Bytes one round may replay, counting assistant content and results together.                     |
| `tools.max_result_tokens`           | 2048    | 128   | 16384    | Token cap on one ReAct tool result before it is replayed.                                        |
| `planning.max_tool_rounds`          | 2       | 1     | 10       | Generate rounds in the planning loop, including the final round with no tools.                   |
| `planning.max_tool_result_tokens`   | 2000    | 256   | 50000    | Token cap on one planning tool result before it is replayed.                                     |
| `planning.max_tool_calls_per_round` | 3       | 1     | 20       | Calls the planning loop runs per round in `auto`. Extra calls receive an error result.           |

Config DB overrides of the `tools.*` keys above take precedence over the TOML values. Exaix reads the policy before
each model turn, so a change applies from the next turn.

The response, argument and replay limits apply to both loops. A response that breaks one, or that reuses a call id from
an earlier round, is refused before any call runs. A round whose assistant content and results together exceed the
replay limit stops the loop before the next model call, and no result is dropped. A call that the loop cap refuses is
journaled with the limit message, in both loops.

Under `auto`, the planning loop runs up to `planning.max_tool_calls_per_round` calls per round, and ReAct runs up to
`tools.max_calls_per_turn`. Under `off`, both caps are one. Exaix enforces the cap itself, so a provider that ignores the
parallel flag still executes at most one call per response.

A native ReAct loop needs `[execution] native_tools_enabled = true`. The planning tool loop needs
`[planning] tools_enabled = true`. Both need a provider that supports native tool calls.

This phase runs calls one after another, in the order the model returned them. Batch dispatch and overlapping
calls are not available yet.

A serial Flow dynamic step asks for one call per decision. A response with more than one call is rejected with an
error.

Example: keep the default. This fragment is part of a full configuration.

```toml
[tools]
parallel_calls = "auto"
```

Example: one call per response.

```toml
[tools]
parallel_calls = "off"
```

Example: a planning loop with four rounds and three calls per round.

```toml
[planning]
tools_enabled = true
max_tool_rounds = 4
max_tool_calls_per_round = 3
```
