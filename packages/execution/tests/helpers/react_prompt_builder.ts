/**
 * @module ReActPromptBuilderTestHelper
 * @path packages/execution/tests/helpers/react_prompt_builder.ts
 * @description Builds the real PromptBuilder that ReAct strategy test doubles need as their executor's promptBuilder.
 * @architectural-layer Test
 * @related-files [packages/execution/src/prompt_builder.ts, packages/execution/src/react_loop_adapter.ts]
 */

import { createNoopEventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { ExecutionContextService } from "../../src/execution_context_service.ts";
import { PromptBuilder } from "../../src/prompt_builder.ts";

/** A PromptBuilder over a no-op logger and an empty execution context, with no budget and no portal root. */
export function createReActPromptBuilder(): PromptBuilder {
  const logger = createNoopEventLogger();
  return new PromptBuilder(logger, new ExecutionContextService(createMockConfig("/tmp"), logger, {}));
}
