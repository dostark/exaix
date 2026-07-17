/**
 * @module ReActLoopStrategyLiveTest
 * @path packages/execution/tests/agents/react_loop_strategy_live_test.ts
 * @description Live-provider regression test for ReActLoopStrategy, isolating three
 *   behaviors no mock-provider test can prove: (1) a real model reads the AVAILABLE TOOLS
 *   list in the prompt ReActLoopStrategy actually sends and emits a valid, parseable TOML
 *   action block naming a real tool — not a hallucinated one; (2) the tool result actually
 *   reaches and is comprehended by the model, not merely called — the fixture content is
 *   multi-statement and the request demands the model repeat back the specific second
 *   statement, so a model that calls read_file but ignores/hallucinates the result cannot
 *   pass; (3) the same model recognizes "STATUS: COMPLETE" as the termination signal and
 *   stops on its own, rather than looping to DEFAULT_AGENT_MAX_ITERATIONS or never
 *   signaling done. Existing unit tests (react_loop_strategy_test.ts) hand-script a
 *   MockModelProvider to return REACT_STATUS_COMPLETE verbatim and a canned tool result,
 *   which proves the parser recognizes the string and the history-append plumbing works,
 *   but proves nothing about whether a real model actually reads and uses what comes back.
 *   Deliberately does not exercise AgentOrchestrator, PlanExecutor, the daemon, or a
 *   portal — the swe_tasks scenario pack already covers that heavier, full-stack path;
 *   this test isolates ReActLoopStrategy's own tool-use, comprehension, and termination
 *   contract against a real model as cheaply and directly as possible.
 * @architectural-layer Services (test)
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/tests/agents/react_loop_strategy_test.ts, packages/ai/tests/provider_endpoint_regression_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { levenshteinDistance } from "@std/text/levenshtein-distance";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "@exaix/ai-anthropic";
import { ExecutionStrategyName, REACT_STATUS_COMPLETE, SecurityMode, ToolName } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import { ENV_ANTHROPIC_API_KEY } from "@exaix/testing";
import type { JSONValue } from "@exaix/core/types";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];
type TestToolParams = Record<string, JSONValue>;

const LIVE_TEST_TIMEOUT_MS = 60000;
// A paraphrase-tolerant comprehension check must still distinguish "read and understood"
// from "read and ignored". Calibrated offline (no API cost) against representative
// response shapes: exact quote scores 1.00, a reasonable paraphrase ("is guarding" /
// "in the north") scores 0.55-0.80, while a vague/generic answer, the wrong (first)
// sentence, and "I read the file" with no actual content all cluster at ~0.35 —
// 0.55 cleanly separates the two groups.
const COMPREHENSION_SIMILARITY_THRESHOLD = 0.55;
// Multi-statement so "the second statement" is a concrete, checkable fact the model can
// only produce by actually reading the tool result — not by guessing or paraphrasing
// generically. The marker phrase is distinctive enough that it would not appear in a
// plausible-sounding hallucinated answer.
const FILE_STATEMENT_ONE = "The warehouse ships orders every Tuesday.";
const FILE_STATEMENT_TWO = "The quokka guards the northern vault.";
const READ_ONLY_FILE_CONTENT = `${FILE_STATEMENT_ONE} ${FILE_STATEMENT_TWO}`;

const testBlueprint = {
  name: "react-live-test-agent",
  model: "anthropic:" + DEFAULT_ANTHROPIC_MODEL,
  provider: "anthropic",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-99999999-9999-4999-8999-999999999999",
  request_id: "react-live-request",
  request: `Use the ${ToolName.READ_FILE} tool to read "answer.txt". It contains two sentences. ` +
    `Report the exact second sentence verbatim, then stop.`,
  plan: "Read answer.txt and report its second sentence verbatim",
  portal: "test",
} satisfies IExecutionContext;

const testOptions: IAgentExecutionOptions = {
  identity_id: "react-live-test-agent",
  portal: "test",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: LIVE_TEST_TIMEOUT_MS,
  max_tool_calls: 10,
  audit_enabled: true,
  permitted_tools: [ToolName.READ_FILE],
};

function buildExecutor(toolCalls: Array<{ tool: string; params: TestToolParams }>): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    // Untruncated: createFinalResult passes only the model's single final-turn text here
    // (not accumulated loop history), and truncating it risks cutting off the very
    // sentence the comprehension assertion checks for — a false negative unrelated to
    // what this test verifies.
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
    toolRegistry: {
      execute: async (tool: string, params: TestToolParams) => {
        await Promise.resolve();
        toolCalls.push({ tool, params });
        if (tool === ToolName.READ_FILE) {
          return { success: true, data: READ_ONLY_FILE_CONTENT };
        }
        return { success: false, error: `Unknown tool: ${tool}` };
      },
      getTools: () => [],
    },
  } as ReActExecutor;
}

/**
 * Best-effort normalized similarity (0..1, higher = closer) between `needle` and the
 * best-matching substring of `haystack`, tolerant of paraphrase-driven length changes.
 * `needle` is expected to appear embedded in a longer response (e.g. after a THOUGHT:
 * preamble) and possibly reworded, so both a fixed comparison window (dominated by length
 * mismatch) and a whole-string distance (dominated by the unrelated preamble/prefix text)
 * would misjudge it — this slides windows across a 0.6x-1.4x length range of `needle`
 * across `haystack` and keeps the best-scoring one.
 */
function bestSubstringSimilarity(haystack: string, needle: string): number {
  const normalizedNeedle = needle.toLowerCase();
  const normalizedHaystack = haystack.toLowerCase();
  const minWindowLen = Math.max(1, Math.floor(normalizedNeedle.length * 0.6));
  const maxWindowLen = Math.min(normalizedHaystack.length, Math.ceil(normalizedNeedle.length * 1.4));
  const windowStep = Math.max(1, Math.floor(normalizedNeedle.length * 0.1));

  if (normalizedHaystack.length <= minWindowLen) {
    const distance = levenshteinDistance(normalizedHaystack, normalizedNeedle);
    return 1 - distance / Math.max(normalizedNeedle.length, normalizedHaystack.length, 1);
  }

  let best = 0;
  for (let windowLen = minWindowLen; windowLen <= maxWindowLen; windowLen += windowStep) {
    for (let i = 0; i <= normalizedHaystack.length - windowLen; i++) {
      const window = normalizedHaystack.slice(i, i + windowLen);
      const distance = levenshteinDistance(window, normalizedNeedle);
      const similarity = 1 - distance / Math.max(normalizedNeedle.length, windowLen);
      if (similarity > best) best = similarity;
    }
  }
  return best;
}

Deno.test({
  name:
    "[live] ReActLoopStrategy: a real model uses the AVAILABLE TOOLS list, comprehends the tool result content, and recognizes STATUS: COMPLETE to terminate",
  ignore: !Deno.env.get(ENV_ANTHROPIC_API_KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const provider = new AnthropicProvider({
      apiKey: Deno.env.get(ENV_ANTHROPIC_API_KEY)!,
      model: DEFAULT_ANTHROPIC_MODEL,
    });

    let generateCallCount = 0;
    const countingProvider = {
      ...provider,
      generate: (...args: Parameters<typeof provider.generate>) => {
        generateCallCount++;
        return provider.generate(...args);
      },
    };

    const toolCalls: Array<{ tool: string; params: TestToolParams }> = [];
    const executor = buildExecutor(toolCalls);
    const strategy = new ReActLoopStrategy(executor, countingProvider);

    const result = await strategy.execute(testBlueprint, testContext, testOptions);

    // 1. Tool-use contract: the model must have called a tool from the permitted_tools
    // list ReActLoopStrategy actually advertised (AVAILABLE TOOLS: read_file), not a
    // hallucinated or unpermitted one — every recorded call resolved successfully.
    assert(toolCalls.length > 0, "model must have called at least one tool (read_file)");
    for (const call of toolCalls) {
      assertEquals(call.tool, ToolName.READ_FILE, `model must only call permitted tools, got "${call.tool}"`);
    }

    // 2. Multi-turn contract: at least one tool-call round-trip plus a final completion
    // turn — proves the loop is genuinely multi-turn, not a single blind call.
    assert(
      generateCallCount >= 2,
      `expected >=2 provider.generate() calls (tool-use turn + completion turn), got ${generateCallCount}`,
    );

    // 3. Comprehension contract: the model's final answer must closely match the SECOND
    // statement from the tool result, not the first — proving it actually parsed the
    // multi-statement content rather than calling the tool and then answering from a
    // generic guess. Fuzzy (not exact) match tolerates a reasonable paraphrase of an
    // explicitly-requested verbatim quote without accepting an unrelated or generic
    // answer; checking for the whole file content (or just the first statement, which a
    // lazy skim could latch onto) would not catch a model that saw the tool result but
    // didn't read past the first sentence.
    const similarity = bestSubstringSimilarity(result.description, FILE_STATEMENT_TWO);
    assert(
      similarity >= COMPREHENSION_SIMILARITY_THRESHOLD,
      `final answer must closely match the tool result's second statement ("${FILE_STATEMENT_TWO}"), ` +
        `similarity ${similarity.toFixed(2)} < ${COMPREHENSION_SIMILARITY_THRESHOLD} — got: "${result.description}"`,
    );

    // 4. Termination contract: the loop must end because the model emitted
    // REACT_STATUS_COMPLETE and ReActLoopStrategy's own isComplete branch returned —
    // not because it silently exhausted DEFAULT_AGENT_MAX_ITERATIONS. If termination
    // were only reached via the iteration cap, execute() would have thrown instead of
    // returning a IChangesetResult.
    assert(
      generateCallCount < 10,
      `loop should terminate well before DEFAULT_AGENT_MAX_ITERATIONS (10), used ${generateCallCount} — ` +
        "suggests the model did not recognize STATUS: COMPLETE",
    );

    console.log(
      `[react-live] ${generateCallCount} generate() call(s), ${toolCalls.length} tool call(s), ` +
        `description: "${result.description.slice(0, 120)}"`,
    );
  },
});

Deno.test({
  name:
    "[live] ReActLoopStrategy: REACT_STATUS_COMPLETE constant matches the value the prompt instructs the model to emit",
  fn: () => {
    // Guards against the live test above silently passing for the wrong reason if this
    // constant is ever renamed/retyped without updating the prompt text it's interpolated
    // into (react_loop_strategy.ts:buildPrompt's INSTRUCTIONS section).
    assertEquals(REACT_STATUS_COMPLETE, "STATUS: COMPLETE");
  },
});
