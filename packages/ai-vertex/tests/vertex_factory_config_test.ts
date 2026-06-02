/**
 * @module VertexFactoryConfigTest
 * @path packages/ai-vertex/tests/vertex_factory_config_test.ts
 * @related-files ["packages/ai-vertex/src/vertex_factory.ts", "packages/ai/src/provider_factory.ts", "packages/schemas/src/config.ts"]
 * @architectural-layer AI
 * @description Phase 80 follow-up — verifies the VertexProviderFactory honours config.ai_vertex
 * overrides (service_account_env, region) threaded through IResolvedProviderOptions.config.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { ExaPathDefaults, LogLevel, ProviderType } from "@exaix/core";
import { type Config, ConfigSchema } from "@exaix/schemas";
import { type ServiceAccountKey, VertexProvider, VertexProviderFactory } from "@exaix/ai-vertex";

interface IConfigOverrides {
  ai_vertex?: { service_account_env?: string; region?: string };
}

function makeConfig(overrides: IConfigOverrides): Config {
  const result = ConfigSchema.safeParse({
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
    ...overrides,
  });
  if (!result.success) {
    throw new Error(`bad test config: ${result.error}`);
  }
  return result.data;
}

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

const GEMINI_RESPONSE = JSON.stringify({
  candidates: [{ content: { parts: [{ text: "ok" }] } }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
});

Deno.test("VertexProviderFactory reads service_account_env from config.ai_vertex", async () => {
  const sa = await validServiceAccount();
  Deno.env.delete("VERTEX_AI_SERVICE_ACCOUNT");
  Deno.env.set("CUSTOM_VERTEX_SA", JSON.stringify(sa));
  try {
    const config = makeConfig({ ai_vertex: { service_account_env: "CUSTOM_VERTEX_SA", region: "us-central1" } });
    const factory = new VertexProviderFactory();
    const provider = await factory.create({
      provider: ProviderType.VERTEX,
      model: "gemini-2.5-flash",
      timeoutMs: 30_000,
      config,
    });
    assert(provider instanceof VertexProvider);
  } finally {
    Deno.env.delete("CUSTOM_VERTEX_SA");
  }
});

Deno.test("VertexProviderFactory applies config.ai_vertex.region to the request endpoint", async () => {
  const sa = await validServiceAccount();
  Deno.env.set("VERTEX_AI_SERVICE_ACCOUNT", JSON.stringify(sa));
  let capturedUrl = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("aiplatform.googleapis.com")) {
      capturedUrl = url;
      return Promise.resolve(new Response(GEMINI_RESPONSE, { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 }));
  }) as typeof fetch;

  try {
    const config = makeConfig({
      ai_vertex: { region: "europe-west4", service_account_env: "VERTEX_AI_SERVICE_ACCOUNT" },
    });
    const factory = new VertexProviderFactory();
    const provider = await factory.create({
      provider: ProviderType.VERTEX,
      model: "gemini-2.5-flash",
      timeoutMs: 30_000,
      config,
    });
    await provider.generate("hi");
    assertStringIncludes(capturedUrl, "europe-west4-aiplatform.googleapis.com");
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.delete("VERTEX_AI_SERVICE_ACCOUNT");
  }
});
