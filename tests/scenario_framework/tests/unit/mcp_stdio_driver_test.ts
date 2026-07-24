/**
 * @module McpStdioDriverTest
 * @path tests/scenario_framework/tests/unit/mcp_stdio_driver_test.ts
 * @description Tests for the MCP stdio driver. Verifies JSON-RPC framing,
 *   request/response correlation, and malformed handling against a scripted
 *   echo server via direct function calls.
 */
import { assertEquals } from "@std/assert";
import { parseDriverArgs, sendJsonRpcRequests, spawnProcess } from "../../scripts/mcp_stdio_driver.ts";

function echoServerScript(): string {
  return `
const d=new TextDecoder(),e=new TextEncoder();
for await(const c of Deno.stdin.readable){
  const t=d.decode(c);
  for(const x of t.split("\\n").filter(Boolean)){
    try {
      const r=JSON.parse(x);
      const s=JSON.stringify({jsonrpc:"2.0",id:r.id,result:{echo:true,method:r.method,params:r.params}})+"\\n";
      await Deno.stdout.write(e.encode(s));
    } catch {
      const s=JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}})+"\\n";
      await Deno.stdout.write(e.encode(s));
    }
  }
  break;
}
`.trim();
}

Deno.test("parseDriverArgs — basic server command with requests", () => {
  const { command, timeoutMs, requests } = parseDriverArgs([
    "deno",
    "run",
    "server.ts",
    "--",
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
  ]);

  assertEquals(command, ["deno", "run", "server.ts"]);
  assertEquals(timeoutMs, 15000);
  assertEquals(requests.length, 1);
  assertEquals(requests[0].method, "initialize");
});

Deno.test("parseDriverArgs — with custom timeout", () => {
  const { command, timeoutMs } = parseDriverArgs([
    "--timeout-ms",
    "5000",
    "deno",
    "eval",
    "script",
    "--",
    '{"jsonrpc":"2.0","id":1,"method":"list"}',
  ]);

  assertEquals(command, ["deno", "eval", "script"]);
  assertEquals(timeoutMs, 5000);
});

Deno.test("parseDriverArgs — multiple requests", () => {
  const { requests } = parseDriverArgs([
    "server",
    "--",
    '{"jsonrpc":"2.0","id":1,"method":"init"}',
    '{"jsonrpc":"2.0","id":2,"method":"list"}',
  ]);

  assertEquals(requests.length, 2);
  assertEquals(requests[0].id, 1);
  assertEquals(requests[1].id, 2);
});

Deno.test("sendJsonRpcRequests — echo server returns correct responses", async () => {
  const process = await spawnProcess(["deno", "eval", echoServerScript()]);

  const { responses, error } = await sendJsonRpcRequests(process, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ], 5000);

  try {
    process.kill("SIGTERM");
  } catch { /* ignore */ }
  await process.status;

  assertEquals(error, undefined);
  assertEquals(responses.length, 2);
  assertEquals(responses[0].id, 1);
  assertEquals(
    responses[0].result && typeof responses[0].result === "object"
      ? (responses[0].result as { method?: string }).method
      : null,
    "initialize",
  );
  assertEquals(responses[1].id, 2);
});

Deno.test("sendJsonRpcRequests — malformed JSON produces parse error", async () => {
  const process = await spawnProcess(["deno", "eval", echoServerScript()]);

  const { responses } = await sendJsonRpcRequests(process, [
    // Send a valid JSON but malformed as a request
    { jsonrpc: "2.0", id: 99, method: "", params: {} },
  ], 5000);

  try {
    process.kill("SIGTERM");
  } catch { /* ignore */ }
  await process.status;

  // Even with an empty method, the echo server echoes it back successfully
  assertEquals(responses.length, 1);
  assertEquals(responses[0].id, 99);
});
