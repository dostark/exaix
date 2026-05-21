/**
 * @module ToolValidationFailClosedTest
 * @path tests/security/tool_validation_fail_closed_test.ts
 * @description Security tests for Phase 78 tool result validation. Verifies that
 * rawResult payloads are never forwarded to MCP clients, that fail_closed tools
 * do not retry on validation mismatch, and that validation failure messages are
 * sanitized before being returned to callers.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  type IToolResultValidationFailure,
  type IToolResultValidator,
  validateToolResultEnvelope,
} from "@exaix/schemas/tool_result_validator.ts";
import { Severity, ToolSideEffectScope } from "@exaix/core";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { MCPServer } from "@exaix/mcp/server";
import { ToolRegistry } from "@exaix/tool-runtime";
import { initTestDbService } from "../helpers/db.ts";
import { createMockConfig } from "../helpers/config.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import { createMCPRequest } from "../mcp/helpers/test_setup.ts";

const SECRET_MARKER = "SUPER_SECRET_TOKEN_abc123xyz";

// ============================================================================
// rawResult must not be forwarded to MCP clients
// ============================================================================

Deno.test("MCP boundary validator: rawResult field is not included in client-facing error text", async () => {
  const failure: IToolResultValidationFailure = {
    tool: "run_command",
    stage: "mcp_boundary",
    severity: Severity.ERROR,
    retryAllowed: false,
    sideEffectRisk: ToolSideEffectScope.NONE,
    issues: [{ path: ["stdout"], message: "validation failed", code: "invalid_type" }],
    rawResult: { secret: SECRET_MARKER, stdout: 42, exitCode: "zero" },
  };
  const validator: IToolResultValidator = {
    validateEnvelope: (_toolName, _result) => null,
    validateMCPResponse: (_toolName, _response) => failure,
  };

  const tempDir = await Deno.makeTempDir({ prefix: "mcp-sec-test-" });
  const { db, cleanup: dbCleanup } = await initTestDbService();
  const config = createMockConfig(tempDir);
  const stubConfig = createStubConfig(config);
  const context = {
    config: stubConfig,
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(),
    toolRegistry: new ToolRegistry({ config, db }),
  };
  const server = new MCPServer({
    context,
    transport: McpTransportType.STDIO,
    permissions: new AllowAllPermissionsService(),
    resultValidator: validator,
  });
  await server.start();

  try {
    const request = createMCPRequest("tools/call", {
      name: "list_directory",
      arguments: { portal: "TestPortal", path: "." },
    });
    const response = await server.handleRequest(request);
    const responseStr = JSON.stringify(response);
    assert(
      !responseStr.includes(SECRET_MARKER),
      `Client-facing response must not contain rawResult secret. Response: ${responseStr}`,
    );
  } finally {
    await server.stop();
    await dbCleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// ============================================================================
// validateToolResultEnvelope rawResult capture
// ============================================================================

Deno.test("tool_validation_fail_closed: rawResult is captured in failure object for audit", () => {
  const raw = { success: "maybe", data: { secret: SECRET_MARKER } };
  const failure = validateToolResultEnvelope("run_command", raw);
  assertExists(failure, "Invalid envelope must produce a failure");
  assertExists(failure.rawResult, "rawResult must be captured in the failure for audit logging");
});

Deno.test("tool_validation_fail_closed: failure issues array does not expose rawResult values", () => {
  const raw = { success: "maybe", data: { secret: SECRET_MARKER } };
  const failure = validateToolResultEnvelope("run_command", raw);
  assertExists(failure);
  const issuesStr = JSON.stringify(failure.issues);
  assert(
    !issuesStr.includes(SECRET_MARKER),
    `Failure issues must not embed rawResult values. Issues: ${issuesStr}`,
  );
});

Deno.test("tool_validation_fail_closed: tool name is preserved in failure", () => {
  const failure = validateToolResultEnvelope("run_command", null);
  assertExists(failure);
  assertEquals(failure.tool, "run_command");
});

Deno.test("tool_validation_fail_closed: mutating registry tool does not retry after validation failure", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-fail-closed-" });
  let validationCalls = 0;

  try {
    const config = createMockConfig(tempDir);
    const validator: IToolResultValidator = {
      validateEnvelope: (toolName, rawResult) => {
        validationCalls += 1;
        return {
          tool: toolName,
          stage: "registry_boundary",
          severity: Severity.ERROR,
          retryAllowed: false,
          sideEffectRisk: ToolSideEffectScope.PORTAL,
          issues: [{ path: ["data"], message: "synthetic validation failure", code: "custom" }],
          rawResult: rawResult as IToolResultValidationFailure["rawResult"],
        };
      },
      validateMCPResponse: () => null,
    };

    const registry = new ToolRegistry({ config, resultValidator: validator });
    const result = await registry.execute("write_file", {
      path: "notes.txt",
      content: "hello",
    });

    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(validationCalls, 1, "fail_closed mutating tools must not retry validation or execution");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
