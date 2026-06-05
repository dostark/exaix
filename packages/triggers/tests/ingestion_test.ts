/**
 * @module TriggerIngestionTest
 * @path packages/triggers/tests/ingestion_test.ts
 * @description Integration tests for TriggerIngestionService and TriggerPolicyGate.
 * @architectural-layer Triggers
 * @related-files [packages/triggers/services/ingestion_service.ts, packages/triggers/services/policy_gate.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { TriggerIngestionService } from "../services/ingestion_service.ts";
import { TriggerPolicyGate } from "../services/policy_gate.ts";
import { InMemoryIdempotencyLedger } from "../services/idempotency_ledger.ts";
import type { ExecutionTriggerEnvelope } from "@exaix/core/triggers";
import type { IIdempotencyLedger } from "@exaix/core/triggers";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core";
import type { IWaitStateService } from "@exaix/flow/wait_states/wait_state_service.ts";
import type { IWaitState } from "@exaix/flow/wait_states/wait_state.ts";

// ============================================================================
// Helpers
// ============================================================================

function makeEnvelope(overrides: Partial<ExecutionTriggerEnvelope> = {}): ExecutionTriggerEnvelope {
  return {
    triggerId: crypto.randomUUID(),
    source: "cli",
    action: "start_flow",
    idempotencyKey: `test-key-${Date.now()}`,
    subject: "Test trigger",
    payload: {},
    metadata: {},
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

interface IMockLogger extends IEventLogger {
  calls: Array<{ action: string; target: string | null; payload?: LogMetadata }>;
}

function createMockLogger(): IMockLogger {
  const calls: Array<{ action: string; target: string | null; payload?: LogMetadata }> = [];
  return {
    log: () => Promise.resolve(),
    info: (action: string, target: string | null, payload?: LogMetadata) => {
      calls.push({ action, target, payload });
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => createMockLogger(),
    calls,
  };
}

interface IMockWaitStateService extends IWaitStateService {
  seed(ws: IWaitState): void;
}

function createMockWaitStateService(): IMockWaitStateService {
  const store = new Map<string, IWaitState>();
  return {
    seed: (ws: IWaitState) => {
      store.set(ws.waitStateId, ws);
    },
    create: (input) => {
      const ws: IWaitState = {
        waitStateId: crypto.randomUUID(),
        traceId: input.traceId,
        kind: input.kind,
        status: "pending",
        artifactPath: input.artifactPath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resumeToken: input.resumeToken,
        metadata: {},
      };
      store.set(ws.waitStateId, ws);
      return Promise.resolve(ws);
    },
    getById: (id: string) => Promise.resolve(store.get(id) ?? null),
    getByToken: (token: string) => {
      for (const ws of store.values()) {
        if (ws.resumeToken === token) return Promise.resolve(ws);
      }
      return Promise.resolve(null);
    },
    transition: (input) => {
      const existing = store.get(input.waitStateId);
      if (!existing) return Promise.reject(new Error("not found"));
      const updated = { ...existing, status: "resumed" as const };
      store.set(input.waitStateId, updated);
      return Promise.resolve(updated);
    },
    listPending: () => Promise.resolve([]),
  };
}

// ============================================================================
// TriggerPolicyGate Tests
// ============================================================================

Deno.test("[TriggerPolicyGate] evaluates idempotency check first", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);

  const key = `dedup-key-${Date.now()}`;
  const envelope = makeEnvelope({ idempotencyKey: key });

  // First evaluation should pass
  const first = await gate.evaluate(envelope);
  assertEquals(first.accepted, true);

  // Record it
  await ledger.record(key, envelope.triggerId, true);

  // Second evaluation with same key should be rejected
  const second = await gate.evaluate(envelope);
  assertEquals(second.accepted, false);
  assertEquals(second.rejectionReason, "duplicate_idempotency_key");
});

Deno.test("[TriggerPolicyGate] rejects triggers produce typed event", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);

  // Pre-record the key to force rejection
  const key = `pre-recorded-${Date.now()}`;
  await ledger.record(key, "existing-trigger", true);

  const envelope = makeEnvelope({ idempotencyKey: key });
  const decision = await gate.evaluate(envelope);
  assertEquals(decision.accepted, false);
  assertEquals(decision.rejectionReason, "duplicate_idempotency_key");
});

// ============================================================================
// TriggerIngestionService Tests
// ============================================================================

Deno.test("[TriggerIngestion] start_flow with valid envelope creates request", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const envelope = makeEnvelope();
    const result = await service.ingest(envelope);

    assertEquals(result.accepted, true);
    assertEquals(result.disposition, "started");
    assertEquals(result.triggerId, envelope.triggerId);
    assertExists(result.resultingRequestId);

    // Verify the .md file was written
    const files: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) files.push(entry.name);
    }
    assertEquals(files.length, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] start_flow with duplicate idempotency key is rejected", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const key = `dup-${Date.now()}`;
    const envelope = makeEnvelope({ idempotencyKey: key });

    // First ingest should succeed
    const first = await service.ingest(envelope);
    assertEquals(first.accepted, true);

    // Second ingest with same key should be deduplicated
    const second = await service.ingest(envelope);
    assertEquals(second.accepted, false);
    assertEquals(second.disposition, "deduplicated");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] resume_flow with valid waitStateId resumes flow", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();
  const waitStateService = createMockWaitStateService();

  const traceId = crypto.randomUUID();
  const resumeToken = crypto.randomUUID();

  const waitState: IWaitState = {
    waitStateId: crypto.randomUUID(),
    traceId,
    kind: "plan_approval",
    status: "pending",
    artifactPath: "/tmp/test-artifact.md",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resumeToken,
    metadata: {},
  };
  waitStateService.seed(waitState);

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
      waitStateService,
    });

    const envelope = makeEnvelope({
      action: "resume_flow",
      targetFlowId: resumeToken,
    });

    const result = await service.ingest(envelope);
    assertEquals(result.accepted, true);
    assertEquals(result.disposition, "resumed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] resume_flow with unknown waitStateId is rejected", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();
  const waitStateService = createMockWaitStateService();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
      waitStateService,
    });

    const envelope = makeEnvelope({
      action: "resume_flow",
      targetFlowId: crypto.randomUUID(), // unknown token
    });

    const result = await service.ingest(envelope);
    assertEquals(result.accepted, false);
    assertEquals(result.disposition, "rejected");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] append_signal dispatch emits TriggerAccepted event", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const envelope = makeEnvelope({ action: "append_signal" });
    const result = await service.ingest(envelope);

    assertEquals(result.accepted, true);
    assertEquals(result.disposition, "queued");

    const acceptedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerAccepted);
    assertExists(acceptedCall, "TriggerAccepted event must be emitted for append_signal");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] resume_flow with no waitStateService emits TriggerRejected", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
      // waitStateService intentionally absent
    });

    const envelope = makeEnvelope({ action: "resume_flow", targetFlowId: crypto.randomUUID() });
    const result = await service.ingest(envelope);

    assertEquals(result.accepted, false);
    assertEquals(result.disposition, "rejected");

    const rejectedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerRejected);
    assertExists(rejectedCall, "TriggerRejected event must be emitted when waitStateService is absent");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] resume_flow with missing targetFlowId emits TriggerRejected", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();
  const waitStateService = createMockWaitStateService();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
      waitStateService,
    });

    const envelope = makeEnvelope({ action: "resume_flow" }); // no targetFlowId
    const result = await service.ingest(envelope);

    assertEquals(result.accepted, false);

    const rejectedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerRejected);
    assertExists(rejectedCall, "TriggerRejected event must be emitted when targetFlowId is absent");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] unknown action emits TriggerRejected and returns rejected", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    // Force an unknown action by bypassing the schema via JSON round-trip
    const envelope = makeEnvelope({ action: "start_flow" });
    const badEnvelope = JSON.parse(
      JSON.stringify({ ...envelope, action: "unknown_action" }),
    ) as ExecutionTriggerEnvelope;
    const result = await service.ingest(badEnvelope);

    assertEquals(result.accepted, false);
    assertEquals(result.disposition, "rejected");

    const rejectedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerRejected);
    assertExists(rejectedCall, "TriggerRejected event must be emitted for unknown action");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] dispatches emit TriggerIngested and TriggerAccepted events", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const envelope = makeEnvelope();
    await service.ingest(envelope);

    const ingestedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerIngested);
    assertExists(ingestedCall);

    const acceptedCall = logger.calls.find((c) => c.action === DomainEventType.TriggerAccepted);
    assertExists(acceptedCall);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ============================================================================
// Step 7 — Cleanup Tests
// ============================================================================

Deno.test("[TriggerIngestion] duplicate idempotency key returns DEDUPLICATED disposition", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const key = `dedup-${Date.now()}`;
    const envelope = makeEnvelope({ idempotencyKey: key });

    await service.ingest(envelope);
    const second = await service.ingest(envelope);

    assertEquals(second.accepted, false);
    assertEquals(second.disposition, "deduplicated");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[TriggerIngestion] start_flow frontmatter includes request_source: trigger", async () => {
  const ledger: IIdempotencyLedger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = createMockLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-trigger-test-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const envelope = makeEnvelope({ source: "webhook" });
    await service.ingest(envelope);

    let fileContent = "";
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        fileContent = await Deno.readTextFile(`${tmpDir}/${entry.name}`);
        break;
      }
    }
    assertEquals(
      fileContent.includes("request_source: trigger"),
      true,
      "Frontmatter must include request_source: trigger",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
