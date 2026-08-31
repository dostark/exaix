/**
 * @module IExternalMcpClientTest
 * @path packages/mcp/tests/i_external_mcp_client_test.ts
 * @description Type-only compile-time smoke test: a minimal object literal must
 * satisfy `IExternalMcpClient` under `deno check`/`deno test`. This is a
 * positive-only compile-time assertion — the repo bans TypeScript suppression
 * pragmas that bypass the compiler (see `CODE_STYLE.md`'s "No TypeScript
 * suppression pragmas" rule, enforced by `scripts/check_code_style.ts`'s
 * `[ts-suppression-pragmas]` check), so there is deliberately no negative
 * "missing method" case (Pre-Gap Analysis GAP-1).
 * @architectural-layer MCP
 * @dependencies [@exaix/mcp, @exaix/core]
 * @related-files [packages/mcp/src/i_external_mcp_client.ts]
 */

import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type {
  ExternalMcpTransportKind,
  IExternalMcpCallResult,
  IExternalMcpClient,
  IExternalMcpConnectOptions,
  IExternalMcpToolDefinition,
} from "@exaix/mcp";

/** `satisfies IExternalMcpClient` is the assertion — a missing method, wrong signature,
 *  or wrong property type fails `deno check` right here. */
const minimalImplementation = {
  activeTransport: undefined as ExternalMcpTransportKind | undefined,
  connect: (_endpoint: URL): Promise<void> => Promise.resolve(),
  listTools: (): Promise<IExternalMcpToolDefinition[]> => Promise.resolve([]),
  callTool: (_name: string, _args: Record<string, JSONValue>): Promise<IExternalMcpCallResult> =>
    Promise.resolve({ content: [] }),
  close: (): Promise<void> => Promise.resolve(),
} satisfies IExternalMcpClient;

Deno.test("IExternalMcpClient - a minimal implementation object literal satisfies the interface", async () => {
  assertEquals(typeof minimalImplementation.connect, "function");
  assertEquals(typeof minimalImplementation.listTools, "function");
  assertEquals(typeof minimalImplementation.callTool, "function");
  assertEquals(typeof minimalImplementation.close, "function");
  assertEquals(minimalImplementation.activeTransport, undefined);

  await minimalImplementation.connect(new URL("http://localhost:0/mcp"));
  assertEquals(await minimalImplementation.listTools(), []);
  assertEquals(await minimalImplementation.callTool("noop", {}), { content: [] });
  await minimalImplementation.close();
});

/** Checks `IExternalMcpConnectOptions` is importable from the public barrel
 *  (`@exaix/mcp`), not just the deep `i_external_mcp_client.ts` path. */
const minimalConnectOptions = { bearerToken: "token" } satisfies IExternalMcpConnectOptions;

Deno.test("@exaix/mcp barrel - IExternalMcpConnectOptions is importable from the package's public surface", () => {
  assertEquals(minimalConnectOptions.bearerToken, "token");
});
