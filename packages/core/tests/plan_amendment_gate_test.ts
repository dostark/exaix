/**
 * @module PlanAmendmentGateTest
 * @path packages/core/tests/plan_amendment_gate_test.ts
 * @description Tests for PlanAmendmentGate: auto-approve, HITL adapter
 * decision, timeout actions, event emission, and delegation.
 */
import { assertEquals, assertExists, assertObjectMatch } from "@std/assert";
import type { IEventLogger } from "../src/logger/event_logger.ts";
import { EventLogger } from "../src/logger/event_logger.ts";
import { initTestDbService } from "@exaix/testing";
import type { IPlanAmendmentService } from "../src/types/i_plan_amendment_service.ts";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IAmendmentApprovalAdapter } from "../src/planning/plan_amendment_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { LogMetadata } from "../src/types/json.ts";
import { PlanAmendmentGate } from "../src/planning/plan_amendment_gate.ts";
import {
  PLAN_AMENDMENT_EVENT_APPLIED,
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PLAN_AMENDMENT_EVENT_REJECTED,
} from "../src/types/constants.ts";

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

Deno.test("applyApprovedAmendment delegates to service", async () => {
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

  const result = await gate.applyApprovedAmendment(planContent, patch);
  assertEquals(result, expected);
});

Deno.test("applyApprovedAmendment emits PLAN_AMENDMENT_EVENT_APPLIED via logger in isolation", async () => {
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

  const planContent = "---\nstatus: proposed\n---\n\n## Step 1: title 1\n\ncontent 1";
  const patch = makePatch({ amendmentId: "solo-001", planId: "plan-solo" });
  const expected = "---\nstatus: approved\n---\n\n## Step 1: title 1\n\ncontent 1";

  const amendmentService = {
    proposeAmendment: () => Promise.resolve(makePatch()),
    applyApprovedAmendment: (_planContent: string, _patch: IPlanAmendmentPatch) => expected,
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
    undefined,
    logger,
  );

  const result = await gate.applyApprovedAmendment(planContent, patch);

  assertEquals(result, expected);
  assertEquals(events.length, 1, "applyApprovedAmendment alone should emit exactly one event");
  assertEquals(events[0].action, PLAN_AMENDMENT_EVENT_APPLIED);
  assertEquals(events[0].target, "plan:plan-solo");
  assertObjectMatch(events[0].payload ?? {}, {
    amendmentId: "solo-001",
    planId: "plan-solo",
  });
  assertExists(events[0].payload?.timestamp);
});

Deno.test("full audit trail - PROPOSED -> APPROVED -> APPLIED with structured payloads", async () => {
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
    proposeAmendment: () =>
      Promise.resolve(makePatch({
        amendmentId: "audit-001",
        planId: "plan-audit",
      })),
    applyApprovedAmendment: (_planContent: string, _patch: IPlanAmendmentPatch) => "updated-plan",
    shouldAmend: () => Promise.resolve(true),
  } as IPlanAmendmentService;

  const gate = new PlanAmendmentGate(
    makeConfig(),
    amendmentService,
    undefined,
    logger,
  );

  // Step 1: process amendment -> PROPOSED + APPROVED
  const _decision = await gate.processAmendment({
    planId: "plan-audit",
    stepLabel: "1",
    trigger: makeTrigger(),
  });

  // Step 2: apply approved amendment -> APPLIED
  await gate.applyApprovedAmendment(
    "original-plan",
    makePatch({
      amendmentId: "audit-001",
      planId: "plan-audit",
    }),
  );

  // Assert: 3 events total
  assertEquals(events.length, 3, "Should emit PROPOSED + APPROVED + APPLIED");

  // Assert PROPOSED payload
  assertEquals(events[0].action, PLAN_AMENDMENT_EVENT_PROPOSED);
  assertObjectMatch(events[0].payload ?? {}, {
    amendmentId: "audit-001",
    planId: "plan-audit",
  });

  // Assert APPROVED payload with structured metadata
  assertEquals(events[1].action, PLAN_AMENDMENT_EVENT_APPROVED);
  assertObjectMatch(events[1].payload ?? {}, {
    amendmentId: "audit-001",
    planId: "plan-audit",
    decision: "approved",
    decidedBy: "auto",
    rationale: "Auto-approved (no HITL adapter configured)",
  });
  assertExists(events[1].payload?.timestamp);

  // Assert APPLIED payload
  assertEquals(events[2].action, PLAN_AMENDMENT_EVENT_APPLIED);
  assertObjectMatch(events[2].payload ?? {}, {
    amendmentId: "audit-001",
    planId: "plan-audit",
  });
  assertExists(events[2].payload?.timestamp);
});

Deno.test("processAmendment: plan.amendment.proposed is journalled with a real, field-level payload (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const amendmentService = {
      proposeAmendment: () => Promise.resolve(makePatch({ amendmentId: "real-001", planId: "plan-real" })),
      applyApprovedAmendment: () => "",
      shouldAmend: () => Promise.resolve(true),
    } as IPlanAmendmentService;

    const gate = new PlanAmendmentGate(makeConfig(), amendmentService, undefined, logger);
    await gate.processAmendment({
      planId: "plan-real",
      stepLabel: "3",
      trigger: makeTrigger({ source: "tool_error" }),
    });
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? AND target = ?",
    ).all(PLAN_AMENDMENT_EVENT_PROPOSED, "plan:plan-real") as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "plan.amendment.proposed must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.amendmentId, "real-001");
    assertEquals(payload.planId, "plan-real");
    assertEquals(payload.stepId, "3");
    assertEquals(payload.triggerSource, "tool_error");

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("processAmendment: plan.amendment.approved is journalled with a real, field-level payload (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const amendmentService = {
      proposeAmendment: () => Promise.resolve(makePatch({ amendmentId: "real-002", planId: "plan-real" })),
      applyApprovedAmendment: () => "",
      shouldAmend: () => Promise.resolve(true),
    } as IPlanAmendmentService;

    // No approvalAdapter: auto-approve path.
    const gate = new PlanAmendmentGate(makeConfig(), amendmentService, undefined, logger);
    await gate.processAmendment({
      planId: "plan-real",
      stepLabel: "3",
      trigger: makeTrigger(),
    });
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? AND target = ?",
    ).all(PLAN_AMENDMENT_EVENT_APPROVED, "plan:plan-real") as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "plan.amendment.approved must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.amendmentId, "real-002");
    assertEquals(payload.planId, "plan-real");
    assertEquals(payload.decision, "approved");
    assertEquals(payload.decidedBy, "auto");
    assertExists(payload.rationale);
    assertExists(payload.timestamp);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("processAmendment: plan.amendment.rejected is journalled with a real, field-level payload (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const amendmentService = {
      proposeAmendment: () => Promise.resolve(makePatch({ amendmentId: "real-003", planId: "plan-real" })),
      applyApprovedAmendment: () => "",
      shouldAmend: () => Promise.resolve(true),
    } as IPlanAmendmentService;

    const adapter: IAmendmentApprovalAdapter = {
      requestDecision: () =>
        Promise.resolve({
          amendmentId: "real-003",
          decision: "rejected" as const,
          decidedAt: new Date().toISOString(),
          decidedBy: "human",
          rationale: "scope too large",
        }),
    };

    const gate = new PlanAmendmentGate(makeConfig(), amendmentService, adapter, logger);
    await gate.processAmendment({
      planId: "plan-real",
      stepLabel: "3",
      trigger: makeTrigger(),
    });
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? AND target = ?",
    ).all(PLAN_AMENDMENT_EVENT_REJECTED, "plan:plan-real") as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "plan.amendment.rejected must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.amendmentId, "real-003");
    assertEquals(payload.planId, "plan-real");
    assertEquals(payload.decision, "rejected");
    assertEquals(payload.decidedBy, "human");
    assertEquals(payload.rationale, "scope too large");
    assertExists(payload.timestamp);

    await db.close();
  } finally {
    await cleanup();
  }
});
