/**
 * @module VertexAuthEventsTest
 * @path packages/ai-vertex/tests/auth_events_test.ts
 * @related-files ["packages/ai-vertex/src/auth/google_auth.ts", "packages/ai-vertex/src/auth/service_account.ts", "packages/core/src/cost/cost_tracker.ts"]
 * @architectural-layer AI
 * @description Phase 80 Step 7 — locks the traceability contract for Vertex auth: a successful
 * token refresh emits a typed, secret-free `provider.auth.token_refreshed` event, a malformed
 * service account emits `provider.auth.invalid_service_account`, and CostTracker attributes
 * Vertex usage via COST_RATE_VERTEX.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { LogMetadata } from "@exaix/core";
import { COST_RATE_VERTEX, PROVIDER_VERTEX, TOKENS_PER_COST_UNIT } from "@exaix/core";
import { CostTracker } from "@exaix/core/cost";
import type { IEventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import {
  EVENT_AUTH_INVALID_SERVICE_ACCOUNT,
  EVENT_AUTH_TOKEN_REFRESHED,
  GoogleAuth,
  parseServiceAccountFromEnv,
  type ServiceAccountKey,
} from "@exaix/ai-vertex";

interface ICapturedEvent {
  action: string;
  payload?: LogMetadata;
}

/** Recording IEventLogger that captures every emitted action + payload. */
function recordingLogger(sink: ICapturedEvent[]): IEventLogger {
  const capture = (action: string, _t: string | null, payload?: LogMetadata): Promise<void> => {
    sink.push({ action, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: capture,
    warn: capture,
    error: capture,
    fatal: capture,
    debug: capture,
    child: () => logger,
  };
  return logger;
}

const FAKE_KEY_MARKER = "SUPER-SECRET-PRIVATE-KEY-MATERIAL";

async function generatePrivateKeyPem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function validServiceAccount(): Promise<ServiceAccountKey> {
  return {
    type: "service_account",
    project_id: "my-project",
    private_key_id: "kid-1",
    private_key: await generatePrivateKeyPem(),
    client_email: "exaix@my-project.iam.gserviceaccount.com",
    client_id: "12345",
    auth_uri: "https://accounts.googleapis.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/exaix.iam.gserviceaccount.com",
  };
}

Deno.test("GoogleAuth emits a typed, secret-free token_refreshed event on refresh", async () => {
  const sa = await validServiceAccount();
  const events: ICapturedEvent[] = [];
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 }));

  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, logger: recordingLogger(events) });
  await auth.getAccessToken();

  const refreshed = events.find((e) => e.action === EVENT_AUTH_TOKEN_REFRESHED);
  assert(refreshed, "expected a token_refreshed event");
  assertEquals(refreshed?.payload?.provider, PROVIDER_VERTEX);
  assertEquals(refreshed?.payload?.refreshed, true);
  assertEquals(JSON.stringify(refreshed?.payload).includes(FAKE_KEY_MARKER), false);
});

Deno.test("parseServiceAccountFromEnv emits an invalid_service_account event on malformed input", () => {
  const events: ICapturedEvent[] = [];
  Deno.env.set("TEST_SA_EVT", `{ broken "${FAKE_KEY_MARKER}" `);
  try {
    const parsed = parseServiceAccountFromEnv("TEST_SA_EVT", recordingLogger(events));
    assertEquals(parsed, null);
    const invalid = events.find((e) => e.action === EVENT_AUTH_INVALID_SERVICE_ACCOUNT);
    assert(invalid, "expected an invalid_service_account event");
    assertEquals(JSON.stringify(invalid?.payload).includes(FAKE_KEY_MARKER), false);
  } finally {
    Deno.env.delete("TEST_SA_EVT");
  }
});

Deno.test("CostTracker attributes Vertex usage via COST_RATE_VERTEX", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    const cost = await tracker.trackGeneration(PROVIDER_VERTEX, "gemini-2.5-flash", {
      promptTokens: 800,
      completionTokens: 1200,
      totalTokens: 2000,
    });
    assertAlmostEquals(cost, 2000 * (COST_RATE_VERTEX / TOKENS_PER_COST_UNIT));
    await db.close();
  } finally {
    await cleanup();
  }
});
