# @exaix/ai-openrouter

OpenRouter provider for Exaix. One API key reaches the models in the OpenRouter catalog through `https://openrouter.ai/api/v1`.

Setup, the configuration keys and the per-model caveats are in the [Exaix User Guide, section 2.4.4](../../docs/Exaix_User_Guide.md#244-enterprise-providers-vertex-ai-openrouter).

## Behavior

- **Capabilities.** Tool support and reasoning controls come from each model's catalog entry. A tool request to a model with no tool support is refused before the chat call.
- **Structured output.** A strict-representable schema uses `json_schema`. Other schemas use `json_object` with the schema in the prompt. A route that refuses `json_schema` gets one retry with `json_object`. Replies are validated locally, and an invalid reply fails closed.
- **Thinking.** Thinking off sends `reasoning.enabled: false` for optional-reasoning models. A mandatory-reasoning model receives its lowest listed effort.
- **Prompt caching.** `cache_control` breakpoints go only to the models in OpenRouter's prompt-caching guide. `[ai_openrouter] cache_control = false` turns them off.
- **Routing.** `provider.require_parameters` is sent as `true` when a request carries tools, a response format or reasoning. A trace id is sent as the sticky session key when no `provider.order` is set.
- **Replay.** Replayed assistant messages carry `reasoning_details` unchanged. `reasoning_content` is not sent.
- **Cost.** `usage.cost` is read as OpenRouter credits.

## Request fields

Every field that the provider sends to the chat completions endpoint has one row. The source is the OpenRouter guide that documents the field, or the Phase 211 decision where the guide is silent or the choice is Exaix's own. A test (`tests/openrouter_request_fields_test.ts`) builds the widest request and fails when a field has no row.

| Field                                | Sent when                                                                               | Source                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                              | Always                                                                                  | Chat completions reference                                                                                                                            |
| `messages`                           | Always                                                                                  | Chat completions reference                                                                                                                            |
| `max_tokens`                         | The call sets a limit                                                                   | Parameters page                                                                                                                                       |
| `temperature`                        | The call sets it and the model lists it                                                 | Parameters page. The model entry check drops an unlisted hint                                                                                         |
| `top_p`                              | The call sets it and the model lists it                                                 | Parameters page. The model entry check drops an unlisted hint                                                                                         |
| `stop`                               | The call sets it and the model lists it                                                 | Parameters page. The model entry check drops an unlisted hint                                                                                         |
| `tools`                              | The call offers tools                                                                   | Tool-calling guide                                                                                                                                    |
| `tool_choice`                        | The call offers tools                                                                   | Tool-calling guide. A forced choice with one tool is the named function, and with several tools it is `auto`. `required` is never sent (decision Q37) |
| `parallel_tool_calls`                | The run turns parallel calls off                                                        | Parameters page. Sent as `false` only                                                                                                                 |
| `response_format`                    | The call has an output schema                                                           | Structured outputs guide. The `json_object` fallback for a route that refuses `json_schema` is undocumented for OpenRouter (decision Q39)             |
| `reasoning`                          | The call sets effort, a thinking budget or thinking off, and the model accepts it       | Reasoning tokens guide. `enabled: false` for thinking off is not documented as a disable (decision Q36)                                               |
| `models`                             | The operator sets a fallback list of at most three models                               | Model routing guide                                                                                                                                   |
| `provider`                           | Any `provider.*` field is sent                                                          | Provider selection guide. The container for the rows below                                                                                            |
| `provider.order`                     | The operator sets it                                                                    | Provider selection guide. It disables sticky routing                                                                                                  |
| `provider.only`                      | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.ignore`                    | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.sort`                      | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.require_parameters`        | The request has tools, a response format or reasoning, unless the operator sets a value | Provider selection guide. Exaix sets `true` by default (decision Q5)                                                                                  |
| `provider.allow_fallbacks`           | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.quantizations`             | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.max_price`                 | The operator sets it                                                                    | Provider selection guide. Prompt and completion prices are in dollars per million tokens                                                              |
| `provider.data_collection`           | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `provider.zdr`                       | The operator sets it                                                                    | Provider selection guide                                                                                                                              |
| `session_id`                         | The call has a trace id of at most 256 characters and `provider.order` is unset         | Prompt-caching guide. The trace id is the sticky session key (decision Q30)                                                                           |
| `messages[].content[].cache_control` | The model is in the prompt-caching guide's list and `cache_control` is on               | Prompt-caching guide (decision Q38)                                                                                                                   |

## Modules

| File                                   | Responsibility                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `src/openrouter_provider.ts`           | `OpenRouterProvider`: request body, attempts and the tool-choice retry |
| `src/openrouter_factory.ts`            | Builds provider instances from the configuration                       |
| `src/openrouter_model_capabilities.ts` | Catalog lookup over the models endpoint and the pre-call tool refusal  |
| `src/openrouter_reasoning.ts`          | Thinking-off and effort encoding (`reasoningFor`)                      |
| `src/openrouter_structured_output.ts`  | `json_schema` and `json_object` planning                               |
| `src/openrouter_cache_control.ts`      | `cache_control` breakpoints for the listed models                      |
| `src/openrouter_routing.ts`            | Routing policy, `require_parameters` and the session key               |
| `src/openrouter_reported_cost.ts`      | Reads `usage.cost` as credits                                          |
| `src/openrouter_response.ts`           | Content, tool-call and finish-reason extraction                        |
| `src/openrouter_errors.ts`             | Maps an error response to one typed error                              |
| `src/constants.ts`                     | Provider metadata, effort order, caching list and limits               |

## Tests

- Unit tests: `packages/ai-openrouter/tests/`
- Wiring test: `tests/integration/openrouter_adapter_wiring_test.ts`
- Live cases are opt-in and make paid calls. They need `EXA_TEST_ENABLE_PAID_LLM=1` and `OPENROUTER_API_KEY`: `tests/integration/openrouter_structured_output_live_test.ts` and `tests/integration/parallel_tool_round_live_test.ts`.

## Status

Live verification is partial. The Phase 211 plan records the final matrix run, including its two open failures: [phase 211 plan](../../exaix-dev-docs/planning/phase-211-openrouter-adapter-improvements.md) and [Step 9 evidence](../../exaix-dev-docs/planning/evidence/phase-211/live-matrix-2026-10-12.md).
