/**
 * @module ReActLoopParseFailureTest
 * @path packages/execution/tests/agents/react_loop_parse_failure_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Offline test: a ReAct action whose ```toml block fails to parse must
 * be journaled (agent.react_action_parse_failed), not silently swallowed. A dropped
 * action that leaves no trace is how a fix can vanish with the loop reporting success.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  ExecutionStrategyName,
  REACT_EVENT_ACTION_PARSE_FAILED,
  REACT_THOUGHT_PREFIX,
  SecurityMode,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

class SingleResponseProvider implements IModelProvider {
  readonly id = "mock-parse-provider";
  constructor(private response: string) {}
  async generate(): Promise<IGenerateResult> {
    await Promise.resolve();
    return {
      content: this.response,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

interface ICapturedWarn {
  action: string;
  payload?: LogMetadata;
}

function buildExecutor(warnSink: ICapturedWarn[]): ReActExecutor {
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: (action: string, _t: string | null, payload?: LogMetadata) => {
      warnSink.push({ action, payload });
      return Promise.resolve();
    },
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => logger,
  };
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (response: string, ctx: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${ctx.portal || "test"}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: response,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    budgetLogger: logger,
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true, data: "ok" };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  } as ReActExecutor;
}

const blueprint = {
  name: "parse-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const context = {
  trace_id: "trace-55555555-5555-4555-8555-555555555555",
  request_id: "request-parse",
  request: "do a thing",
  plan: "plan",
  portal: "test",
} satisfies IExecutionContext;

const options: IAgentExecutionOptions = {
  agent_role: "parse-test-agent",
  portal: "test",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

Deno.test("ReActLoop: a malformed TOML action block is journaled, not silently swallowed", async () => {
  const warns: ICapturedWarn[] = [];
  // A ```toml block that is not valid TOML (unterminated quote) — parseToml throws.
  const badBlock = `${REACT_THOUGHT_PREFIX}Applying a change.
\`\`\`toml
[[actions]]
tool = "write_file
[actions.params]
path = "src/x.ts"
\`\`\`
`;
  const strategy = new ReActLoopStrategy(buildExecutor(warns), new SingleResponseProvider(badBlock));

  // The malformed block yields no actions and no completion, so the loop throws
  // "no actions" — but the parse failure must be journaled BEFORE that.
  await strategy.execute(blueprint, context, options).catch(() => {});

  const parseWarn = warns.find((w) => w.action === REACT_EVENT_ACTION_PARSE_FAILED);
  assertExists(parseWarn, "a dropped action must leave a journal trace, not vanish silently");
  assertEquals(parseWarn.payload?.trace_id, context.trace_id);
});
