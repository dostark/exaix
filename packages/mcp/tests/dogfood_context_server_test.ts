/**
 * @module DogfoodContextServerTest
 * @path packages/mcp/tests/dogfood_context_server_test.ts
 * @description Real SDK client (ExternalMcpClient) exercising
 * DogfoodContextServer over a real loopback HTTP listener: initialize/list/call all
 * three tools, plus the adversarial matrix (forged/absent/revoked credential, hostile
 * Origin/Host, wrong method, oversized body/output, extra portal/trace fields, one
 * in-flight, expiry, call/token limits, no analysis on cold data).
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/dogfood_context_server.ts, packages/mcp/tests/fixtures/authenticated_reference_server.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ExternalMcpClient } from "@exaix/mcp";
import { startDogfoodContextServer } from "@exaix/mcp/server";
import type { IDogfoodContextServerDeps, IDogfoodContextServerMemorySource } from "@exaix/mcp/server";
import { ToolName } from "@exaix/core";
import { PortalAnalysisMode } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

const TOKEN = "test-dogfood-bearer-secret";
const PORTAL_ALIAS = "test-portal";

function makeKnowledge(): IPortalKnowledge {
  return {
    portal: PORTAL_ALIAS,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [{
      name: "services",
      paths: ["services/"],
      responsibility: "Business logic",
      keyFiles: ["services/main.ts"],
    }],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    relationships: [{ from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" }],
    stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
    metadata: { durationMs: 0, mode: PortalAnalysisMode.STANDARD, filesScanned: 0, filesRead: 0 },
  };
}

function makeMemorySource(
  items: ReadonlyArray<{ title: string; content: string; source?: string; relevance: number }> = [],
  delayMs = 0,
): IDogfoodContextServerMemorySource {
  return {
    lookupMemories: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return items;
    },
  };
}

function baseDeps(overrides: Partial<IDogfoodContextServerDeps> = {}): IDogfoodContextServerDeps {
  return {
    bearerToken: TOKEN,
    connectionId: crypto.randomUUID(),
    parentTraceId: crypto.randomUUID(),
    childTraceId: crypto.randomUUID(),
    portalAlias: PORTAL_ALIAS,
    knowledge: makeKnowledge(),
    memory: makeMemorySource(),
    now: () => new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    queryChars: 2000,
    memoryTopKDefault: 5,
    maxQueryCalls: 16,
    maxQueryTokens: 8192,
    maxResponseBytes: 32_768,
    maxRequestBytes: 8192,
    ...overrides,
  };
}

Deno.test("[DogfoodContextServer] starts, grants exactly three tools, and a real SDK client can initialize/list/call all three", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  const client = new ExternalMcpClient();
  try {
    assertEquals(
      handle.tools.map((t) => t.name).toSorted(),
      [
        ToolName.QUERY_RELATIONSHIPS,
        ToolName.SEARCH_MEMORY,
        ToolName.WHO_DEPENDS_ON,
      ].toSorted(),
    );

    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const tools = await client.listTools();
    assertEquals(
      tools.map((t) => t.name).toSorted(),
      [
        ToolName.QUERY_RELATIONSHIPS,
        ToolName.SEARCH_MEMORY,
        ToolName.WHO_DEPENDS_ON,
      ].toSorted(),
    );

    const relResult = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(JSON.parse((relResult.content[0] as { text: string }).text), [
      { from: "services", to: "services/main.ts", kind: "layer_contains_file" },
    ]);

    const depResult = await client.callTool(ToolName.WHO_DEPENDS_ON, { path: "util.ts" });
    assertEquals(JSON.parse((depResult.content[0] as { text: string }).text), [
      { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
    ]);

    const memResult = await client.callTool(ToolName.SEARCH_MEMORY, { query: "auth" });
    assertEquals(JSON.parse((memResult.content[0] as { text: string }).text), []);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a forged credential is rejected", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  const client = new ExternalMcpClient();
  try {
    await assertRejects(() => client.connect(new URL(handle.url), { bearerToken: "wrong-token" }));
  } finally {
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] an absent credential is rejected", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  try {
    const res = await fetch(handle.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a revoked credential is rejected after close() — the listener itself is torn down", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  await handle.close("completed");
  await assertRejects(() =>
    fetch(handle.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
});

Deno.test("[DogfoodContextServer] a hostile Origin header is rejected", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  try {
    const res = await fetch(handle.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        origin: "https://evil.example.com",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(res.status, 403);
    await res.body?.cancel();
  } finally {
    await handle.close("completed");
  }
});

/** `fetch()` treats `Host` as a forbidden header it silently won't override, so a hostile
 *  Host header can only be simulated over a raw socket, hand-writing the HTTP/1.1 request. */
async function sendRawHttpRequestWithHost(port: number, hostHeaderValue: string): Promise<number> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const request = `POST /mcp HTTP/1.1\r\n` +
      `Host: ${hostHeaderValue}\r\n` +
      `Authorization: Bearer ${TOKEN}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${new TextEncoder().encode(body).length}\r\n` +
      `Connection: close\r\n\r\n${body}`;
    await conn.write(new TextEncoder().encode(request));
    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(4096);
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      chunks.push(buf.slice(0, n));
    }
    const raw = new TextDecoder().decode(chunks.reduce((acc, c) => new Uint8Array([...acc, ...c]), new Uint8Array()));
    const statusLine = raw.split("\r\n")[0];
    return Number(statusLine.split(" ")[1]);
  } finally {
    conn.close();
  }
}

Deno.test("[DogfoodContextServer] a hostile Host header is rejected", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  try {
    const port = Number(new URL(handle.url).port);
    const status = await sendRawHttpRequestWithHost(port, "evil.example.com");
    assertEquals(status, 403);
  } finally {
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] an unsupported HTTP method is rejected", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  try {
    const res = await fetch(handle.url, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assertEquals(res.status, 405);
    await res.body?.cancel();
  } finally {
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] an oversized request body is rejected before parsing", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ maxRequestBytes: 64 }));
  try {
    const res = await fetch(handle.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", padding: "x".repeat(1000) }),
    });
    assertEquals(res.status, 413);
    await res.body?.cancel();
  } finally {
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] an oversized output is truncated to the byte budget, not returned whole", async () => {
  const bigKnowledge = makeKnowledge();
  const manyFiles = Array.from({ length: 500 }, (_, i) => `services/file_${i}.ts`);
  bigKnowledge.layers = [{
    name: "services",
    paths: ["services/"],
    responsibility: "Business logic",
    keyFiles: manyFiles,
  }];
  const handle = await startDogfoodContextServer(baseDeps({ knowledge: bigKnowledge, maxResponseBytes: 500 }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const result = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text) as unknown[];
    assertEquals(new TextEncoder().encode(text).length <= 500, true);
    assertEquals(parsed.length < 500, true);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] extra portal/trace fields on a tool call are ignored, not honored as scope", async () => {
  const handle = await startDogfoodContextServer(baseDeps());
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const result = await client.callTool(ToolName.QUERY_RELATIONSHIPS, {
      from: "services",
      portal: "some-other-portal",
      traceId: "hostile-trace",
    });
    assertEquals(JSON.parse((result.content[0] as { text: string }).text), [
      { from: "services", to: "services/main.ts", kind: "layer_contains_file" },
    ]);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a second concurrent call is denied while the first is in flight", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ memory: makeMemorySource([], 200) }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const first = client.callTool(ToolName.SEARCH_MEMORY, { query: "auth" });
    await new Promise((r) => setTimeout(r, 20));
    const second = await client.callTool(ToolName.SEARCH_MEMORY, { query: "auth" });
    assertEquals(second.isError, true);
    await first;
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a call after the connection has expired is denied", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ expiresAt: new Date(Date.now() - 1000) }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const result = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(result.isError, true);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a call beyond the configured call limit is denied", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ maxQueryCalls: 1 }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const firstResult = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(firstResult.isError ?? false, false);
    const secondResult = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(secondResult.isError, true);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] a call exceeding the cumulative output token budget is denied", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ maxQueryTokens: 1 }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const result = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(result.isError, true);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});

Deno.test("[DogfoodContextServer] cold (undefined) cached knowledge returns empty results without triggering analysis", async () => {
  const handle = await startDogfoodContextServer(baseDeps({ knowledge: undefined }));
  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(handle.url), { bearerToken: TOKEN });
    const relResult = await client.callTool(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(JSON.parse((relResult.content[0] as { text: string }).text), []);
    const depResult = await client.callTool(ToolName.WHO_DEPENDS_ON, { path: "util.ts" });
    assertEquals(JSON.parse((depResult.content[0] as { text: string }).text), []);
  } finally {
    await client.close();
    await handle.close("completed");
  }
});
