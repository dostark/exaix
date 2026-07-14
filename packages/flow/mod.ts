/**
 * @module Flow
 * @path packages/flow/mod.ts
 * @related-files []
 * @architectural-layer Flow
 * @description Flow orchestration, storage, reporting, validation, and dependency resolution.
 */

export type { IFlowCheckpointService } from "./src/checkpoint_service.ts";
export type { IFlowNamespaceService, IFlowNamespaceSnapshot } from "./src/namespace_service.ts";
export type { IFlowReportConfig, IFlowReportResult } from "./src/reporter.ts";
export type { IConditionContext } from "./src/condition_evaluator.ts";
export type { FeedbackLoopConfig } from "./src/feedback_loop.ts";
export type { IFeedbackLoopResult } from "./src/feedback_loop.ts";
export type { IAgentRequestContext } from "./src/feedback_loop.ts";
export type { IIterationResult } from "./src/feedback_loop.ts";
export type { IImprovementAgent } from "./src/feedback_loop.ts";
export type { ISelfCorrectingConfig } from "./src/feedback_loop.ts";
export type { IAgentExecutor } from "./src/flow_runner.ts";
export type { IFlowEventLogger } from "./src/flow_runner.ts";
export type { IFlowEventPayload } from "./src/flow_runner.ts";
export type { IFlowEventPayloadMap } from "./src/flow_runner.ts";
export type { IFlowResult } from "./src/flow_runner.ts";
export type { IFlowRunner } from "./src/flow_runner.ts";
export type { IFlowRunnerConfig } from "./src/flow_runner.ts";
export type { IFlowStepRequest } from "./src/flow_runner.ts";
export type { IParallelGroupSummary } from "./src/flow_runner.ts";
export type { IStepResult } from "./src/flow_runner.ts";
export type { GateConfig } from "./src/gate_evaluator.ts";
export type { IStepDurabilityStore } from "./src/contracts/step_durability.ts";
export type { IStepExecutionRecord } from "./src/contracts/step_durability.ts";
export type { IStepReplayPolicy } from "./src/contracts/step_durability.ts";
export { DefaultStepReplayPolicy } from "./src/contracts/step_durability.ts";

export * from "./src/wait_states/mod.ts";
export { mapPresetToSize } from "./src/preset_mapper.ts";
export { FlowCheckpointService } from "./src/checkpoint_service.ts";
export { FlowNamespaceService, NamespaceQuotaExceededError } from "./src/namespace_service.ts";
export { FlowReporter } from "./src/reporter.ts";
export { FlowValidatorImpl } from "./src/validator.ts";
export { FlowLoader } from "./src/flow_loader.ts";
export { DependencyResolver, FlowValidationError } from "./src/dependency_resolver.ts";
export { ActivityJournal } from "./src/activity_journal.ts";
export { ConditionEvaluationError, ConditionEvaluator } from "./src/condition_evaluator.ts";
export { ExpressionError, parseCondition } from "./src/safe_expression.ts";
export type { IActivityJournal, JournalEntry } from "./src/dynamic_step_executor.ts";
export { DynamicStepExecutor } from "./src/dynamic_step_executor.ts";
export { FeedbackLoop, FeedbackLoopConfigSchema } from "./src/feedback_loop.ts";
export { createFeedbackLoop, runSelfCorrectingAgent, SimpleImprovementAgent } from "./src/feedback_loop.ts";
export { FlowAbortError, FlowExecutionError, FlowRunner, toGateConfig } from "./src/flow_runner.ts";
export {
  FlowCheckpointCoordinator,
  type IFlowCheckpointCoordinator,
  type IFlowCheckpointCoordinatorDeps,
  type IFlowCheckpointRequest,
} from "./src/flow_checkpoint_coordinator.ts";
export { type IStepOutputFormatter, StepOutputFormatter } from "./src/step_output_formatter.ts";
export {
  FlowNamespaceCoordinator,
  type IFlowNamespaceCoordinator,
  type IFlowNamespaceCoordinatorDeps,
  type IFlowNamespaceOriginalRequest,
} from "./src/flow_namespace_coordinator.ts";
export { AgentOrchestratorAdapter } from "./src/agent_executor_adapter.ts";
export { GateConfigSchema, GateEvaluator, MockJudgeInvoker } from "./src/gate_evaluator.ts";
export { createJudgeEvaluator, JudgeEvaluator } from "./src/judge_evaluator.ts";

// Step 3 — Flow step-handler registry
export { FlowStepHandlerRegistry } from "./src/step_handlers/step_handler_registry.ts";
export { AgentStepHandler } from "./src/step_handlers/agent_step_handler.ts";
export { GateStepHandler } from "./src/step_handlers/gate_step_handler.ts";
export { UnknownFlowStepError } from "./src/step_handlers/flow_step_error.ts";
export type { IAgentStepHandlerDeps } from "./src/step_handlers/agent_step_handler.ts";
export type { IGateStepHandlerDeps, IPendingWaitStateRef } from "./src/step_handlers/gate_step_handler.ts";
export { VotingStepHandler } from "./src/step_handlers/voting_step_handler.ts";
export type { IVotingStepHandlerDeps } from "./src/step_handlers/voting_step_handler.ts";
export type {
  IFlowStepHandler,
  IFlowStepHandlerRegistry,
  IStepExecutionContext,
} from "./src/step_handlers/step_handler.ts";
