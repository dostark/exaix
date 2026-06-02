/**
 * @module VertexGoogleAuthTest
 * @path packages/ai-vertex/tests/google_auth_test.ts
 * @related-files ["packages/ai-vertex/src/auth/service_account.ts", "packages/ai-vertex/src/auth/google_auth.ts", "packages/ai-vertex/src/auth/encoding.ts"]
 * @architectural-layer AI
 * @description Phase 80 Step 2 — validates secure Google service-account auth for Vertex AI:
 * schema + token-URI allowlist, env parsing with zero credential leakage, JWT RS256 signing,
 * token caching/refresh, and overflow-safe base64url encoding.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { LogMetadata } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import {
  base64UrlEncode,
  GOOGLE_TOKEN_HOST_SUFFIX,
  GoogleAuth,
  parseServiceAccountFromEnv,
  type ServiceAccountKey,
  ServiceAccountKeySchema,
} from "@exaix/ai-vertex";

const FAKE_KEY_MARKER = "SUPER-SECRET-PRIVATE-KEY-MATERIAL";

/** Build a real RSASSA-PKCS1-v1_5 / SHA-256 private key in PEM (pkcs8) form. */
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

Deno.test("ServiceAccountKeySchema accepts a valid Google service account", async () => {
  const result = ServiceAccountKeySchema.safeParse(await validServiceAccount());
  assertEquals(result.success, true);
});

Deno.test("ServiceAccountKeySchema rejects a non-googleapis.com token_uri (SSRF guard)", async () => {
  const sa = { ...(await validServiceAccount()), token_uri: "https://evil.example.com/token" };
  const result = ServiceAccountKeySchema.safeParse(sa);
  assertEquals(result.success, false);
  assert(GOOGLE_TOKEN_HOST_SUFFIX.endsWith(".googleapis.com"));
});

Deno.test("parseServiceAccountFromEnv returns the account for valid JSON", async () => {
  const sa = await validServiceAccount();
  Deno.env.set("TEST_SA_VALID", JSON.stringify(sa));
  try {
    const parsed = parseServiceAccountFromEnv("TEST_SA_VALID");
    assert(parsed !== null);
    assertEquals(parsed?.project_id, "my-project");
  } finally {
    Deno.env.delete("TEST_SA_VALID");
  }
});

Deno.test("parseServiceAccountFromEnv returns null and leaks no key material on malformed JSON", () => {
  // The implementation logs only via the injected logger (never console), so the
  // redacted event payload is the surface that must be proven secret-free.
  const loggerCaptured: string[] = [];
  const record = (_a: string, _t: string | null, p?: LogMetadata): Promise<void> => {
    loggerCaptured.push(JSON.stringify(p ?? {}));
    return Promise.resolve();
  };
  const recordingLogger: IEventLogger = {
    log: () => Promise.resolve(),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => recordingLogger,
  };
  Deno.env.set("TEST_SA_BAD", `{ not valid json, "${FAKE_KEY_MARKER}" `);
  try {
    const parsed = parseServiceAccountFromEnv("TEST_SA_BAD", recordingLogger);
    assertEquals(parsed, null);
    assertEquals(
      loggerCaptured.join(" ").includes(FAKE_KEY_MARKER),
      false,
      "no key material may appear in the redacted event payload",
    );
  } finally {
    Deno.env.delete("TEST_SA_BAD");
  }
});

Deno.test("GoogleAuth.getAccessToken signs an RS256 JWT and returns the token", async () => {
  const sa = await validServiceAccount();
  let seenAssertion = "";
  const fetchImpl: typeof fetch = (_input, init) => {
    const requestInit = init as RequestInit | undefined;
    const body = new URLSearchParams(requestInit?.body as string);
    seenAssertion = body.get("assertion") ?? "";
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: "tok-abc", expires_in: 3600 }), { status: 200 }),
    );
  };

  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl });
  const token = await auth.getAccessToken();
  assertEquals(token, "tok-abc");
  const segments = seenAssertion.split(".");
  assertEquals(segments.length, 3);
  const header = JSON.parse(atob(segments[0].replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(header.alg, "RS256");
  assertEquals(header.typ, "JWT");
});

Deno.test("GoogleAuth caches the token while unexpired", async () => {
  const sa = await validServiceAccount();
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 }));
  };
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, nowFn: () => 1_000_000 });
  await auth.getAccessToken();
  await auth.getAccessToken();
  assertEquals(calls, 1);
});

Deno.test("GoogleAuth refreshes when the cached token has expired", async () => {
  const sa = await validServiceAccount();
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ access_token: "tok", expires_in: 10 }), { status: 200 }));
  };
  let now = 1_000_000;
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, nowFn: () => now });
  await auth.getAccessToken();
  now += 20_000; // advance 20s past a 10s TTL
  await auth.getAccessToken();
  assertEquals(calls, 2);
});

Deno.test("GoogleAuth surfaces a sanitized error without the upstream body", async () => {
  const sa = await validServiceAccount();
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response("RAW-UPSTREAM-TOKEN-LEAK", { status: 401 }));
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl });
  let message = "";
  try {
    await auth.getAccessToken();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message.length > 0);
  assertEquals(message.includes("RAW-UPSTREAM-TOKEN-LEAK"), false);
});

Deno.test("base64UrlEncode handles large inputs without stack overflow", () => {
  const big = new Uint8Array(200_000).fill(65);
  const encoded = base64UrlEncode(big);
  assertEquals(/^[A-Za-z0-9_-]+$/.test(encoded), true);
  assertStringIncludes(encoded, "Q"); // 'A' (0x41) triplets encode to "QUFB"
});
