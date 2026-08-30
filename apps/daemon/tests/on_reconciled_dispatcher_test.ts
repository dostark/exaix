/**
 * @module OnReconciledDispatcherTest
 * @path apps/daemon/tests/on_reconciled_dispatcher_test.ts
 * @description Phase 111 Step 6 — tests for the onReconciled gate-dispatcher.
 *   Verifies each gate (refinement, plan_review, review) reads the brief and
 *   return from disk and produces the correct artifact via the gate mappers.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { SessionBrief, SessionReturn } from "@exaix/schemas/session_delegate.ts";
import { SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import { SessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { ReviewStatus } from "@exaix/core/status";
import { DomainEventType } from "@exaix/core/events";
import {
  createOnReconciledHandler,
  type ILogPayload,
  type IReconciledLogger,
} from "../src/on_reconciled_dispatcher.ts";

const FIXED_NOW = new Date("2026-06-19T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

interface IMockReviewRegistry {
  reviews: Array<{ id: string; trace_id: string }>;
  updated: Array<{ id: string; status: string; user?: string; reason?: string }>;
}

function makeMockReviewRegistry(): IMockReviewRegistry {
  const mock: IMockReviewRegistry = {
    reviews: [],
    updated: [],
  };
  return mock;
}

interface IRecordedLog {
  event: string;
  target: string;
  payload?: ILogPayload;
  traceId?: string;
}

function makeMockLogger(): IReconciledLogger & { logs: IRecordedLog[] } {
  const logs: IRecordedLog[] = [];
  return {
    logs,
    info(event: string, target: string, payload?: ILogPayload, traceId?: string) {
      logs.push({ event, target, payload, traceId });
    },
  };
}

interface IRig {
  traceId: string;
  sessionDir: string;
  workspaceRoot: string;
  mockReview: IMockReviewRegistry;
  logger: IReconciledLogger & { logs: IRecordedLog[] };
  handler: ReturnType<typeof createOnReconciledHandler>;
  cleanup: () => Promise<void>;
}

async function makeRig(gate: SessionBrief["gate"]): Promise<IRig> {
  const sessionDir = await Deno.makeTempDir();
  const workspaceRoot = await Deno.makeTempDir();
  const traceId = crypto.randomUUID();

  const service = new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });

  await service.prepareBrief({
    traceId,
    identityId: "test-identity",
    gate,
    tool: "claude-code",
    objective: `Do the ${gate} work.`,
    artifactRef: gate === "plan_review"
      ? "Workspace/Plans/test.md"
      : gate === "review"
      ? traceId
      : "Workspace/Requests/req-01.md",
    permittedPaths: ["Workspace/**"],
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
  });

  const mockReview = makeMockReviewRegistry();
  const logger = makeMockLogger();

  const handler = createOnReconciledHandler({
    briefReader: new SessionBriefReader(sessionDir),
    workspaceRoot,
    reviewRegistry: {
      getByTrace: (tid: string) => {
        return Promise.resolve(mockReview.reviews.filter((r) => r.trace_id === tid).map((r) => ({ id: r.id })));
      },
      updateStatus: (id: string, status, user, reason) => {
        mockReview.updated.push({ id, status: String(status), user, reason });
        return Promise.resolve();
      },
    },
    logger,
  });

  return {
    traceId,
    sessionDir,
    workspaceRoot,
    mockReview,
    logger,
    handler,
    cleanup: async () => {
      await Deno.remove(sessionDir, { recursive: true });
      await Deno.remove(workspaceRoot, { recursive: true });
    },
  };
}

async function dropReturn(rig: IRig, decision: SessionReturn["decision"], summary = "ok"): Promise<void> {
  const dir = join(rig.sessionDir, rig.traceId);
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, "return.json"),
    JSON.stringify({
      trace_id: rig.traceId,
      resume_token: "tok",
      decision,
      summary,
      paths_touched: [],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
  );
}

function outcome(rig: IRig, decision: SessionReturn["decision"], summary = "ok") {
  return SessionDelegationOutcomeSchema.parse({
    delegationTraceId: rig.traceId,
    parentTraceId: rig.traceId,
    parentStepId: "legacy",
    sequence: 1,
    status: decision === "abandoned" ? "abandoned" : "completed",
    decision,
    summary,
    pathsTouched: [],
    tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

Deno.test("[on_reconciled_dispatcher] refinement gate writes clarification to Clarifications/", async () => {
  const rig = await makeRig("refinement");
  try {
    await dropReturn(rig, "enriched", "Clarified the requirements.");
    await rig.handler(outcome(rig, "enriched", "Clarified the requirements."));

    const clarPath = join(rig.workspaceRoot, "Clarifications", `${rig.traceId}.json`);
    const content = await Deno.readTextFile(clarPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.requestId, "req-01");
    assertEquals(parsed.status, "user-confirmed");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] plan_review gate writes amendment decision to Amendments/", async () => {
  const rig = await makeRig("plan_review");
  try {
    await dropReturn(rig, "approved", "Plan looks correct.");
    await rig.handler(outcome(rig, "approved", "Plan looks correct."));

    const amendPath = join(rig.workspaceRoot, "Amendments", `${rig.traceId}.json`);
    const content = await Deno.readTextFile(amendPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.decision, "approved");
    assertExists(parsed.amendmentId);
    assertEquals(parsed.rationale, "Plan looks correct.");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] plan_review rejected maps to rejected amendment", async () => {
  const rig = await makeRig("plan_review");
  try {
    await dropReturn(rig, "rejected", "Plan is unsafe.");
    await rig.handler(outcome(rig, "rejected", "Plan is unsafe."));

    const amendPath = join(rig.workspaceRoot, "Amendments", `${rig.traceId}.json`);
    const content = await Deno.readTextFile(amendPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.decision, "rejected");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] review gate calls reviewRegistry.updateStatus on match", async () => {
  const rig = await makeRig("review");
  try {
    // Seed a matching review for this traceId
    rig.mockReview.reviews.push({ id: "review-01", trace_id: rig.traceId });

    await dropReturn(rig, "approved", "LGTM");
    await rig.handler(outcome(rig, "approved", "LGTM"));

    assertEquals(rig.mockReview.updated.length, 1);
    assertEquals(rig.mockReview.updated[0].id, "review-01");
    assertEquals(rig.mockReview.updated[0].status, ReviewStatus.APPROVED);
    assertEquals(rig.mockReview.updated[0].user, "session:claude-code");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] review gate logs not-found when no review matches traceId", async () => {
  const rig = await makeRig("review");
  try {
    // No review seeded — should log but not crash
    await dropReturn(rig, "rejected", "Does not meet standards.");
    await rig.handler(outcome(rig, "rejected", "Does not meet standards."));

    assertEquals(rig.mockReview.updated.length, 0);
    const found = rig.logger.logs.some((l) =>
      l.event === DomainEventType.SessionDelegateReconciled && l.payload?.error === "no matching review found for trace"
    );
    assertEquals(found, true);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] missing brief.json logs error without crashing", async () => {
  const rig = await makeRig("plan_review");
  try {
    await Deno.remove(join(rig.sessionDir, rig.traceId, "brief.json"));
    await rig.handler(outcome(rig, "approved"));

    const found = rig.logger.logs.some((l) =>
      l.event === DomainEventType.SessionDelegateReconciled && l.payload?.error !== undefined
    );
    assertEquals(found, true, "must log error without crashing");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] refinement abandoned marks clarification user_cancelled", async () => {
  const rig = await makeRig("refinement");
  try {
    await dropReturn(rig, "abandoned", "Gave up.");
    await rig.handler(outcome(rig, "abandoned", "Gave up."));

    const clarPath = join(rig.workspaceRoot, "Clarifications", `${rig.traceId}.json`);
    const content = await Deno.readTextFile(clarPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.status, "user-cancelled");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher][security] session.delegate.reconciled is logged with the actual traceId argument, not just target — required for trace_scoped journal-assert to find it", async () => {
  // session.delegate.reconciled must be logged with the real traceId as the 4th
  // argument, not just as `target` — otherwise the persisted row's trace_id column
  // falls back to a fresh random UUID, invisible to a trace-scoped journal-assert.
  const rig = await makeRig("plan_review");
  try {
    await dropReturn(rig, "approved", "Plan looks correct.");
    await rig.handler(outcome(rig, "approved", "Plan looks correct."));

    const reconciled = rig.logger.logs.find((l) => l.event === DomainEventType.SessionDelegateReconciled);
    assertExists(reconciled);
    assertEquals(reconciled?.traceId, rig.traceId);
    // target keeps carrying the traceId too — additive fix, not a swap.
    assertEquals(reconciled?.target, rig.traceId);
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[on_reconciled_dispatcher] consumes the typed outcome after return.json is removed", async () => {
  const rig = await makeRig("plan_review");
  try {
    await dropReturn(rig, "approved", "Stored before cleanup.");
    await Deno.remove(join(rig.sessionDir, rig.traceId, "return.json"));

    await rig.handler(outcome(rig, "approved", "Stored before cleanup."));

    const content = await Deno.readTextFile(
      join(rig.workspaceRoot, "Amendments", `${rig.traceId}.json`),
    );
    assertEquals(JSON.parse(content).rationale, "Stored before cleanup.");
  } finally {
    await rig.cleanup();
  }
});
