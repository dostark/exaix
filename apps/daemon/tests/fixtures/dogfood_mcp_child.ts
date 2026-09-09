#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodMcpChildFixture
 * @path apps/daemon/tests/fixtures/dogfood_mcp_child.ts
 * @description A real, deterministic child process standing in for a native session tool
 * (opencode) in dogfood_context_child_query_test.ts. Discovers the dogfood context MCP
 * connection exactly the way a real opencode launch would (OPENCODE_CONFIG env var
 * pointing at a JSON file with mcp.exaix_context.url, EXAIX_CONTEXT_BEARER env var for
 * the credential), connects with the real ExternalMcpClient SDK wrapper, calls
 * search_memory for a query the initial composed prompt never asked about, and writes
 * the raw tool result to `dogfood_mcp_child_result.json` in its own cwd — never stdout,
 * so the test doesn't have to fight either delegate stdout parser's expected format.
 * Never imported by production code — spawned only by the integration test.
 * @architectural-layer Tests
 * @related-files [apps/daemon/tests/dogfood_context_child_query_test.ts, packages/mcp/src/external_mcp_client.ts]
 */

import { ExternalMcpClient } from "@exaix/mcp/external_mcp_client.ts";
import type { IExternalMcpCallResult } from "@exaix/mcp/i_external_mcp_client.ts";

interface IChildResult {
  ok: boolean;
  error?: string;
  toolNames?: string[];
  searchMemoryResult?: IExternalMcpCallResult["content"];
}

// Literal, not ToolName.SEARCH_MEMORY — importing @exaix/core's full barrel here pulls in
// an FFI-gated SQLite binding this fixture has no reason to load.
const SEARCH_MEMORY_TOOL = "search_memory";
const CHILD_QUERY = Deno.env.get("DOGFOOD_CHILD_QUERY") ?? "zephyr-seeded-fact";
const RESULT_FILE = "dogfood_mcp_child_result.json";

async function main(): Promise<void> {
  const configPath = Deno.env.get("OPENCODE_CONFIG");
  const bearerToken = Deno.env.get("EXAIX_CONTEXT_BEARER");
  if (!configPath || !bearerToken) {
    await writeResult({ ok: false, error: "OPENCODE_CONFIG or EXAIX_CONTEXT_BEARER env var is missing" });
    return;
  }

  let endpoint: string;
  try {
    const config = JSON.parse(await Deno.readTextFile(configPath));
    endpoint = config.mcp.exaix_context.url;
  } catch (error) {
    await writeResult({ ok: false, error: `failed to read/parse OPENCODE_CONFIG: ${String(error)}` });
    return;
  }

  const client = new ExternalMcpClient();
  try {
    await client.connect(new URL(endpoint), { bearerToken });
    const tools = await client.listTools();
    const result = await client.callTool(SEARCH_MEMORY_TOOL, { query: CHILD_QUERY });
    await writeResult({
      ok: true,
      toolNames: tools.map((t) => t.name).toSorted(),
      searchMemoryResult: result.content,
    });
  } catch (error) {
    await writeResult({ ok: false, error: String(error) });
  } finally {
    await client.close();
  }
}

async function writeResult(payload: IChildResult): Promise<void> {
  await Deno.writeTextFile(RESULT_FILE, JSON.stringify(payload));
}

await main();
