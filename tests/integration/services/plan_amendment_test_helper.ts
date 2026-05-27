/**
 * @module PlanAmendmentTestHelper
 * @path tests/integration/services/plan_amendment_test_helper.ts
 * @description Shared executor, context, and artifact-path helpers for plan amendment integration tests.
 */

import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { PlanAmendmentService } from "@exaix/core/planning";
import { PlanExecutor } from "@exaix/core/planning";
import { PlanAmendmentPendingError } from "@exaix/core/planning";
import type { ConfidenceScorer } from "@exaix/execution";
import { createMockConfig } from "@exaix/testing";
import { castAny as castTo, createStubDb } from "@exaix/testing";

interface IPlanStepInput {
  number: number;
  title: string;
  content: string;
}

interface ICreatePlanAmendmentExecutorOptions {
  root: string;
  llm: IModelProvider;
  enabled?: boolean;
  threshold: number;
  expiryMs: number;
  scorer?: ConfidenceScorer;
}

interface ICreatePlanAmendmentServiceOptions {
  root: string;
  llm: IModelProvider;
  enabled?: boolean;
  threshold?: number;
  expiryMs?: number;
}

interface IPlanExecutionContext {
  trace_id: string;
  request_id: string;
  identity: string;
  frontmatter: {
    portal: string;
  };
  steps: IPlanStepInput[];
}

interface IPlanAgentExecutorLike {
  executeStep?: (...args: never[]) => Promise<{ description: string }> | { description: string };
  dispose?: () => void;
}

interface IPlanExecutorWithAgentFactory {
  createAgentExecutor: () => IPlanAgentExecutorLike;
}

interface IStoredPlanAmendmentArtifact {
  amendmentContent: string;
  amendmentPath: string;
  amendmentsDir: string;
  entries: Deno.DirEntry[];
}

interface IPlanAmendmentPendingScenarioOptions {
  llm: IModelProvider;
  traceId: string;
  requestId: string;
  steps: IPlanStepInput[];
  threshold: number;
  expiryMs: number;
  enabled?: boolean;
  scorer?: ConfidenceScorer;
  agentExecutor?: IPlanAgentExecutorLike;
}

interface IPlanAmendmentPendingScenarioResult extends IStoredPlanAmendmentArtifact {
  config: Config;
  root: string;
}

const DEFAULT_PLAN_AMENDMENT_THRESHOLD = 60;
const DEFAULT_PLAN_AMENDMENT_EXPIRY_MS = 86_400_000;

export function createPlanExecutionContext(
  traceId: string,
  requestId: string,
  steps: IPlanStepInput[],
): IPlanExecutionContext {
  return {
    trace_id: traceId,
    request_id: requestId,
    identity: "user-1",
    frontmatter: { portal: "workspace" },
    steps,
  };
}

export function createPlanAmendmentExecutor(options: ICreatePlanAmendmentExecutorOptions): {
  config: Config;
  executor: PlanExecutor;
} {
  const config = createMockConfig(options.root, {
    amendment: {
      enabled: options.enabled ?? true,
      threshold: options.threshold,
      expiryMs: options.expiryMs,
      hitl_timeout_ms: 300_000,
      on_timeout: "abort",
    },
  });

  const executor = new PlanExecutor(
    config,
    options.llm,
    createStubDb(),
    options.root,
    {
      ...(options.scorer ? { confidenceScorer: options.scorer } : {}),
      enableGit: false,
    },
  );

  return { config, executor };
}

export function createPlanAmendmentServiceForTest(
  options: ICreatePlanAmendmentServiceOptions,
): { config: Config; service: PlanAmendmentService } {
  const config = createMockConfig(options.root, {
    amendment: {
      enabled: options.enabled ?? true,
      threshold: options.threshold ?? DEFAULT_PLAN_AMENDMENT_THRESHOLD,
      expiryMs: options.expiryMs ?? DEFAULT_PLAN_AMENDMENT_EXPIRY_MS,
      hitl_timeout_ms: 300_000,
      on_timeout: "abort",
    },
  });

  return {
    config,
    service: new PlanAmendmentService(config, options.llm),
  };
}

export function attachPlanAgentExecutor(
  executor: PlanExecutor,
  agentExecutor: IPlanAgentExecutorLike,
): void {
  castTo<IPlanExecutorWithAgentFactory>(executor).createAgentExecutor = () => agentExecutor;
}

export function getPlanAmendmentsDir(root: string, config: Config, traceId: string): string {
  return join(root, config.paths.memory, config.paths.memoryExecution, traceId, "amendments");
}

export async function readDirEntries(path: string): Promise<Deno.DirEntry[]> {
  return await Array.fromAsync(Deno.readDir(path));
}

export async function executeUntilPlanAmendmentPending(
  executor: PlanExecutor,
  context: IPlanExecutionContext,
): Promise<void> {
  await assertRejects(
    async () => {
      await executor.execute("plan.md", context);
    },
    PlanAmendmentPendingError,
  );
}

export async function readStoredPlanAmendmentArtifact(
  root: string,
  config: Config,
  traceId: string,
): Promise<IStoredPlanAmendmentArtifact> {
  const amendmentsDir = getPlanAmendmentsDir(root, config, traceId);
  const entries = await readDirEntries(amendmentsDir);
  const amendmentPath = join(amendmentsDir, entries[0].name);
  const amendmentContent = await Deno.readTextFile(amendmentPath);

  return {
    amendmentContent,
    amendmentPath,
    amendmentsDir,
    entries,
  };
}

export async function withPlanAmendmentPendingScenario<T>(
  options: IPlanAmendmentPendingScenarioOptions,
  run: (result: IPlanAmendmentPendingScenarioResult) => T | Promise<T>,
): Promise<T> {
  const root = await Deno.makeTempDir();

  try {
    const { config, executor } = createPlanAmendmentExecutor({
      root,
      llm: options.llm,
      enabled: options.enabled,
      threshold: options.threshold,
      expiryMs: options.expiryMs,
      scorer: options.scorer,
    });
    const context = createPlanExecutionContext(options.traceId, options.requestId, options.steps);

    attachPlanAgentExecutor(
      executor,
      options.agentExecutor ?? {
        executeStep: () => Promise.resolve({ description: "Result" }),
        dispose: () => {},
      },
    );

    await executeUntilPlanAmendmentPending(executor, context);

    return await run({
      root,
      config,
      ...(await readStoredPlanAmendmentArtifact(root, config, options.traceId)),
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
