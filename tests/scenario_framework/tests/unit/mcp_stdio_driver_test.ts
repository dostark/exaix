/**
 * @module McpStdioDriverTest
 * @path tests/scenario_framework/tests/unit/mcp_stdio_driver_test.ts
 * @description Tests for the MCP stdio driver. Verifies JSON-RPC framing,
 *   request/response correlation, and malformed handling against a scripted
 *   echo server via direct function calls.
 */
import { assert, assertEquals } from "@std/assert";
import { parseDriverArgs, sendJsonRpcRequests, spawnProcess } from "../../scripts/mcp_stdio_driver.ts";

/**
 * Echo server that keeps reading until stdin closes.
 *
 * It used to `break` after the FIRST stdin chunk. `sendJsonRpcRequests` writes request N+1 only
 * after reading response N, so a second request always arrives in a second chunk — by which point
 * this server had exited and the write hit a closed pipe. Whether that surfaced as
 * "Broken pipe (os error 32)" or was silently absorbed by the pipe buffer depended on how fast the
 * subprocess got torn down, so the multi-request test passed in isolation and failed under the
 * parallel suite's load.
 */
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

Deno.test("parseDriverArgs — accepts the documented leading `--` before the server command", () => {
  // The usage string advertises `[--timeout-ms <ms>] -- <server-command...> -- <requests...>`.
  // Both that form and the bare `<server-command...> -- <requests...>` form must parse, so a
  // scenario author following the driver's own help text is not silently rejected.
  const { command, requests } = parseDriverArgs([
    "--timeout-ms",
    "5000",
    "--",
    "deno",
    "run",
    "server.ts",
    "--",
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
  ]);

  assertEquals(command, ["deno", "run", "server.ts"]);
  assertEquals(requests.length, 1);
});

Deno.test("sendJsonRpcRequests — a server that exits early reports the server error, not a stream TypeError", async () => {
  // A server that dies before answering leaves stdin closed; closing the writer in the
  // `finally` block then throws "Writable stream is closed or errored", which used to
  // escape as an uncaught TypeError and replace the actual diagnostic.
  const process = await spawnProcess([
    "deno",
    "eval",
    "console.error('server boom'); Deno.exit(3);",
  ]);

  const { responses, error } = await sendJsonRpcRequests(process, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  ], 2000);

  try {
    process.kill("SIGTERM");
  } catch { /* ignore */ }
  await process.status;

  // The previous assertions here were `Array.isArray(responses) === true` — always true for a
  // declared array — and a disjunction satisfied by either branch, which together amounted to
  // "something came back". What the fix actually guarantees is that the caller is left holding
  // the server's diagnosis rather than the swallowed stream error.
  assertEquals(responses.length, 1);
  assertEquals(responses[0].id, 1);
  assertEquals(responses[0].result, undefined, "a dead server cannot have produced a result");
  const failure = responses[0].error?.message ?? error ?? "";
  assert(failure.length > 0, "a dead server must produce a diagnosable failure");
  assert(
    !failure.includes("Writable stream is closed"),
    `the stream teardown error must not replace the real diagnostic; got: ${failure}`,
  );
});

Deno.test("sendJsonRpcRequests — a non-JSON line from the server becomes a -32700 parse error", async () => {
  // This case previously sent a well-formed request to the echo server and asserted it was
  // echoed back — the comment even conceded "the echo server echoes it back successfully". It
  // was named for the parse-error path while exercising the success path, so the driver's own
  // malformed-response branch (mcp_stdio_driver.ts:158-164) had no coverage at all.
  const process = await spawnProcess([
    "deno",
    "eval",
    "for await (const _ of Deno.stdin.readable) { console.log('this is not json'); break; }",
  ]);

  const { responses } = await sendJsonRpcRequests(process, [
    { jsonrpc: "2.0", id: 99, method: "initialize", params: {} },
  ], 5000);

  try {
    process.kill("SIGTERM");
  } catch { /* ignore */ }
  await process.status;

  assertEquals(responses.length, 1);
  assertEquals(responses[0].id, 99, "the parse error must be correlated to the request id");
  assertEquals(responses[0].error?.code, -32700);
  assert(
    responses[0].error?.message.includes("this is not json"),
    `the offending line must be quoted back for diagnosis; got: ${responses[0].error?.message}`,
  );
});
