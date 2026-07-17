/**
 * @module ReActLoopTruncationTest
 * @path packages/execution/tests/agents/react_loop_truncation_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/tests/agents/react_loop_conversation_history_test.ts]
 * @architectural-layer Services
 * @description Offline (mock-provider) tests for ReActLoopStrategy's output-token
 * budget: every loop turn must request a max_tokens matching the planning path's
 * provider default (8192 — thinking blocks count against the same budget), and a
 * turn that stops at max_tokens must journal agent.response_truncated so the
 * resulting TOML-parse failure is attributable to truncation, not treated as a
 * mysteriously malformed model response.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { AGENT_EVENT_RESPONSE_TRUNCATED, ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

/** Provider that captures per-call options and stamps a scripted stop_reason. */
class OptionsCapturingProvider implements IModelProvider {
  readonly id = "mock-truncation-provider";
  readonly capturedOptions: Array<IModelOptions | undefined> = [];

  constructor(private stopReason?: string) {}

  async generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    await Promise.resolve();
    this.capturedOptions.push(options);
    return {
      content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
      stop_reason: this.stopReason,
    };
  }
}

interface ICapturedWarn {
  action: string;
  target: string | null;
  payload?: LogMetadata;
  traceId?: string;
}

function buildWarnCapturingLogger(sink: ICapturedWarn[]): IEventLogger {
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: (action: string, target: string | null, payload?: LogMetadata, traceId?: string) => {
      sink.push({ action, target, payload, traceId });
      return Promise.resolve();
    },
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => logger,
  };
  return logger;
}

function buildExecutor(warnSink: ICapturedWarn[]): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (response: string, context: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${context.portal || "test"}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: response,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    budgetLogger: buildWarnCapturingLogger(warnSink),
  } as ReActExecutor;
}

const testBlueprint = {
  name: "truncation-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-33333333-3333-4333-8333-333333333333",
  request_id: "request-truncation",
  request: "trivial task",
  plan: "trivial plan",
  portal: "test",
} satisfies IExecutionContext;

const testOptions: IAgentExecutionOptions = {
  identity_id: "truncation-test-agent",
  portal: "test",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

Deno.test("ReActLoop budget: each turn requests max_tokens matching the planning-path default (8192)", async () => {
  const provider = new OptionsCapturingProvider();
  const strategy = new ReActLoopStrategy(buildExecutor([]), provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assertEquals(provider.capturedOptions.length, 1);
  // Parity with configs' ai_anthropic.max_tokens_default: on models whose thinking
  // blocks count against the output budget, 4000 left too little room for a thought
  // plus a TOML edit action on non-toy files.
  assertEquals(provider.capturedOptions[0]?.max_tokens, 8192);
});

Deno.test("ReActLoop budget: a turn stopping at max_tokens journals agent.response_truncated", async () => {
  const warns: ICapturedWarn[] = [];
  const provider = new OptionsCapturingProvider("max_tokens");
  const strategy = new ReActLoopStrategy(buildExecutor(warns), provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  const truncationWarn = warns.find((w) => w.action === AGENT_EVENT_RESPONSE_TRUNCATED);
  assertExists(
    truncationWarn,
    "a max_tokens stop means the turn was cut off — the following parse failure must be attributable in the journal",
  );
  assertEquals(truncationWarn.payload?.stop_reason, "max_tokens");
  assertEquals(truncationWarn.traceId, testContext.trace_id);
});

Deno.test("ReActLoop budget: a complete turn (end_turn) journals no truncation warning", async () => {
  const warns: ICapturedWarn[] = [];
  const provider = new OptionsCapturingProvider("end_turn");
  const strategy = new ReActLoopStrategy(buildExecutor(warns), provider);

  await strategy.execute(testBlueprint, testContext, testOptions);

  assert(
    warns.every((w) => w.action !== AGENT_EVENT_RESPONSE_TRUNCATED),
    "end_turn is a complete response — warning on it would train operators to ignore the event",
  );
});
