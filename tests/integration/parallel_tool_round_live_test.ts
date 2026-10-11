/**
 * @module ParallelToolRoundLiveTest
 * @path tests/integration/parallel_tool_round_live_test.ts
 * @description Phase 202 Step 8, live leg. Each case boots the real daemon with real config and sends chat to the
 *   DeepSeek API, through the same runners as the fixture cutover. The loopback fixture serves embeddings only, and a
 *   case fails if the fixture records any chat request. The assertions are the ones the journal can prove against a
 *   live model: which calls ran, which were refused, and whether the step completed. The request body is not visible
 *   from a live provider, so the wire flags are proven by the fixture cutover instead. Opt-in only: without
 *   EXA_TEST_ENABLE_PAID_LLM=1 and DEEPSEEK_API_KEY each case is reported as ignored (NOT RUN) and never counts as a
 *   pass.
 * @architectural-layer Test
 * @related-files [
 *   "tests/integration/parallel_tool_round_cutover_test.ts",
 *   "tests/integration/helpers/parallel_round_daemon.ts",
 *   "tests/integration/helpers/compatible_daemon.ts",
 *   "tests/integration/native_tool_round_live_test.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { REQUEST_SUCCESS_ACTIONS } from "./helpers/daemon_config.ts";
import { LIVE_KEY_ENV, LIVE_OPENAI_THINKING_MODEL, OPENAI_KEY_ENV, payloadOf } from "./helpers/compatible_daemon.ts";
import {
  FILE_NAMES,
  type ITerminalPayload,
  type IToolSummaryPayload,
  journalActions,
  journalFailure,
  REFUSAL,
  runFlowRound,
  runPlanningRound,
  runReactRound,
  toolRows,
} from "./helpers/parallel_round_daemon.ts";

const PAID_OPT_IN_ENV = "EXA_TEST_ENABLE_PAID_LLM";
const liveEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && (Deno.env.get(LIVE_KEY_ENV) ?? "") !== "";
const ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";
const anthropicEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && (Deno.env.get(ANTHROPIC_KEY_ENV) ?? "") !== "";
const openaiEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && (Deno.env.get(OPENAI_KEY_ENV) ?? "") !== "";
/** A live model must batch at least two calls in one response for the override to be observable. */
const MINIMUM_BATCH = 2;
/** The shipped planning cap is three. A live model may list a directory before its three reads, so this case allows eight. */
const LIVE_PLANNING_CALLS_PER_ROUND = 8;
/** Characters of each call's result shown in a failure message. */
const DESCRIBED_RESULT_CHARS = 60;
/** The calls a failure message lists, so a long ReAct run stays readable. */
const DESCRIBED_CALLS = 8;

/** Each journaled call's tool and the start of its result, for a failure message that says what the model did. */
function describeCalls(calls: IToolSummaryPayload[]): string {
  return calls.slice(0, DESCRIBED_CALLS)
    .map((call) => `${call.tool}: ${call.resultSummary.slice(0, DESCRIBED_RESULT_CHARS)}`)
    .join(" | ");
}

Deno.test({
  name: "[phase202-cutover][live] DeepSeek planning replays a three-file round through the daemon, reading every file",
  ignore: !liveEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({
      live: true,
      toolsLines: [],
      maxCallsPerRound: LIVE_PLANNING_CALLS_PER_ROUND,
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach DeepSeek, not the loopback fixture");
    assert(
      rows.some((row) => REQUEST_SUCCESS_ACTIONS.includes(row.action_type)),
      `the request did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    const calls = toolRows(rows);
    assert(
      (completed?.toolCalls ?? 0) >= FILE_NAMES.length,
      `the live round ran ${completed?.toolCalls ?? 0} calls, fewer than ${FILE_NAMES.length}`,
    );
    for (const marker of markers) {
      assert(
        calls.some((call) => call.resultSummary.includes(marker)),
        `no tool result carried ${marker}; the round journaled ${calls.length} calls: ` +
          calls.map((call) => call.resultSummary.slice(0, 80)).join(" | "),
      );
    }
  },
});

Deno.test({
  name:
    "[phase202-cutover][live] a Config DB override of tools.parallel_calls=off runs one call of a DeepSeek round and refuses the rest",
  ignore: !liveEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runPlanningRound({
      live: true,
      toolsLines: [],
      dbOverride: { key: "tools.parallel_calls", value: "off" },
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach DeepSeek, not the loopback fixture");
    const calls = toolRows(rows);
    assert(
      calls.length >= MINIMUM_BATCH,
      `the live model returned fewer than ${MINIMUM_BATCH} calls, so the override cannot show: ${journalActions(rows)}`,
    );
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.toolCalls, 1, "one call executes under off");
    const refused = calls.filter((call) => call.resultSummary.includes(REFUSAL));
    assertEquals(refused.length, calls.length - 1, "every call past the first is refused");
  },
});

Deno.test({
  name:
    "[phase202-cutover][live] ReAct native reads files through a DeepSeek execution after plan approval, and completes",
  ignore: !liveEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactRound({ live: true, toolsLines: [] });
    assertEquals(fixture.bodies.length, 0, "chat must reach DeepSeek, not the loopback fixture");
    assert(
      rows.some((row) => row.action_type === "execution.completed"),
      `the execution did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    const results = toolRows(rows).map((call) => call.resultSummary).join("\n");
    assert(markers.some((marker) => results.includes(marker)), "no execution tool result carried a marker");
  },
});

Deno.test({
  name:
    "[phase202-cutover][live] the serial Flow singleton reads one file through DeepSeek on the Team edition and completes",
  ignore: !liveEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runFlowRound({ live: true, extraEnv: { EXAIX_EDITION: "team" } });
    assertEquals(fixture.bodies.length, 0, "chat must reach DeepSeek, not the loopback fixture");
    assert(
      rows.some((row) => row.action_type === "dynamic_step_completed"),
      `the dynamic step did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    assert(toolRows(rows).some((call) => call.resultSummary.includes(markers[0])), "the step must read src/a.ts");
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][anthropic] planning replays a three-file batch under the auto default, with nothing refused",
  ignore: !anthropicEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({
      live: true,
      liveProvider: "anthropic",
      toolsLines: [],
      maxCallsPerRound: LIVE_PLANNING_CALLS_PER_ROUND,
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach Anthropic, not the loopback fixture");
    assert(
      rows.some((row) => REQUEST_SUCCESS_ACTIONS.includes(row.action_type)),
      `the request did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    const calls = toolRows(rows);
    assert(calls.length >= FILE_NAMES.length, `the round journaled ${calls.length} calls: ${journalActions(rows)}`);
    assert(calls.every((call) => !call.resultSummary.includes(REFUSAL)), "the auto default refuses no call");
    for (const marker of markers) {
      assert(calls.some((call) => call.resultSummary.includes(marker)), `no tool result carried ${marker}`);
    }
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][anthropic] a Config DB override of tools.parallel_calls=off runs one call of a batch and refuses the rest",
  ignore: !anthropicEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runPlanningRound({
      live: true,
      liveProvider: "anthropic",
      toolsLines: [],
      dbOverride: { key: "tools.parallel_calls", value: "off" },
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach Anthropic, not the loopback fixture");
    const calls = toolRows(rows);
    assert(
      calls.length >= MINIMUM_BATCH,
      `the Anthropic model returned fewer than ${MINIMUM_BATCH} calls, so the override cannot show: ${
        journalActions(rows)
      }`,
    );
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.toolCalls, 1, "one call executes under off");
    const refused = calls.filter((call) => call.resultSummary.includes(REFUSAL));
    assertEquals(
      refused.length,
      calls.length - 1,
      `every call past the first is refused; journaled: ${describeCalls(calls)}`,
    );
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][anthropic] planning.max_tool_calls_per_round=1 runs one call of a batch and refuses the rest",
  ignore: !anthropicEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runPlanningRound({
      live: true,
      liveProvider: "anthropic",
      toolsLines: [],
      maxCallsPerRound: 1,
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach Anthropic, not the loopback fixture");
    const calls = toolRows(rows);
    assert(
      calls.length >= MINIMUM_BATCH,
      `the Anthropic model returned fewer than ${MINIMUM_BATCH} calls, so the cap cannot show: ${journalActions(rows)}`,
    );
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.toolCalls, 1, "the per-round cap executes one call");
    const refused = calls.filter((call) => call.resultSummary.includes(REFUSAL));
    assertEquals(
      refused.length,
      calls.length - 1,
      `every call past the cap is refused; journaled: ${describeCalls(calls)}`,
    );
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][anthropic] ReAct native reads files through an Anthropic execution after plan approval, and completes",
  ignore: !anthropicEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Under auto the model decides whether to read a file. Opus 5.5 and Sonnet 5.5 refuse a forced choice, so the
    // case checks that the execution completes, and does not require a read.
    const { fixture, rows } = await runReactRound({ live: true, liveProvider: "anthropic", toolsLines: [] });
    assertEquals(fixture.bodies.length, 0, "chat must reach Anthropic, not the loopback fixture");
    assert(
      rows.some((row) => row.action_type === "execution.completed"),
      `the execution did not complete: ${journalFailure(rows)}; calls: ${describeCalls(toolRows(rows))}`,
    );
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][openai] planning replays a three-file batch through the ordinary OpenAI provider, reading every file",
  ignore: !openaiEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({
      live: true,
      liveProvider: "openai",
      toolsLines: [],
      maxCallsPerRound: LIVE_PLANNING_CALLS_PER_ROUND,
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach OpenAI, not the loopback fixture");
    assert(
      rows.some((row) => REQUEST_SUCCESS_ACTIONS.includes(row.action_type)),
      `the request did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    const calls = toolRows(rows);
    assert(calls.length >= FILE_NAMES.length, `the round journaled ${calls.length} calls: ${journalActions(rows)}`);
    assert(calls.every((call) => !call.resultSummary.includes(REFUSAL)), "the auto default refuses no call");
    for (const marker of markers) {
      assert(calls.some((call) => call.resultSummary.includes(marker)), `no tool result carried ${marker}`);
    }
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][openai-thinking] planning replays a three-file batch on GPT-6 Sol at high effort, reasoning and calling tools together",
  ignore: !openaiEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({
      live: true,
      liveProvider: "openai",
      liveModel: LIVE_OPENAI_THINKING_MODEL,
      intent: { effort: "high", thinking: true },
      // One exploration round may list a directory before the reads, so the thinking case gets room for a second.
      maxToolRounds: 4,
      toolsLines: [],
      maxCallsPerRound: LIVE_PLANNING_CALLS_PER_ROUND,
    });
    assertEquals(fixture.bodies.length, 0, "chat must reach OpenAI, not the loopback fixture");
    assert(
      rows.some((row) => REQUEST_SUCCESS_ACTIONS.includes(row.action_type)),
      `the request did not complete: ${journalFailure(rows)}; ${journalActions(rows)}`,
    );
    const effort = payloadOf<{ effort?: string; model?: string }>(rows, "agent.effort_resolved");
    assertEquals(effort?.effort, "high", "the round resolves to high effort");
    assertEquals(effort?.model, LIVE_OPENAI_THINKING_MODEL, "the round runs on the thinking model");
    const calls = toolRows(rows);
    assert(calls.length >= FILE_NAMES.length, `the round journaled ${calls.length} calls: ${journalActions(rows)}`);
    for (const marker of markers) {
      assert(calls.some((call) => call.resultSummary.includes(marker)), `no tool result carried ${marker}`);
    }
  },
});

Deno.test({
  name:
    "[phase202-cutover][live][openai] ReAct native reads files through an OpenAI execution after plan approval, and completes",
  ignore: !openaiEnabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactRound({ live: true, liveProvider: "openai", toolsLines: [] });
    assertEquals(fixture.bodies.length, 0, "chat must reach OpenAI, not the loopback fixture");
    assert(
      rows.some((row) => row.action_type === "execution.completed"),
      `the execution did not complete: ${journalFailure(rows)}; calls: ${describeCalls(toolRows(rows))}`,
    );
    const results = toolRows(rows).map((call) => call.resultSummary).join("\n");
    assert(markers.some((marker) => results.includes(marker)), "no execution tool result carried a marker");
  },
});
