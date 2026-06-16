/**
 * @module TriggersBasicScenarioTest
 * @path tests/scenario_framework/tests/triggers_basic_scenario_test.ts
 * @description Scenario tests for the triggers-basic pack. Exercises WebhookAdapter
 * envelope production, TriggerIngestionService request-file writing, and duplicate
 * deduplication — all without requiring a daemon or FileWatcher.
 * @architectural-layer Tests
 * @related-files [packages/triggers/adapters/webhook_adapter.ts, packages/triggers/services/ingestion_service.ts, tests/scenario_framework/scenarios/triggers_basic/triggers-basic.yaml]
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { WebhookAdapter } from "../../../packages/triggers/adapters/webhook_adapter.ts";
import { TriggerIngestionService } from "../../../packages/triggers/services/ingestion_service.ts";
import { TriggerPolicyGate } from "../../../packages/triggers/services/policy_gate.ts";
import { InMemoryIdempotencyLedger } from "../../../packages/triggers/services/idempotency_ledger.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Webhook HMAC verification is mandatory (Finding 9), so scenario payloads are signed.
const WEBHOOK_SECRET = "triggers_basic-scenario-secret";

async function computeHmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

/** Builds a signed webhook input for the mandatory-HMAC WebhookAdapter. */
async function signedWebhookInput(
  body: string,
  subject?: string,
): Promise<{ body: string; headers: Record<string, string>; subject?: string }> {
  const signature = await computeHmacSha256(WEBHOOK_SECRET, body);
  return {
    body,
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    subject,
  };
}

function makeNullLogger(): IEventLogger {
  return {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: makeNullLogger,
  };
}

function makeTrackedLogger(): IEventLogger & { calls: Array<{ action: string; payload?: LogMetadata }> } {
  const calls: Array<{ action: string; payload?: LogMetadata }> = [];
  return {
    calls,
    log: () => Promise.resolve(),
    info: (action: string, _target: string | null, payload?: LogMetadata) => {
      calls.push({ action, payload });
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: makeNullLogger,
  };
}

// ---------------------------------------------------------------------------
// Scenario tests
// ---------------------------------------------------------------------------

Deno.test("[triggers_basic] webhook adapter produces valid envelope", async () => {
  const adapter = new WebhookAdapter({ secret: WEBHOOK_SECRET });
  const body = JSON.stringify({ event: "push", repository: "exaix" });
  const envelope = await adapter.parse(await signedWebhookInput(body, "push event"));

  assertEquals(envelope.source, "webhook");
  assertEquals(envelope.action, "start_flow");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
  assertExists(envelope.occurredAt);
  assertEquals(envelope.subject, "push event");
  assertEquals(typeof envelope.payload, "object");
});

Deno.test("[triggers_basic] ingestion service writes request file with correct frontmatter", async () => {
  const ledger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = makeTrackedLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-triggers_basic-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const adapter = new WebhookAdapter({ secret: WEBHOOK_SECRET });
    const envelope = await adapter.parse(
      await signedWebhookInput(JSON.stringify({ event: "deploy", ref: "main" }), "deploy trigger"),
    );

    const result = await service.ingest(envelope);

    assertEquals(result.accepted, true);
    assertEquals(result.disposition, "started");
    assertExists(result.resultingRequestId);

    // Verify the request file was written with correct frontmatter
    const files: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) files.push(entry.name);
    }
    assertEquals(files.length, 1);

    const content = await Deno.readTextFile(`${tmpDir}/${files[0]}`);
    assertStringIncludes(content, "source: webhook");
    assertStringIncludes(content, "request_source: trigger");
    assertStringIncludes(content, "action: start_flow");
    assertStringIncludes(content, "subject: deploy trigger");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[triggers_basic] duplicate webhook trigger is deduplicated", async () => {
  const ledger = new InMemoryIdempotencyLedger();
  const gate = new TriggerPolicyGate(ledger);
  const logger = makeNullLogger();

  const tmpDir = await Deno.makeTempDir({ prefix: "exaix-triggers_basic-" });
  try {
    const service = new TriggerIngestionService({
      policyGate: gate,
      eventLogger: logger,
      requestsDir: tmpDir,
      idempotencyLedger: ledger,
    });

    const adapter = new WebhookAdapter({ secret: WEBHOOK_SECRET });
    const body = JSON.stringify({ event: "push", ref: "main" });

    const first = await adapter.parse(await signedWebhookInput(body, "push"));
    // Use same idempotency key for both
    const second = { ...first, triggerId: crypto.randomUUID() };

    const r1 = await service.ingest(first);
    assertEquals(r1.accepted, true);
    assertEquals(r1.disposition, "started");

    const r2 = await service.ingest(second);
    assertEquals(r2.accepted, false);
    assertEquals(r2.disposition, "deduplicated");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
