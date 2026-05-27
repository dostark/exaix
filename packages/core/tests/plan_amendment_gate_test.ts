/**
 * @module PlanAmendmentGateTest
 * @path packages/core/tests/plan_amendment_gate_test.ts
 * @description Tests for PlanAmendmentGate: auto-approve, HITL adapter
 * decision, timeout actions, event emission, and delegation.
 */
import { assertEquals, assertExists } from "@std/assert";
import type { IEventLogger } from "../src/logger/event_logger.ts";
import type { IPlanAmendmentService } from "../src/types/i_plan_amendment_service.ts";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IAmendmentApprovalAdapter } from "../src/planning/plan_amendment_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { LogMetadata } from "../src/types/json.ts";
import { PlanAmendmentGate } from "../src/planning/plan_amendment_gate.ts";
import { PLAN_AMENDMENT_EVENT_APPROVED, PLAN_AMENDMENT_EVENT_PROPOSED } from "../src/types/constants.ts";

const makeTrigger = (overrides?: Partial<IPlanAmendmentTrigger>): IPlanAmendmentTrigger => ({
  source: "manual_request",
  stepId: "1",
  reason: "test",
  ...overrides,
});

const makePatch = (overrides?: Partial<IPlanAmendmentPatch>): IPlanAmendmentPatch => ({
  amendmentId: "550e8400-e29b-41d4-a716-446655440000",
  planId: "plan-1",
  affectedRemainingStepIds: ["2"],
  summary: "test summary",
  adds: [],
  updates: [],
  removes: [],
  createdAt: new Date().toISOString(),
  ...overrides,
});

const makeConfig = (overrides?: Partial<Config["amendment"]>): Config =>
  ({
    amendment: {
      enabled: true,
      hitl_timeout_ms: 5000,
      on_timeout: "abort",
      ...overrides,
    },
  }) as Config;

Deno.test("processAmendment auto-approves when no approvalAdapter", async () => {
  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: () => "",
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
  );

  const decision = await gate.processAmendment({
    planId: "plan-1",
    stepLabel: "1",
    trigger: makeTrigger(),
  });

  assertEquals(decision.decision, "approved");
  assertEquals(decision.amendmentId, "550e8400-e29b-41d4-a716-446655440000");
  assertExists(decision.decidedAt);
  assertEquals(decision.decidedBy, "auto");
});

Deno.test("processAmendment emits events via logger", async () => {
  const events: Array<{ action: string; target: string | null; payload?: LogMetadata }> = [];
  const logger: IEventLogger = {
    info(action: string, target: string | null, payload?: LogMetadata) {
      events.push({ action, target, payload });
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    log: () => Promise.resolve(),
    child: () => logger,
  };

  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: () => "",
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
    undefined,
    logger,
  );

  await gate.processAmendment({
    planId: "plan-1",
    stepLabel: "1",
    trigger: makeTrigger(),
  });

  assertEquals(events.length, 2);
  assertEquals(events[0].action, PLAN_AMENDMENT_EVENT_PROPOSED);
  assertEquals(events[1].action, PLAN_AMENDMENT_EVENT_APPROVED);
});

Deno.test("processAmendment respects approvalAdapter decision", async () => {
  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: () => "",
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const adapter: IAmendmentApprovalAdapter = {
    requestDecision: () =>
      Promise.resolve({
        amendmentId: "550e8400-e29b-41d4-a716-446655440000",
        decision: "rejected" as const,
        decidedAt: new Date().toISOString(),
        decidedBy: "human",
        rationale: "not needed",
      }),
  };

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
    adapter,
  );

  const decision = await gate.processAmendment({
    planId: "plan-1",
    stepLabel: "1",
    trigger: makeTrigger(),
  });

  assertEquals(decision.decision, "rejected");
  assertEquals(decision.decidedBy, "human");
});

Deno.test("processAmendment timeout triggers on_timeout action", async () => {
  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: () => "",
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const adapter: IAmendmentApprovalAdapter = {
    requestDecision: () => new Promise(() => {}), // never resolves
  };

  const gate = new PlanAmendmentGate(
    makeConfig({ hitl_timeout_ms: 1, on_timeout: "reject" }),
    amendmentService,
    adapter,
  );

  const decision = await gate.processAmendment({
    planId: "plan-1",
    stepLabel: "1",
    trigger: makeTrigger(),
  });

  assertEquals(decision.decision, "rejected");
});

Deno.test("applyApprovedAmendment delegates to service", () => {
  const planContent = "---\nstatus: proposed\n---\n\n## Step 1: title 1\n\ncontent 1";
  const patch = makePatch();
  const expected = "---\nstatus: approved\n---\n\n## Step 1: title 1\n\ncontent 1";

  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: (_planContent: string, _patch: IPlanAmendmentPatch) => expected,
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
  );

  const result = gate.applyApprovedAmendment(planContent, patch);
  assertEquals(result, expected);
});
