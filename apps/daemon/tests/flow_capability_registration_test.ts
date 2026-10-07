/**
 * @module FlowCapabilityRegistrationTest
 * @path apps/daemon/tests/flow_capability_registration_test.ts
 * @description Exercises actual voting module registration and absent-module refusal through the daemon seam.
 */
import { assertEquals } from "@std/assert";
import { FlowStepType } from "@exaix/core";
import { FlowStepHandlerRegistry, VotingStepHandler } from "@exaix/flow";
import { VotingCapabilityModule, VotingConsensusService } from "@exaix-team/voting";
import { createMockLogger } from "@exaix/testing";
import { createVotingExecutor, registerFlowCapabilityModules } from "../src/flow_capability_registration.ts";
import { createFlowRecordingContext, type IFlowStepRequest } from "@exaix/flow";

for (const edition of ["solo", "team", "enterprise", "unknown"]) {
  Deno.test(`[daemon registration] voting module requires tier and actual specialized aliases: ${edition}`, () => {
    const registry = new FlowStepHandlerRegistry();
    const logger = createMockLogger();
    const service = new VotingConsensusService({ run: () => Promise.resolve({ content: "SQLite" }) }, logger);
    const module = new VotingCapabilityModule(service, logger);
    const installed = registerFlowCapabilityModules(edition, [module], registry);
    const expected = edition === "team" || edition === "enterprise";
    assertEquals([...installed], expected ? ["voting"] : []);
    const handler = registry.get(FlowStepType.VOTING_GROUP);
    assertEquals(handler instanceof VotingStepHandler, expected);
    assertEquals(registry.get(FlowStepType.CONSENSUS), handler);
    assertEquals([...registerFlowCapabilityModules(edition, [], new FlowStepHandlerRegistry())], []);
  });
}
Deno.test("[security] daemon registration does not advertise generic voting fallback", () => {
  const registry = new FlowStepHandlerRegistry();
  const generic = { stepType: "agent", execute: () => Promise.resolve({ thought: "", content: "", raw: "" }) };
  const installed = registerFlowCapabilityModules("team", [{
    registerFlowStepHandlers: () => {
      registry.registerWithKey(FlowStepType.VOTING_GROUP, generic);
      registry.registerWithKey(FlowStepType.CONSENSUS, generic);
    },
  }], registry);
  assertEquals([...installed], []);
});

Deno.test("[daemon voting] adapter forwards prepared prompt and original voter binding identity", async () => {
  const received: { role: string; request: IFlowStepRequest }[] = [];
  const executor = createVotingExecutor({
    run: (role, request) => {
      received.push({ role, request });
      return Promise.resolve({ thought: "", content: "SQLite", raw: "" });
    },
  });
  const context = {
    traceId: "original-trace",
    requestId: "original-request",
    flowId: "architecture-decision",
    flowStepId: "vote",
    scenarioId: "architecture-decision",
    stepId: "submit",
  };
  assertEquals(await executor.run("software-architect", "Prepared context evidence", context), { content: "SQLite" });
  assertEquals(received, [{
    role: "software-architect",
    request: { ...context, userPrompt: "Prepared context evidence", context: {} },
  }]);
});

Deno.test("[daemon voting] each voter replays on its own run lane without renaming the bound step", async () => {
  const received: IFlowStepRequest[] = [];
  const executor = createVotingExecutor({
    run: (_role, request) => {
      received.push(request);
      return Promise.resolve({ thought: "", content: "SQLite", raw: "" });
    },
  });
  const recording = createFlowRecordingContext({
    scenarioId: "architecture-decision",
    stepId: "submit",
    enabled: true,
  });
  const context = { scenarioId: "architecture-decision", stepId: "submit", flowStepId: "vote", recording };
  await Promise.all(
    [2, 0, 1].map((runnerIndex) => executor.run("software-architect", "p", { ...context, runnerIndex })),
  );

  assertEquals(received.map((request) => request.flowStepId), ["vote", "vote", "vote"]);
  assertEquals(received.map((request) => request.recording), [recording, recording, recording]);
  assertEquals(received.map((request) => request.recordingLaneId), ["vote--voter-2", "vote--voter-0", "vote--voter-1"]);
});
