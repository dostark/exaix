/**
 * @module ParallelToolRoundCutoverTest
 * @path tests/integration/parallel_tool_round_cutover_test.ts
 * @description Phase 202 Step 8. Each shipped parallel-tool-round path runs through a real daemon with
 *   real config. The loopback openai-chat fixture records every request body the daemon sends, so the
 *   wire flags and replayed messages are asserted as sent. Covered paths: compatible planning replay,
 *   a Config DB override of tools.parallel_calls, ReAct native execution through plan approval (off and
 *   cap), and the serial Flow singleton replay on the Team edition. The live leg is in
 *   parallel_tool_round_live_test.ts.
 * @architectural-layer Integration
 * @related-files [
 *   "tests/integration/helpers/parallel_round_daemon.ts",
 *   "tests/integration/helpers/compatible_daemon.ts",
 *   "packages/execution/src/planning_tool_loop.ts",
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/flow/src/dynamic_step_executor.ts"
 * ]
 */

import { assert, assertEquals, AssertionError, assertRejects } from "@std/assert";
import { type IFixtureBody, payloadOf } from "./helpers/compatible_daemon.ts";
import {
  FILE_NAMES,
  type ITerminalPayload,
  PLANNING_CALL_IDS,
  REFUSAL,
  runFlowRound,
  runPlanningRound,
  runReactRound,
  toolRows,
} from "./helpers/parallel_round_daemon.ts";

const CI_SKIP = Deno.env.get("CI") === "true";

function toolMessages(body: IFixtureBody): Array<{ id: string | undefined; content: string }> {
  return (body.messages ?? []).filter((message) => message.role === "tool").map((message) => ({
    id: message.tool_call_id,
    content: String(message.content ?? ""),
  }));
}

function assistantToolCallIds(body: IFixtureBody): string[][] {
  return (body.messages ?? []).filter((message) => message.tool_calls?.length).map((message) =>
    (message.tool_calls ?? []).map((call) => call.id)
  );
}

Deno.test({
  name:
    "[phase202-cutover] compatible planning replays a three-call round whole, with no parallel flag under the auto default",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({ live: false, toolsLines: [] });
    assertEquals(fixture.bodies.length, 2, "one exploration request and one final request");
    const [exploration, replay] = fixture.bodies;
    assertEquals(exploration.parallel_tool_calls, undefined, "auto sends no parallel flag");
    assertEquals(assistantToolCallIds(replay), [PLANNING_CALL_IDS]);
    assertEquals(toolMessages(replay).map((message) => message.id), PLANNING_CALL_IDS);
    toolMessages(replay).forEach((message, index) => assert(message.content.includes(markers[index])));
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.rounds, 2);
    assertEquals(completed?.toolCalls, FILE_NAMES.length);
  },
});

Deno.test({
  name: "[phase202-cutover] native OpenAI Responses planning sends no parallel flag under the auto default",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runPlanningRound({ live: false, toolsLines: [], responsesFixture: true });
    assertEquals(fixture.bodies.length, 2, "one exploration request and one final request");
    assertEquals(fixture.bodies[0].parallel_tool_calls, undefined, "auto sends no parallel flag");
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.toolCalls, FILE_NAMES.length, "auto executes every returned call");
  },
});

Deno.test({
  name:
    "[phase202-cutover] native OpenAI Responses planning with parallel calls off sends parallel_tool_calls false and executes one call",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runPlanningRound({
      live: false,
      toolsLines: [],
      responsesFixture: true,
      dbOverride: { key: "tools.parallel_calls", value: "off" },
    });
    assertEquals(fixture.bodies[0].parallel_tool_calls, false, "the off override reaches the Responses request");
    const executed = toolRows(rows).filter((call) => !call.resultSummary.includes(REFUSAL));
    assertEquals(executed.length, 1, "one call executes; the rest are refused");
  },
});

Deno.test({
  name:
    "[phase202-cutover] a Config DB override of tools.parallel_calls=off reaches the planning round over a TOML auto",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runPlanningRound({
      live: false,
      toolsLines: [],
      dbOverride: { key: "tools.parallel_calls", value: "off" },
    });
    const [exploration, replay] = fixture.bodies;
    assertEquals(exploration.parallel_tool_calls, false, "the override reaches the request as one call per response");
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.rounds, 2);
    assertEquals(completed?.toolCalls, 1);
    const calls = toolRows(rows);
    assertEquals(calls.length, FILE_NAMES.length, "every position is journaled, executed or refused");
    assert(calls[0].resultSummary.includes(markers[0]), "the first call executes");
    assertEquals(calls.slice(1).map((call) => call.resultSummary.includes(REFUSAL)), [true, true]);
    assertEquals(toolMessages(replay).map((message) => message.id), PLANNING_CALL_IDS);
    assert(toolMessages(replay)[0].content.includes(markers[0]));
    assertEquals(toolMessages(replay).slice(1).map((message) => message.content.includes(REFUSAL)), [true, true]);
  },
});

/** Every returned ReAct position is journaled: the first executes and the second carries the refusal. */
function assertFirstExecutedSecondRefused(rows: Parameters<typeof toolRows>[0]): void {
  const calls = toolRows(rows);
  assertEquals(calls.length, 2, "every position is journaled, executed or refused");
  assertEquals(calls.map((call) => call.resultSummary.includes(REFUSAL)), [false, true]);
}

Deno.test({
  name:
    "[phase202-cutover] ReAct native under tools.parallel_calls=off executes one of two calls and sends the one-call flag",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactRound({ live: false, toolsLines: ['parallel_calls = "off"'] });
    const execution = fixture.bodies[1];
    assertEquals(execution.parallel_tool_calls, false, "the execution request asks for one call per response");
    const replay = fixture.bodies[2];
    assertEquals(toolMessages(replay).map((message) => message.id), ["REACT_CALL_A", "REACT_CALL_B"]);
    assert(toolMessages(replay)[0].content.includes(markers[0]), "the executed call carries its marker");
    assert(toolMessages(replay)[1].content.includes(REFUSAL), "the second call is refused, and replayed as refused");
    assertFirstExecutedSecondRefused(rows);
    assert(rows.some((row) => row.action_type === "execution.completed"));
  },
});

Deno.test({
  name:
    "[phase202-cutover] ReAct native under auto with tools.max_calls_per_turn=1 executes one call and sends no parallel flag",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactRound({ live: false, toolsLines: ["max_calls_per_turn = 1"] });
    const execution = fixture.bodies[1];
    assertEquals(execution.parallel_tool_calls, undefined, "auto sends no parallel flag");
    const replay = fixture.bodies[2];
    assert(toolMessages(replay)[0].content.includes(markers[0]));
    assert(toolMessages(replay)[1].content.includes(REFUSAL));
    assertFirstExecutedSecondRefused(rows);
    assert(rows.some((row) => row.action_type === "execution.completed"));
  },
});

Deno.test({
  name:
    "[phase202-cutover] serial Flow replays one dynamic-step call as one assistant call and one tool result, on the Team edition",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, rows } = await runFlowRound({ live: false, extraEnv: { EXAIX_EDITION: "team" } });
    assertEquals(fixture.bodies.length, 2, "one dynamic-step call and one follow-up");
    const followUp = fixture.bodies[1];
    assertEquals(assistantToolCallIds(followUp), [["FLOW_CALL_A"]], "the singleton round replays as one call");
    assertEquals(toolMessages(followUp).map((message) => message.id), ["FLOW_CALL_A"]);
    assert(rows.some((row) => row.action_type === "dynamic_step_completed"), "the dynamic step ran its executor");
  },
});

Deno.test({
  name:
    "[phase202-cutover] a planning request that fails ends the ReAct plan wait at once, and the assertion names the cause",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await assertRejects(
      () => runReactRound({ live: false, toolsLines: [], planFails: true }),
      AssertionError,
      "the planning request wrote no plan",
    );
  },
});
