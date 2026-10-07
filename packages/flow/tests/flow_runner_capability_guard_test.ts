/**
 * @module FlowRunnerCapabilityGuardTest
 * @path packages/flow/tests/flow_runner_capability_guard_test.ts
 * @description Proves tier and registered-handler checks happen before any wave starts.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { FlowCapabilityUnavailableError, FlowRunner, VotingStepHandler } from "@exaix/flow";
import { FlowStepType } from "@exaix/core";
import { createMockLogger } from "@exaix/testing";
import { BranchTestAgent } from "./helpers/branch_controls.ts";
import { GateTestLogger } from "./helpers/gate_controls.ts";
import type { IVotingConsensusService } from "@exaix/core/types";

const flow = FlowSchema.parse({
  id: "capability-flow",
  name: "Capability flow",
  description: "Needs voting",
  requires_capabilities: ["voting"],
  steps: [{ id: "first", name: "First", agent_role: "code-analyst" }],
  output: { from: "first" },
});
const service: IVotingConsensusService = {
  run: () => Promise.reject(new Error("No voting step in this fixture")),
};
Deno.test("[security] inconsistent installed voting is rejected even when the flow has no requirements", async () => {
  const agent = new BranchTestAgent();
  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: new GateTestLogger(),
    edition: "team",
    installedCapabilities: new Set(["voting"]),
  });
  await assertRejects(
    () => runner.execute({ ...flow, requires_capabilities: undefined }, { userPrompt: "Run" }),
    FlowCapabilityUnavailableError,
    "voting",
  );
  assertEquals(agent.requests.length, 0);
});
for (const edition of [undefined, "unknown", "solo", "team", "enterprise"]) {
  Deno.test(`[security] capability flow refuses ${edition} without installed voting before waves`, async () => {
    const agent = new BranchTestAgent();
    const logger = new GateTestLogger();
    const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, edition });
    const error = await assertRejects(
      () => runner.execute(flow, { userPrompt: "Run", traceId: "capability-trace", requestId: "request-id" }),
      FlowCapabilityUnavailableError,
      "voting",
    );
    assertEquals(error.reasonCode, "capability_unavailable");
    assertEquals(agent.requests.length, 0);
    assertEquals(logger.events.filter((event) => event.event === "flow.step.started").length, 0);
    const failed = logger.events.find((event) => event.event === "flow.failed")!;
    assertEquals(failed.payload.reasonCode, "capability_unavailable");
    assertEquals(failed.payload.traceId, "capability-trace");
    assertEquals(failed.payload.requestId, "request-id");
  });
}
for (const registration of ["missing", "generic", "alias-missing", "specialized"]) {
  Deno.test(`[runner] installed voting requires both specialized registrations: ${registration}`, async () => {
    for (const edition of ["team", "enterprise"]) {
      const agent = new BranchTestAgent();
      const runner = new FlowRunner({
        agentExecutor: agent,
        eventLogger: new GateTestLogger(),
        edition,
        installedCapabilities: new Set(["voting"]),
      });
      const registry = runner.getStepHandlerRegistry();
      if (registration === "generic") {
        const generic = registry.get(FlowStepType.AGENT)!;
        registry.registerWithKey(FlowStepType.VOTING_GROUP, generic);
        registry.registerWithKey(FlowStepType.CONSENSUS, generic);
      } else if (registration !== "missing") {
        const handler = new VotingStepHandler({ votingService: service, eventLogger: createMockLogger() });
        registry.register(handler);
        if (registration === "specialized") registry.registerWithKey(FlowStepType.CONSENSUS, handler);
      }
      if (registration === "specialized") {
        assertEquals((await runner.execute(flow, { userPrompt: "Run" })).success, true);
        assertEquals(agent.requests.length, 1);
      } else {
        await assertRejects(() => runner.execute(flow, { userPrompt: "Run" }), FlowCapabilityUnavailableError);
        assertEquals(agent.requests.length, 0);
      }
    }
  });
}
