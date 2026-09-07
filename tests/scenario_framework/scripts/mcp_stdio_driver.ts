#!/usr/bin/env -S deno run --allow-all
/**
 * @module McpStdioDriver
 * @path tests/scenario_framework/scripts/mcp_stdio_driver.ts
 * @architectural-layer Test
 * @description Minimal JSON-RPC 2.0 stdio MCP client for scenario shell steps.
 *   Spawns the MCP server as a subprocess, sends JSON-RPC requests, collects
 *   responses, and emits a composite JSON result document for scenario assertion.
 * @dependencies []
 * @related-files [exaix-team/apps/mcp-server/main.ts, tests/scenario_framework/scenarios/mcp_server/]
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface IJsonRpcParams {
  [key: string]: JsonValue;
}

export interface IJsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: IJsonRpcParams;
}

interface JsonRpcResult {
  echo?: boolean;
  method?: string;
  params?: IJsonRpcParams;
  tools?: JsonValue[];
  protocolVersion?: string;
  serverInfo?: { [key: string]: string };
  capabilities?: { [key: string]: JsonValue };
}

interface JsonRpcErrorData {
  code: number;
  message: string;
  data?: JsonValue;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: JsonRpcResult;
  error?: JsonRpcErrorData;
}

const DEFAULT_TIMEOUT_MS = 15000;

export function parseDriverArgs(args: string[]): {
  command: string[];
  timeoutMs: number;
  requests: IJsonRpcRequest[];
} {
  const timeoutIndex = args.indexOf("--timeout-ms");
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let rest = args;

  if (timeoutIndex >= 0 && timeoutIndex + 1 < args.length) {
    timeoutMs = parseInt(args[timeoutIndex + 1], 10);
    rest = args.filter((_, i) => i !== timeoutIndex && i !== timeoutIndex + 1);
  }

  // Both invocation forms are accepted: the one the usage string advertises, with a
  // leading `--` separating the driver's own flags from the server command, and the bare
  // form without it. Only the separator BEFORE the requests is load-bearing.
  if (rest[0] === "--") {
    rest = rest.slice(1);
  }

  const cmdEnd = rest.indexOf("--");
  if (cmdEnd <= 0) {
    throw new Error(
      "Usage: mcp_stdio_driver.ts [--timeout-ms <ms>] [--] <server-command...> -- <json-rpc-request-json>...",
    );
  }

  const command = rest.slice(0, cmdEnd);
  const requestJsons = rest.slice(cmdEnd + 1);
  const requests: IJsonRpcRequest[] = requestJsons.map((json, i) => {
    try {
      return JSON.parse(json) as IJsonRpcRequest;
    } catch {
      throw new Error(`Failed to parse request ${i}: ${json}`);
    }
  });

  return { command, timeoutMs, requests };
}

// deno-lint-ignore require-await
export async function spawnProcess(
  command: string[],
): Promise<Deno.ChildProcess> {
  const cmd = new Deno.Command(command[0], {
    args: command.slice(1),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  return cmd.spawn();
}

export async function sendJsonRpcRequests(
  process: Deno.ChildProcess,
  requests: IJsonRpcRequest[],
  timeoutMs: number,
): Promise<{ responses: JsonRpcResponse[]; error?: string }> {
  const responses: JsonRpcResponse[] = [];
  const writer = process.stdin.getWriter();

  try {
    for (const req of requests) {
      const line = JSON.stringify(req) + "\n";
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(line));

      const response = await readJsonRpcResponse(process, req.id, timeoutMs);
      responses.push(response);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { responses, error: message };
  } finally {
    // A server that died before answering leaves stdin already closed; closing the writer
    // then rejects with "Writable stream is closed or errored". Swallow it so the caller
    // gets the real diagnostic (the server's own error) instead of a stray TypeError.
    try {
      await writer.close();
    } catch { /* server stdin already gone — the real error is reported above */ }
  }

  return { responses };
}

async function readJsonRpcResponse(
  process: Deno.ChildProcess,
  requestId: number,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const startTime = Date.now();

  try {
    while (Date.now() - startTime < timeoutMs) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        try {
          return JSON.parse(line) as JsonRpcResponse;
        } catch {
          return {
            jsonrpc: "2.0",
            id: requestId,
            error: { code: -32700, message: `Parse error: ${line}` },
          };
        }
      }
    }
    return {
      jsonrpc: "2.0",
      id: requestId,
      error: { code: -32000, message: "Response timeout" },
    };
  } finally {
    reader.releaseLock();
  }
}

async function main(): Promise<void> {
  let process: Deno.ChildProcess | undefined;

  try {
    const { command, timeoutMs, requests } = parseDriverArgs(Deno.args);
    process = await spawnProcess(command);
    const { responses, error } = await sendJsonRpcRequests(process, requests, timeoutMs);

    // Kill the server process
    try {
      process.kill("SIGTERM");
    } catch { /* ignore */ }
    const status = await process.status;

    const output = {
      success: responses.every((r) => !r.error),
      responses,
      error,
      exitCode: status.code,
    };

    console.log(JSON.stringify(output, null, 2));
    Deno.exit(output.success ? 0 : 1);
  } catch (error) {
    if (process) {
      try {
        process.kill("SIGTERM");
      } catch { /* ignore */ }
    }
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify(
      {
        success: false,
        responses: [],
        error: message,
        exitCode: 1,
      },
      null,
      2,
    ));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
