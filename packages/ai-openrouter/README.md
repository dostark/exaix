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
