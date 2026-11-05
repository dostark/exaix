/**
 * @module ExecutionTesting
 * @path packages/execution/testing/mod.ts
 * @description Shared composer prompt fixture for package and integration tests.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_composer.ts]
 */
import { createNoopEventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { ExecutionContextService, PromptBuilder } from "@exaix/execution";
import type { AgentComposer, IAgentFileBlueprint, IPinnedSkillPrompt, ReActLoopStrategy } from "@exaix/execution";
import type { Opt, Reason } from "@exaix/core/types";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

type TReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

/** The shared methods of fixed-result ReAct executor fixtures. */
export interface ITestExecutorPlumbing {
  promptBuilder: TReActExecutor["promptBuilder"];
  logAgentOutput: () => Promise<void>;
  validateReviewResult: (result: IChangesetResult) => IChangesetResult;
  parseAgentResponse: () => IChangesetResult;
  logGeneration: () => Promise<void>;
}

export function buildExecutionPrompt(
  executor: AgentComposer,
  blueprint: IAgentFileBlueprint,
  context: IExecutionContext,
  options: IAgentExecutionOptions,
  pinnedSkills?: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
): Promise<string> {
  const permitted = options.permitted_tools;
  const visibleTools = (executor["_toolRegistry"]?.getTools() ?? []).filter((tool) =>
    permitted === undefined || permitted.includes(tool.name)
  );
  return executor["promptBuilder"].buildExecutionPrompt(
    blueprint,
    context,
    options,
    {
      historyText: "",
      skipToolProse: false,
      visibleToolIds: visibleTools.map((tool) => tool.name),
    },
    pinnedSkills?.text,
  );
}

export function completedTestChangeset(): IChangesetResult {
  return {
    branch: "feat/test",
    commit_sha: "0000000000000000000000000000000000000000",
    files_changed: [],
    description: "Task completed",
    tool_calls: 0,
    execution_time_ms: 0,
  };
}

export function fixedExecutorPlumbing(promptBuilder: TReActExecutor["promptBuilder"]): ITestExecutorPlumbing {
  return {
    promptBuilder,
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (result: IChangesetResult): IChangesetResult => result,
    parseAgentResponse: completedTestChangeset,
    logGeneration: async () => {
      await Promise.resolve();
    },
  };
}

/** Builds a prompt builder with an empty context and a no-op logger. */
export function createReActPromptBuilder(): PromptBuilder {
  const logger = createNoopEventLogger();
  return new PromptBuilder(logger, new ExecutionContextService(createMockConfig("/tmp"), logger, {}));
}
