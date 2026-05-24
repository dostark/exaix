/**
 * @module FetchUrlToolTest
 * @path tests/tools/fetch_url_test.ts
 * @description Verifies the 'fetch_url' tool, ensuring secure retrieval of external
 * content for agent knowledge grounding.
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { stub } from "@std/testing/mock";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: fetch_url", async (t) => {
  // Mock config with fetch_url enabled
  const config = ConfigSchema.parse({
    tools: {
      fetch_url: {
        enabled: true,
        allowed_domains: ["example.com", "api.example.com"],
        timeout_ms: 1000,
        max_response_size_kb: 1,
      },
    },
    // Minimal required config
    system: {},
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });

  const registry = new ToolRegistry({ config });

  await t.step("allows whitelisted domain", async () => {
    // Mock fetch
    const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(new Response("Hello World")));

    try {
      const result = await registry.execute(ToolName.FETCH_URL, { url: "https://example.com/docs" });
      assertEquals(result.success, true);
      assertEquals((result.data as { content: string })?.content, "Hello World");
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("blocks non-whitelisted domain", async () => {
    const result = await registry.execute(ToolName.FETCH_URL, { url: "https://evil.com/script.js" });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("not in the allowed whitelist"), true);
  });

  await t.step("enforces size limit", async () => {
    // Mock fetch with large response
    const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(new Response("A".repeat(2048))) // > 1KB
    );

    try {
      const result = await registry.execute(ToolName.FETCH_URL, { url: "https://example.com/large" });
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("exceeds maximum allowed size"), true);
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("respects disabled state", async () => {
    const disabledConfig = ConfigSchema.parse({
      tools: {
        fetch_url: { enabled: false }, // Explicitly disabled
      },
      // Minimal required config
      system: {},
      paths: {},
      database: {},
      watcher: {},
      agents: {},
      models: {},
      portals: [],
      mcp: {},
    });
    const disabledRegistry = new ToolRegistry({ config: disabledConfig });

    const result = await disabledRegistry.execute(ToolName.FETCH_URL, { url: "https://example.com" });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("disabled"), true);
  });

  await t.step("handles invalid url", async () => {
    const result = await registry.execute(ToolName.FETCH_URL, { url: "not-a-url" });
    assertEquals(result.success, false);
    assertEquals(result.error, "Invalid URL format");
  });
});
