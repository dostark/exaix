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

/**
 * A minimal object literal type-checked against `IExternalMcpClient` via the
 * `satisfies` operator — the repo's real compile-time-assertion convention
 * (see e.g. `packages/core/src/observability/milestone_emitter.ts` and
 * `packages/execution/tests/agents/react_loop_strategy_test.ts`). A missing
 * method, wrong signature, or wrong property type fails `deno check` right
 * here — the compiler is the assertion, no runtime check needed for that part.
 */
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

/**
 * `IExternalMcpConnectOptions` compile-time-checked as importable from the
 * package's public barrel (`@exaix/mcp`), not just the deep
 * `@exaix/mcp/i_external_mcp_client.ts` path — matches how its sibling types
 * above are already surfaced (Post-Gap Analysis GAP-4).
 */
const minimalConnectOptions = { bearerToken: "token" } satisfies IExternalMcpConnectOptions;

Deno.test("@exaix/mcp barrel - IExternalMcpConnectOptions is importable from the package's public surface", () => {
  assertEquals(minimalConnectOptions.bearerToken, "token");
});
