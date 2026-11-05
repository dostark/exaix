/**
 * @module ReActPromptBuilderTestHelper
 * @path packages/execution/tests/helpers/react_prompt_builder.ts
 * @description Builds the real PromptBuilder that ReAct strategy test doubles need as their executor's promptBuilder.
 * @architectural-layer Test
 * @related-files [packages/execution/src/prompt_builder.ts, packages/execution/src/react_loop_adapter.ts]
 */

export { createReActPromptBuilder } from "@exaix/execution/testing";
