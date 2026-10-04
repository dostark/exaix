# Exaix Threat Model — LLM-Output-to-Sink Boundary

This document inventories every path where model output (LLM text, or an
editable plan/flow/memory file derived from it) crosses into an executable or
persisted sink. Each sink names its boundary validation and its status.

Scope: the model is assumed hostile. A value must be validated at the boundary
before it is used or persisted, never after.

## Sink inventory

| Sink                           | Location                                                                                   | Boundary validation                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Execution TOML tool-actions    | `packages/execution/src/execution_loop.ts:ExecutionLoop.parsePlanActions`                  | `PlanActionSchema.safeParse` per tool-bearing block. A schema-invalid action fails the plan (fail closed).                      |
| ReAct TOML tool-actions        | `packages/execution/src/strategies/react_loop_strategy.ts:ReActLoopStrategy.parseResponse` | `PlanActionSchema.safeParse` per action. A schema-invalid action is dropped and journaled as `agent.react_action_parse_failed`. |
| Structured plan read-back body | `packages/core/src/planning/structured_plan_parser.ts:parseStructuredPlanFromMarkdown`     | `StructuredPlanSchema.safeParse` over the regex-parsed body. A malformed step returns `null` (no plan).                         |
| Plan output at write boundary  | `packages/core/src/planning/plan_adapter.ts`                                               | `PlanSchema.safeParse` before a plan is written.                                                                                |
| Flow-definition ingestion      | `packages/flow/src/flow_loader.ts:FlowLoader.loadFlow`                                     | `FlowSchema.parse` before use.                                                                                                  |
| Memory writes                  | `packages/memory/src/{extraction,bank,session}/*`                                          | `*.parse` before persist.                                                                                                       |
| Request frontmatter            | `packages/core/src/parsing/markdown.ts`                                                    | `RequestSchema.safeParse` before use.                                                                                           |

## Tool-name authority

`PlanActionSchema` restricts `tool` to `EXECUTION_TOOL_NAMES`, canonicalizing
aliases first. Tool-name authority therefore lives at the parse boundary for
these two sinks. `ToolRegistry.execute` keeps its own unknown-parameter and
permitted-tool checks as defense in depth.

`PlanActionSchema` does not validate per-tool required parameters. Missing
parameters still fail inside each tool executor. Adding a registry-level
required-parameter gate is tracked separately.

## Out of scope

Native tool-use responses (provider tool-call blocks) are normalized by
`parseNativeToolResponse` and are not part of the TOML sinks above. Their
handling is owned by the provider/tool-call pipeline.
