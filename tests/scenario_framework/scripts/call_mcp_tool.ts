#!/usr/bin/env -S deno run --allow-all
/**
 * @module CallMcpTool
 * @path tests/scenario_framework/scripts/call_mcp_tool.ts
 * @architectural-layer Test
 * @description Scenario-facing wrapper that invokes one or more real MCP tools over the
 *   stdio transport and prints the server's responses. It exists so a scenario step reads
 *   as `call_mcp_tool.ts read_file '{"portal":"tools",...}'` instead of fifteen lines of
 *   driver-and-server plumbing repeated per scenario. The `initialize` handshake is
 *   implicit; each (tool, args-json) pair becomes one `tools/call`.
 * @dependencies [tests/scenario_framework/scripts/mcp_stdio_driver.ts]
 * @related-files [apps/mcp-server/main.ts, tests/scenario_framework/scripts/setup_tools_portal.ts]
 */

import { dirname, fromFileUrl, resolve } from "@std/path";
import { type IJsonRpcParams, type IJsonRpcRequest, sendJsonRpcRequests, spawnProcess } from "./mcp_stdio_driver.ts";

const SCRIPTS_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..", "..", "..");
const SERVER_ENTRY = resolve(REPO_ROOT, "apps", "mcp-server", "main.ts");
const DENO_CONFIG = resolve(REPO_ROOT, "deno.json");
const DEFAULT_TIMEOUT_MS = 30000;

interface IToolCall {
  name: string;
  args: IJsonRpcParams;
}

export function parseToolCalls(args: string[]): { calls: IToolCall[]; timeoutMs: number } {
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let rest = args;

  const timeoutIndex = rest.indexOf("--timeout-ms");
  if (timeoutIndex >= 0 && timeoutIndex + 1 < rest.length) {
    timeoutMs = parseInt(rest[timeoutIndex + 1], 10);
    rest = rest.filter((_, i) => i !== timeoutIndex && i !== timeoutIndex + 1);
  }

  if (rest.length === 0 || rest.length % 2 !== 0) {
    throw new Error(
      "Usage: call_mcp_tool.ts [--timeout-ms <ms>] <tool-name> <args-json> [<tool-name> <args-json>...]",
    );
  }

  const calls: IToolCall[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    try {
      calls.push({ name, args: JSON.parse(rest[i + 1]) as IJsonRpcParams });
    } catch {
      throw new Error(`Failed to parse arguments for tool "${name}": ${rest[i + 1]}`);
    }
  }
  return { calls, timeoutMs };
}

if (import.meta.main) {
  const { calls, timeoutMs } = parseToolCalls(Deno.args);

  const requests: IJsonRpcRequest[] = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    ...calls.map((call, index) => ({
      jsonrpc: "2.0" as const,
      id: index + 2,
      method: "tools/call",
      params: { name: call.name, arguments: call.args },
    })),
  ];

  const process = await spawnProcess([
    "deno",
    "run",
    "-A",
    "--config",
    DENO_CONFIG,
    SERVER_ENTRY,
  ]);

  const { responses, error } = await sendJsonRpcRequests(process, requests, timeoutMs);

  try {
    process.kill("SIGTERM");
  } catch { /* already exited */ }
  await process.status;

  // `initialize` is plumbing, not a result the scenario asserts on — drop it so
  // `command-output-contains` cannot accidentally match the handshake.
  const toolResponses = responses.slice(1);
  const anyToolError = toolResponses.some((r) =>
    r.error !== undefined ||
    (r.result as { isError?: boolean } | undefined)?.isError === true
  );

  console.log(JSON.stringify({ success: !error && !anyToolError, responses: toolResponses }, null, 2));

  // Exit non-zero only when the transport itself failed. A tool that legitimately refuses
  // (traversal, permission, missing file) is a RESULT the scenario asserts on, not a
  // step failure — otherwise every negative case would abort its scenario.
  Deno.exit(error ? 1 : 0);
}
