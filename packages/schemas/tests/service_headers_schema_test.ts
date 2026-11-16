/**
 * @module ServiceHeadersSchemaTest
 * @path packages/schemas/tests/service_headers_schema_test.ts
 * @description Verifies the extra request headers that a self-hosted catalog service may declare: custom x- headers and a user agent, never a credential, a framing header or a value that could split the request.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/model_binding.ts, packages/schemas/src/ai_config.ts]
 */
import { assertEquals } from "@std/assert";
import { BindingCatalogSchema, CompatibleChatConfigSchema, ServiceHeadersSchema } from "@exaix/schemas";

const SESSION_HEADER = { "x-opencode-session": "{session_id}" };

Deno.test("a service may declare a custom x- header and a user agent", () => {
  assertEquals(ServiceHeadersSchema.parse(SESSION_HEADER), SESSION_HEADER);
  assertEquals(
    ServiceHeadersSchema.parse({ "user-agent": "exaix-live-tests/1.0" })["user-agent"],
    "exaix-live-tests/1.0",
  );
});

Deno.test("[security] a header cannot carry a credential, a framing field or a name outside x- and user-agent", () => {
  for (const name of ["authorization", "proxy-authorization", "host", "content-type", "content-length", "cookie"]) {
    assertEquals(ServiceHeadersSchema.safeParse({ [name]: "v" }).success, false, name);
  }
  for (const name of ["x-api-key", "x-goog-api-key", "x-auth-token", "x-secret", "x-cookie"]) {
    assertEquals(ServiceHeadersSchema.safeParse({ [name]: "v" }).success, false, name);
  }
  assertEquals(ServiceHeadersSchema.safeParse({ "X-Upper": "v" }).success, false, "names are lowercase");
});

Deno.test("[security] a header value cannot split the request or hold control characters", () => {
  for (const value of ["a\r\nx-evil: 1", "a\nb", "a\rb", "tab\there", "", "é", "x".repeat(257)]) {
    assertEquals(ServiceHeadersSchema.safeParse({ "x-trace": value }).success, false, JSON.stringify(value));
  }
});

Deno.test("a service declares at most eight headers", () => {
  const eight = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`x-h${index}`, "v"]));
  assertEquals(ServiceHeadersSchema.safeParse(eight).success, true);
  assertEquals(ServiceHeadersSchema.safeParse({ ...eight, "x-h8": "v" }).success, false);
});

Deno.test("a catalog service and a compatible config carry headers, for the self-hosted profile only", () => {
  const catalog = BindingCatalogSchema.parse({
    services: {
      "opencode-go": {
        adapter: "openai-chat",
        profile: "self-hosted",
        endpoint: "https://opencode.ai/inference/go/openai/v1/chat/completions",
        transport: "cloud",
        interface: "api",
        headers: SESSION_HEADER,
        serves: {},
      },
    },
  });
  assertEquals(catalog.services?.["opencode-go"]?.headers, SESSION_HEADER);
  const config = { profile: "self-hosted", endpoint: "https://h.example/v1/chat/completions", model: "m" };
  assertEquals(CompatibleChatConfigSchema.safeParse({ ...config, headers: SESSION_HEADER }).success, true);
  assertEquals(
    CompatibleChatConfigSchema.safeParse({ profile: "deepseek", headers: SESSION_HEADER }).success,
    false,
    "a qualified profile sends only its fixed headers",
  );
});
