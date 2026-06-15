/**
 * @module VertexProviderTest
 * @path packages/ai-vertex/tests/vertex_provider_test.ts
 * @related-files ["packages/ai-vertex/src/vertex_provider.ts", "packages/ai-vertex/src/vertex_factory.ts", "packages/ai-vertex/src/constants.ts"]
 * @architectural-layer AI
 * @description Phase 80 Step 3 — validates the VertexProvider (regional endpoint, bearer-token
 * auth, Gemini response parsing into IGenerateResult) and the VertexProviderFactory (service
 * account resolution and actionable failure when credentials are missing).
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ProviderType } from "@exaix/core";
import { AuthenticationError } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGoogleAuth } from "@exaix-team/ai-vertex";
import {
  DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV,
  type ServiceAccountKey,
  VERTEX_PROVIDER_METADATA,
  VertexProvider,
  VertexProviderFactory,
} from "@exaix-team/ai-vertex";

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

const fakeAuth: IGoogleAuth = { getAccessToken: () => Promise.resolve("bearer-xyz") };

const GEMINI_RESPONSE = JSON.stringify({
  candidates: [{ content: { parts: [{ text: "hello from vertex" }] } }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
});

Deno.test("VertexProvider.generate calls the regional endpoint with a bearer token and parses the response", async () => {
  const sa = await validServiceAccount();
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    return Promise.resolve(new Response(GEMINI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const provider = new VertexProvider({
      apiKey: "",
      model: "gemini-2.5-flash",
      serviceAccount: sa,
      region: "us-central1",
      auth: fakeAuth,
    });
    const result = await provider.generate("hi");

    assertStringIncludes(capturedUrl, "us-central1-aiplatform.googleapis.com");
    assertStringIncludes(capturedUrl, "/projects/my-project/");
    assertStringIncludes(capturedUrl, "/locations/us-central1/");
    assertStringIncludes(capturedUrl, "models/gemini-2.5-flash:generateContent");
    assertEquals(capturedAuth, "Bearer bearer-xyz");
    assertEquals(result.content, "hello from vertex");
    assertEquals(result.usage.totalTokens, 12);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("VertexProvider exposes an IModelProvider surface", async () => {
  const sa = await validServiceAccount();
  const provider = new VertexProvider({
    apiKey: "",
    model: "gemini-2.5-flash",
    serviceAccount: sa,
    region: "us-central1",
    auth: fakeAuth,
  });
  assertEquals(typeof provider.generate, "function");
  assertStringIncludes(provider.id, "vertex-ai");
});

Deno.test("VertexProviderFactory.create returns a VertexProvider when the service account env is set", async () => {
  const sa = await validServiceAccount();
  Deno.env.set(DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV, JSON.stringify(sa));
  try {
    const factory = new VertexProviderFactory();
    const provider = await factory.create({
      provider: ProviderType.VERTEX,
      model: "gemini-2.5-flash",
      timeoutMs: 30_000,
    });
    assert(provider instanceof VertexProvider);
  } finally {
    Deno.env.delete(DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV);
  }
});

Deno.test("VertexProviderFactory.create throws an actionable error when the service account is missing", async () => {
  Deno.env.delete(DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV);
  const factory = new VertexProviderFactory();
  await assertRejects(
    () => factory.create({ provider: ProviderType.VERTEX, model: "gemini-2.5-flash", timeoutMs: 30_000 }),
    Error,
    DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV,
  );
});

Deno.test("VERTEX_PROVIDER_METADATA describes the vertex-ai provider", () => {
  assertEquals(VERTEX_PROVIDER_METADATA.name, "vertex-ai");
  assert(VERTEX_PROVIDER_METADATA.capabilities.includes("chat"));
});

Deno.test("VertexProvider metadata advertises no unimplemented capabilities", async () => {
  const provider: IModelProvider = new VertexProvider({
    apiKey: "",
    model: "gemini-2.5-flash",
    serviceAccount: await validServiceAccount(),
    region: "us-central1",
    auth: fakeAuth,
  });
  const capabilities = VERTEX_PROVIDER_METADATA.capabilities as readonly string[];
  if (capabilities.includes("streaming")) {
    assertEquals(typeof provider.generateStream, "function");
  }
});

Deno.test("VertexProvider.generate maps a 401 to AuthenticationError", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  try {
    const provider = new VertexProvider({
      apiKey: "",
      model: "gemini-2.5-flash",
      serviceAccount: await validServiceAccount(),
      region: "us-central1",
      auth: fakeAuth,
    });
    await assertRejects(() => provider.generate("hi"), AuthenticationError);
  } finally {
    globalThis.fetch = origFetch;
  }
});
