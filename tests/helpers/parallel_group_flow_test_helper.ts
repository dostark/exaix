/**
 * @module ParallelGroupFlowTestHelper
 * @path tests/helpers/parallel_group_flow_test_helper.ts
 * @description Shared flow builders and runner harnesses for parallel-group integration tests.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, tests/helpers/flow_namespace_test_helper.ts]
 */

import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import type { IFlowInput } from "@exaix/schemas/flow.ts";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import {
  RecordingFlowLogger,
  ScriptedAgentExecutor,
  type ScriptedExecutorResponse,
} from "./flow_namespace_test_helper.ts";

interface IParallelGroupMemberStep {
  stepId: string;
  stepName: string;
  identityId: string;
}

interface ICreateParallelGroupFlowOptions {
  flowId: string;
  flowName: string;
  description: string;
  groupId: string;
  memberSteps: IParallelGroupMemberStep[];
  mergeStepId?: string;
  mergeStepName?: string;
  mergeIdentityId?: string;
}

interface IScriptedFlowRunnerHarness {
  executor: ScriptedAgentExecutor;
  logger: RecordingFlowLogger;
  runner: FlowRunner;
}

export function createParallelGroupFlow(options: ICreateParallelGroupFlowOptions): IFlowInput {
  const mergeStepId = options.mergeStepId ?? "merge";
  const mergeStepName = options.mergeStepName ?? "Merge";
  const mergeIdentityId = options.mergeIdentityId ?? "merger";

  return {
    id: options.flowId,
    name: options.flowName,
    description: options.description,
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "start",
        name: "Start",
        identity: "starter",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      ...options.memberSteps.map((step) => ({
        id: step.stepId,
        name: step.stepName,
        identity: step.identityId,
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: options.groupId },
      })),
      {
        id: mergeStepId,
        name: mergeStepName,
        identity: mergeIdentityId,
        dependsOn: options.memberSteps.map((step) => step.stepId),
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: [options.groupId],
      },
    ],
    output: { from: mergeStepId, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: false },
  };
}

export function createScriptedFlowRunner(
  config: Config,
  scripts: Record<string, ScriptedExecutorResponse[]>,
): IScriptedFlowRunnerHarness {
  const executor = new ScriptedAgentExecutor(scripts);
  const logger = new RecordingFlowLogger();
  const runner = new FlowRunner({
    agentExecutor: executor,
    eventLogger: logger,
    config,
  });

  return { executor, logger, runner };
}
