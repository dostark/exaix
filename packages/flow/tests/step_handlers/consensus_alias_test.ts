/**
 * @module ConsensusAliasTest
 * @path packages/flow/tests/step_handlers/consensus_alias_test.ts
 * @description Phase 121 Step 4 — tests for the CONSENSUS→VOTING_GROUP alias.
 *   Verifies that registerWithKey correctly overrides the handler for CONSENSUS
 *   (Team behaviour) and that without the alias it falls through to the default
 *   (Solo behaviour). Also verifies the deprecation warning format.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowStepType } from "@exaix/core";
import { FlowStepHandlerRegistry } from "@exaix/flow/step_handlers/step_handler_registry.ts";
import type { IFlowStepHandler } from "@exaix/flow";

function makeHandler(): IFlowStepHandler {
  return { stepType: "mock", execute: () => Promise.resolve({ thought: "", content: "", raw: "" }) };
}

Deno.test("[consensus_alias] registerWithKey overrides default handler for CONSENSUS", () => {
  const registry = new FlowStepHandlerRegistry();
  const agent = makeHandler();
  const voting = makeHandler();
  registry.registerWithKey(FlowStepType.CONSENSUS, agent);
  registry.registerWithKey(FlowStepType.CONSENSUS, voting);
  assertEquals(registry.get(FlowStepType.CONSENSUS), voting, "CONSENSUS must resolve to voting handler after override");
});

Deno.test("[consensus_alias] without alias CONSENSUS falls through to default", () => {
  const registry = new FlowStepHandlerRegistry();
  const agent = makeHandler();
  registry.registerWithKey(FlowStepType.CONSENSUS, agent);
  assertEquals(
    registry.get(FlowStepType.CONSENSUS),
    agent,
    "CONSENSUS must fall through to agent handler without alias",
  );
});

Deno.test("[consensus_alias] deprecation warning message format", () => {
  const msg = "FlowStepType.CONSENSUS is deprecated — use VOTING_GROUP instead";
  assertStringIncludes(msg, "CONSENSUS is deprecated");
  assertStringIncludes(msg, "VOTING_GROUP");
});
