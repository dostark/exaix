/**
 * @module VertexGoogleAuthHardeningTest
 * @path packages/ai-vertex/tests/google_auth_hardening_test.ts
 * @related-files ["packages/ai-vertex/src/auth/google_auth.ts", "packages/ai-vertex/src/constants.ts"]
 * @architectural-layer AI
 * @description Phase 80 Step 9 — hardens GoogleAuth token refresh: in-flight dedup
 * (single fetch under concurrency), a token-fetch timeout, validation of the token
 * response, and an early-refresh skew margin.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { GoogleAuth, type ServiceAccountKey } from "@exaix/ai-vertex";

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

function okTokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
}

Deno.test("GoogleAuth dedups concurrent refreshes into a single token fetch", async () => {
  const sa = await validServiceAccount();
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls++;
    return new Promise((resolve) => setTimeout(() => resolve(okTokenResponse()), 5));
  };
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, nowFn: () => 1_000_000 });
  const tokens = await Promise.all([
    auth.getAccessToken(),
    auth.getAccessToken(),
    auth.getAccessToken(),
    auth.getAccessToken(),
  ]);
  assertEquals(calls, 1);
  assertEquals(tokens, ["tok", "tok", "tok", "tok"]);
});

Deno.test("GoogleAuth rejects a malformed token response with a sanitized error", async () => {
  const sa = await validServiceAccount();
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl });
  let message = "";
  try {
    await auth.getAccessToken();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message.length > 0);
  assertEquals(message.includes("undefined"), false);
});

Deno.test("GoogleAuth times out a stalled token endpoint without leaking the body", async () => {
  const sa = await validServiceAccount();
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const requestInit = init as RequestInit | undefined;
      requestInit?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, tokenTimeoutMs: 20 });
  const error = await assertRejects(() => auth.getAccessToken(), Error);
  assertEquals(error.message.includes("RAW"), false);
});

Deno.test("GoogleAuth refreshes within the early-refresh skew margin", async () => {
  const sa = await validServiceAccount();
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls++;
    return Promise.resolve(okTokenResponse());
  };
  let now = 1_000_000;
  const auth = new GoogleAuth({ serviceAccount: sa, fetchImpl, nowFn: () => now });
  await auth.getAccessToken(); // expires_in 3600s, skew shaves the tail
  now += 3_595_000; // 3595s — past the skewed expiry (< raw 3600s TTL)
  await auth.getAccessToken();
  assertEquals(calls, 2);
});
