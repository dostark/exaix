/**
 * @module ExternalAdaptersTest
 * @path packages/triggers/tests/external_adapters_test.ts
 * @description Steps 3 & 5 — Contract, integration, and security tests for optional external
 * trigger adapters: WebhookAdapter (HMAC, payload size), ScheduleAdapter (cron validation),
 * FilesystemAdapter (path traversal + symlink guard), AdapterRegistry, and
 * InternalEventAdapter allow-list (GAP-5, GAP-6).
 * @architectural-layer Triggers
 * @related-files [
 *   packages/triggers/adapters/webhook_adapter.ts,
 *   packages/triggers/adapters/schedule_adapter.ts,
 *   packages/triggers/adapters/filesystem_adapter.ts,
 *   packages/triggers/adapters/adapter_registry.ts,
 *   packages/triggers/adapters/internal_event_adapter.ts
 * ]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FilesystemEventKind } from "@exaix/core/types";
import { WebhookAdapter } from "../adapters/webhook_adapter.ts";
import { ScheduleAdapter } from "../adapters/schedule_adapter.ts";
import { FilesystemAdapter } from "../adapters/filesystem_adapter.ts";
import { InternalEventAdapter } from "../adapters/internal_event_adapter.ts";
import { AdapterRegistry, UnsupportedTriggerSourceError } from "../adapters/adapter_registry.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function computeHmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
}

// ---------------------------------------------------------------------------
// WebhookAdapter
// ---------------------------------------------------------------------------

Deno.test("[WebhookAdapter] source is webhook", () => {
  const adapter = new WebhookAdapter({});
  assertEquals(adapter.source, "webhook");
});

Deno.test("[WebhookAdapter] parses a valid HMAC-signed webhook body", async () => {
  const secret = "github-push-secret";
  const body = JSON.stringify({ event: "push", ref: "refs/heads/main" });
  const signature = await computeHmacSha256(secret, body);
  const adapter = new WebhookAdapter({ secret });
  const envelope = await adapter.parse({
    body,
    headers: { "x-hub-signature-256": signature },
    subject: "github.push",
  });
  assertEquals(envelope.source, "webhook");
  assertEquals(envelope.action, "start_flow");
  assertEquals(envelope.subject, "github.push");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
});

Deno.test("[WebhookAdapter] rejects payload exceeding max size", async () => {
  const adapter = new WebhookAdapter({ maxPayloadBytes: 10 });
  const body = "x".repeat(11);
  await assertRejects(
    () => adapter.parse({ body, headers: {} }),
    Error,
    "payload",
  );
});

Deno.test("[WebhookAdapter] rejects invalid HMAC signature when secret is configured", async () => {
  const adapter = new WebhookAdapter({ secret: "my-secret" });
  const body = JSON.stringify({ event: "push" });
  await assertRejects(
    () =>
      adapter.parse({
        body,
        headers: { "x-hub-signature-256": "sha256=badhash" },
      }),
    Error,
    "signature",
  );
});

Deno.test("[WebhookAdapter] accepts valid HMAC signature", async () => {
  const secret = "my-webhook-secret";
  const body = JSON.stringify({ event: "push", ref: "refs/heads/main" });
  const signature = await computeHmacSha256(secret, body);
  const adapter = new WebhookAdapter({ secret });
  const envelope = await adapter.parse({
    body,
    headers: { "x-hub-signature-256": signature },
  });
  assertEquals(envelope.source, "webhook");
  assertExists(envelope.triggerId);
});

Deno.test("[WebhookAdapter] rejects missing signature header when secret is configured", async () => {
  const adapter = new WebhookAdapter({ secret: "my-secret" });
  const body = "{}";
  await assertRejects(
    () => adapter.parse({ body, headers: {} }),
    Error,
    "signature",
  );
});

Deno.test("security: WebhookAdapter fails closed when no secret is configured (Finding 9)", async () => {
  const adapter = new WebhookAdapter({});
  // An adapter with no secret must reject every payload rather than accept it unsigned.
  await assertRejects(
    () => adapter.parse({ body: "{}", headers: {} }),
    Error,
    "secret",
  );
});

// ---------------------------------------------------------------------------
// ScheduleAdapter
// ---------------------------------------------------------------------------

Deno.test("[ScheduleAdapter] source is schedule", () => {
  const adapter = new ScheduleAdapter();
  assertEquals(adapter.source, "schedule");
});

Deno.test("[ScheduleAdapter] parses valid 5-part cron expression", async () => {
  const adapter = new ScheduleAdapter();
  const envelope = await adapter.parse({ cronExpression: "0 9 * * 1", subject: "weekly-report" });
  assertEquals(envelope.source, "schedule");
  assertEquals(envelope.action, "start_flow");
  assertEquals(envelope.subject, "weekly-report");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
});

Deno.test("[ScheduleAdapter] rejects 6-part cron expression (with seconds)", async () => {
  const adapter = new ScheduleAdapter();
  await assertRejects(
    () => adapter.parse({ cronExpression: "30 0 9 * * 1" }),
    Error,
    "cron",
  );
});

Deno.test("[ScheduleAdapter] rejects @reboot style schedule", async () => {
  const adapter = new ScheduleAdapter();
  await assertRejects(
    () => adapter.parse({ cronExpression: "@reboot" }),
    Error,
    "cron",
  );
});

Deno.test("[ScheduleAdapter] rejects empty cron expression", async () => {
  const adapter = new ScheduleAdapter();
  await assertRejects(
    () => adapter.parse({ cronExpression: "" }),
    Error,
    "cron",
  );
});

Deno.test("[ScheduleAdapter] rejects arbitrary shell-injection attempt", async () => {
  const adapter = new ScheduleAdapter();
  await assertRejects(
    () => adapter.parse({ cronExpression: "0 9 * * *; rm -rf /" }),
    Error,
    "cron",
  );
});

// ---------------------------------------------------------------------------
// FilesystemAdapter
// ---------------------------------------------------------------------------

Deno.test("[FilesystemAdapter] source is filesystem", () => {
  const adapter = new FilesystemAdapter({ allowedDir: "/workspace" });
  assertEquals(adapter.source, "filesystem");
});

Deno.test("[FilesystemAdapter] parses path within allowed directory", async () => {
  const adapter = new FilesystemAdapter({ allowedDir: "/workspace" });
  const envelope = await adapter.parse({
    path: "/workspace/Requests/my-request.md",
    kind: FilesystemEventKind.CREATE,
  });
  assertEquals(envelope.source, "filesystem");
  assertEquals(envelope.action, "start_flow");
  assertEquals(envelope.subject, "/workspace/Requests/my-request.md");
  assertExists(envelope.triggerId);
});

Deno.test("[FilesystemAdapter] rejects path with .. traversal", async () => {
  const adapter = new FilesystemAdapter({ allowedDir: "/workspace" });
  await assertRejects(
    () => adapter.parse({ path: "/workspace/../etc/passwd" }),
    Error,
    "traversal",
  );
});

Deno.test("[FilesystemAdapter] rejects path outside allowed directory", async () => {
  const adapter = new FilesystemAdapter({ allowedDir: "/workspace" });
  await assertRejects(
    () => adapter.parse({ path: "/etc/passwd" }),
    Error,
    "outside",
  );
});

Deno.test("[FilesystemAdapter] rejects empty path", async () => {
  const adapter = new FilesystemAdapter({ allowedDir: "/workspace" });
  await assertRejects(
    () => adapter.parse({ path: "" }),
    Error,
  );
});

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

Deno.test("[AdapterRegistry] resolve returns registered adapter", () => {
  const registry = new AdapterRegistry();
  const adapter = new WebhookAdapter({});
  registry.register(adapter);
  const resolved = registry.resolve("webhook");
  assertExists(resolved);
  assertEquals(resolved.source, "webhook");
});

Deno.test("[AdapterRegistry] resolve returns undefined for unregistered source", () => {
  const registry = new AdapterRegistry();
  const resolved = registry.resolve("webhook");
  assertEquals(resolved, undefined);
});

Deno.test("[AdapterRegistry] parseRaw returns envelope for registered adapter", async () => {
  const registry = new AdapterRegistry();
  const secret = "registry-dispatch-secret";
  const body = "{}";
  const signature = await computeHmacSha256(secret, body);
  registry.register(new WebhookAdapter({ secret }));
  const envelope = await registry.parseRaw("webhook", {
    body,
    headers: { "x-hub-signature-256": signature },
  });
  assertEquals(envelope.source, "webhook");
});

Deno.test("[AdapterRegistry] parseRaw throws UnsupportedTriggerSourceError for unregistered source", async () => {
  const registry = new AdapterRegistry();
  await assertRejects(
    () => registry.parseRaw("schedule", { cronExpression: "0 9 * * *" }),
    UnsupportedTriggerSourceError,
  );
});

Deno.test("[AdapterRegistry] register overwrites existing adapter for same source", () => {
  const registry = new AdapterRegistry();
  const adapterA = new WebhookAdapter({ maxPayloadBytes: 100 });
  const adapterB = new WebhookAdapter({ maxPayloadBytes: 200 });
  registry.register(adapterA);
  registry.register(adapterB);
  const resolved = registry.resolve("webhook");
  assertExists(resolved);
  // Both have same source; second registration wins
  assertEquals(resolved.source, "webhook");
});

// ---------------------------------------------------------------------------
// Security: FilesystemAdapter symlink bypass
// ---------------------------------------------------------------------------

Deno.test("[FilesystemAdapter] rejects symlink pointing outside allowed directory", async () => {
  const allowedDir = await Deno.makeTempDir({ prefix: "exaix-allowed-" });
  const outsideDir = await Deno.makeTempDir({ prefix: "exaix-outside-" });
  const symlinkPath = join(allowedDir, "evil-link");
  await Deno.symlink(outsideDir, symlinkPath);

  try {
    const adapter = new FilesystemAdapter({ allowedDir });
    await assertRejects(
      () => adapter.parse({ path: symlinkPath }),
      Error,
      "outside allowed directory",
    );
  } finally {
    await Deno.remove(symlinkPath);
    await Deno.remove(allowedDir, { recursive: true });
    await Deno.remove(outsideDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Security: InternalEventAdapter allow-list
// ---------------------------------------------------------------------------

Deno.test("[InternalEventAdapter] rejects unknown eventType string", async () => {
  const adapter = new InternalEventAdapter();
  await assertRejects(
    () => adapter.parse({ eventType: "totally.made.up.event" }),
    Error,
    "unknown eventType",
  );
});

Deno.test("[InternalEventAdapter] accepts known DomainEventType value", async () => {
  const adapter = new InternalEventAdapter();
  const envelope = await adapter.parse({ eventType: "flow.step.completed" });
  assertEquals(envelope.source, "internal_event");
  assertEquals(envelope.subject, "flow.step.completed");
});

Deno.test("[InternalEventAdapter] accepts absent eventType as unknown", async () => {
  const adapter = new InternalEventAdapter();
  const envelope = await adapter.parse({});
  assertEquals(envelope.source, "internal_event");
  assertEquals(envelope.subject, "unknown");
});

// ---------------------------------------------------------------------------
// Integration: webhook adapter → registry dispatch (one representative path)
// ---------------------------------------------------------------------------

Deno.test("[Integration] WebhookAdapter parses and registry resolves for start_flow", async () => {
  const registry = new AdapterRegistry();
  const secret = "integration-webhook-secret";
  registry.register(new WebhookAdapter({ secret }));
  registry.register(new ScheduleAdapter());
  registry.register(new FilesystemAdapter({ allowedDir: "/workspace" }));

  const body = JSON.stringify({ event: "deployment.created" });
  const signature = await computeHmacSha256(secret, body);
  const envelope = await registry.parseRaw("webhook", {
    body,
    headers: { "x-hub-signature-256": signature },
    subject: "deployment.created",
  });

  assertEquals(envelope.source, "webhook");
  assertEquals(envelope.action, "start_flow");
  assertExists(envelope.triggerId);
  assertExists(envelope.idempotencyKey);
});
