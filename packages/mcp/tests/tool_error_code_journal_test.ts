/**
 * @module ToolErrorCodeJournalTest
 * @path packages/mcp/tests/tool_error_code_journal_test.ts
 * @description Every MCP handler classifies its failures into a `ToolErrorCode` before calling
 *   `formatToolError` — `read_file_tool.ts:69` picks NOT_FOUND vs EXECUTION_FAILED, `move_file_tool`
 *   and `patch_file_tool` each pick between three. That classification was then thrown away: the
 *   base-class parameter was named `_code` and never read, so the code reached neither the response
 *   nor the activity journal. Twenty-odd producers, zero consumers.
 *
 *   The only test that mentioned the taxonomy asserted `ToolErrorCode.NOT_FOUND === "NOT_FOUND"` —
 *   an enum restated against its own member names, which passes whether or not any handler ever
 *   emits a code, and which omitted COMMAND_BLOCKED while claiming to check that "all expected
 *   error codes are defined". These tests assert the code is observable instead.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, exaix-team/packages/mcp-server/handlers/read_file_tool.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { ToolErrorCode } from "@exaix/core";
import type { JSONValue, LogMetadata } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { ToolHandler } from "@exaix/mcp/server";
import { castAny, createStubContext } from "@exaix/testing";

interface ILoggedCall {
  message: string;
  portal: string;
  metadata: LogMetadata;
}

/** Surfaces the two protected formatters, so base-class behaviour is exercised directly
 *  rather than through one arbitrary concrete tool. */
class ProbeTool extends ToolHandler {
  execute(): Promise<MCPToolResponse> {
    return Promise.resolve({ content: [] });
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return { name: "probe", description: "probe", inputSchema: {} };
  }

  failWith(code: ToolErrorCode, message: string): MCPToolResponse {
    return this.formatToolError("probe", "TestPortal", "test-agent", code, message, { path: "x.ts" });
  }

  succeed(): MCPToolResponse {
    return this.formatSuccess("probe", "TestPortal", "test-agent", [{ type: "text", text: "ok" }], {
      path: "x.ts",
    });
  }
}

function createProbe(): { probe: ProbeTool; calls: ILoggedCall[] } {
  const calls: ILoggedCall[] = [];
  const logger = castAny<IEventLogger>({
    info: (message: string, portal: string, metadata: LogMetadata) => {
      calls.push({ message, portal, metadata });
      return Promise.resolve();
    },
  });
  return { probe: new ProbeTool(createStubContext(), undefined, logger), calls };
}

Deno.test("[tool-error-code] the classified code reaches the activity journal", () => {
  const { probe, calls } = createProbe();

  probe.failWith(ToolErrorCode.NOT_FOUND, "File not found: ghost.ts");

  assertEquals(calls.length, 1);
  assertEquals(calls[0].metadata.errorCode, ToolErrorCode.NOT_FOUND);
});

Deno.test("[tool-error-code] a different classification is journalled differently", () => {
  // The point of the taxonomy is that NOT_FOUND and PERMISSION_DENIED are distinguishable
  // downstream. A hardcoded constant would satisfy the previous test but not this one.
  const { probe, calls } = createProbe();

  probe.failWith(ToolErrorCode.NOT_FOUND, "missing");
  probe.failWith(ToolErrorCode.PERMISSION_DENIED, "denied");
  probe.failWith(ToolErrorCode.COMMAND_BLOCKED, "blocked");

  assertEquals(
    calls.map((c) => c.metadata.errorCode),
    [ToolErrorCode.NOT_FOUND, ToolErrorCode.PERMISSION_DENIED, ToolErrorCode.COMMAND_BLOCKED],
  );
});

Deno.test("[tool-error-code] the existing failure metadata is preserved alongside", () => {
  const { probe, calls } = createProbe();

  probe.failWith(ToolErrorCode.EXECUTION_FAILED, "boom");

  assertEquals(calls[0].metadata.success, false);
  assertEquals(calls[0].metadata.error, "boom");
  assertEquals(calls[0].metadata.path, "x.ts");
});

Deno.test("[tool-error-code] a success carries no error code", () => {
  const { probe, calls } = createProbe();

  probe.succeed();

  assertEquals(calls[0].metadata.success, true);
  assert(
    !("errorCode" in calls[0].metadata),
    "a successful call must not journal an errorCode field",
  );
});

Deno.test("[tool-error-code] the error response itself is still the plain message", () => {
  // The code is a journal/diagnostic concern; the agent-facing text must not gain a prefix,
  // because scenario assertions and handler tests match on the raw message.
  const { probe } = createProbe();

  const response = probe.failWith(ToolErrorCode.NOT_FOUND, "File not found: ghost.ts");

  assertEquals(response.isError, true);
  assertEquals(response.content[0], { type: "text", text: "File not found: ghost.ts" });
});
