/**
 * @module GoldenFixtureCapture
 * @path packages-team/mcp-server/tests/fixtures/golden_fixture_capture.ts
 * @description Drives a live, unmigrated `MCPServer` through `tools/list`, `resources/list`,
 * `prompts/list`, and one representative `tools/call` per registered tool category (READ,
 * WRITE, GIT, META, DOMAIN), producing the Phase 163 pre-migration golden-response fixture
 * that every later migration step asserts byte-for-byte preservation against. Pure
 * characterization-test capture utility — never imported by production code.
 * @architectural-layer MCP (test-support)
 * @dependencies [packages-team/mcp-server/server.ts, packages/mcp/testing/test_setup.ts]
 * @related-files [packages-team/mcp-server/tests/golden_fixture_capture_test.ts]
 * @ungrounded
 */
import { fromFileUrl, join } from "@std/path";
import { createMCPRequest, createToolCallRequest, initMCPTest } from "@exaix/mcp/testing";
import type { MCPServer } from "@exaix-team/mcp-server";
import type { JSONValue } from "@exaix/core";

/** Minimal JSON-RPC 2.0 response shape captured verbatim from `MCPServer.handleRequest`. */
export interface IGoldenJsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: JSONValue;
  error?: { code: number; message: string };
}

/** One representative `tools/call` response per live tool category, keyed by category name. */
export type IGoldenRepresentativeCalls = Record<string, IGoldenJsonRpcResponse>;

export interface IGoldenFixtureCapture {
  toolsList: IGoldenJsonRpcResponse;
  resourcesList: IGoldenJsonRpcResponse;
  promptsList: IGoldenJsonRpcResponse;
  representativeToolCalls: IGoldenRepresentativeCalls;
}

interface IRepresentativeCallSpec {
  category: string;
  toolName: string;
  args: Record<string, JSONValue>;
}

/** READ runs before WRITE in this fixed order so `list_directory`'s capture reflects only
 *  the seeded portal content, not `write_file`'s mutation. */
export const REPRESENTATIVE_TOOL_CALLS: readonly IRepresentativeCallSpec[] = [
  { category: "READ", toolName: "list_directory", args: { portal: "TestPortal" } },
  {
    category: "WRITE",
    toolName: "write_file",
    args: { portal: "TestPortal", path: "golden-fixture-output.txt", content: "golden fixture capture" },
  },
  { category: "GIT", toolName: "git_status", args: { portal: "TestPortal" } },
  {
    category: "META",
    toolName: "run_command",
    args: { portal: "TestPortal", command: "echo", args: ["golden-fixture-check"], agent_role: "golden-fixture" },
  },
  { category: "DOMAIN", toolName: "exaix_list_plans", args: { agent_role: "golden-fixture" } },
];

/** Portal content seeded for a reproducible `resources/list` + representative-call capture. */
export const GOLDEN_FIXTURE_SEED_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Golden Fixture Test Portal\n",
};

/** Pure function of `server` — no I/O beyond the server's own handling. */
export async function captureGoldenFixture(server: MCPServer): Promise<IGoldenFixtureCapture> {
  const toolsList = await server.handleRequest(createMCPRequest("tools/list", {})) as IGoldenJsonRpcResponse;
  const resourcesList = await server.handleRequest(
    createMCPRequest("resources/list", {}),
  ) as IGoldenJsonRpcResponse;
  const promptsList = await server.handleRequest(createMCPRequest("prompts/list", {})) as IGoldenJsonRpcResponse;

  const representativeToolCalls: IGoldenRepresentativeCalls = {};
  for (const { category, toolName, args } of REPRESENTATIVE_TOOL_CALLS) {
    representativeToolCalls[category] = await server.handleRequest(
      createToolCallRequest(toolName, args),
    ) as IGoldenJsonRpcResponse;
  }

  return { toolsList, resourcesList, promptsList, representativeToolCalls };
}

export const GOLDEN_FIXTURE_PATH: string = join(
  fromFileUrl(new URL(".", import.meta.url)),
  "pre_migration_golden_responses.json",
);

if (import.meta.main) {
  const ctx = await initMCPTest({ initGit: true, fileContent: GOLDEN_FIXTURE_SEED_FILES });
  try {
    const capture = await captureGoldenFixture(ctx.server);
    await Deno.writeTextFile(GOLDEN_FIXTURE_PATH, `${JSON.stringify(capture, null, 2)}\n`);
    // deno-lint-ignore no-console
    console.log(`Golden fixture captured to ${GOLDEN_FIXTURE_PATH}`);
  } finally {
    await ctx.cleanup();
  }
}
