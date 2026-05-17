/**
 * @module HandlerRegistryResultValidationTest
 * @path tests/mcp/handler_registry_result_validation_test.ts
 * @description Tests that MCPServer invokes an injected IToolResultValidator when
 * processing tool call results, and that the resultValidator optional field in
 * MCPServerOptions defaults to no-op pass-through for backward compatibility.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { type JSONValue, Severity, ToolSideEffectScope } from "@exaix/core";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import {
  type IToolResultValidationFailure,
  type IToolResultValidator,
  validateMCPToolResponse,
} from "@exaix/schemas/tool_result_validator.ts";
import { MCPServer } from "../../src/mcp/server.ts";
import { ToolRegistry } from "../../src/services/tool/tool_registry.ts";
import { initTestDbService } from "../helpers/db.ts";
import { createMockConfig } from "../helpers/config.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import { createMCPRequest } from "./helpers/test_setup.ts";

async function makeServerWithValidator(
  validator: IToolResultValidator | undefined,
): Promise<{ server: MCPServer; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-validator-test-" });
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
  const cleanup = async () => {
    await server.stop();
    await dbCleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  };
  return { server, cleanup };
}

// ============================================================================
// Backward compatibility: no resultValidator leaves behavior unchanged
// ============================================================================

Deno.test("handler_registry_result_validation: MCPServer starts without resultValidator (backward compat)", async () => {
  const { server, cleanup } = await makeServerWithValidator(undefined);
  try {
    assertEquals(server.isRunning(), true);
  } finally {
    await cleanup();
  }
});

Deno.test("handler_registry_result_validation: read-only MCP tool recovers through remediation policy path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-remediation-readonly-" });
  const portalAlias = "TestPortal";
  const portalPath = `${tempDir}/${portalAlias}`;
  let validationCalls = 0;

  try {
    await Deno.mkdir(portalPath, { recursive: true });
    await Deno.writeTextFile(`${portalPath}/file.txt`, "content");

    const { db, cleanup: dbCleanup } = await initTestDbService();
    const config = createMockConfig(tempDir, {
      portals: [{
        alias: portalAlias,
        target_path: portalPath,
        default_branch: "main",
        identities_allowed: ["*"],
        operations: [],
      }],
    });
    const stubConfig = createStubConfig(config);
    const validator: IToolResultValidator = {
      validateEnvelope: () => null,
      validateMCPResponse: (toolName, response) => {
        validationCalls += 1;
        if (validationCalls === 1) {
          return {
            tool: toolName,
            stage: "mcp_boundary",
            severity: Severity.ERROR,
            retryAllowed: true,
            sideEffectRisk: ToolSideEffectScope.NONE,
            issues: [{ path: ["content"], message: "synthetic validation failure", code: "custom" }],
            rawResult: response as IToolResultValidationFailure["rawResult"],
          };
        }
        return validateMCPToolResponse(toolName, response);
      },
    };
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
        arguments: { portal: portalAlias, path: ".", identity_id: "test-agent" },
      });
      const response = await server.handleRequest(request);
      const result = response.result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      assertExists(result, "Response must contain a result after remediation");
      assertEquals(result.isError, undefined);
      assert(validationCalls >= 2, "read-only remediation should revalidate the MCP response");
    } finally {
      await server.stop();
      await dbCleanup();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// ============================================================================
// resultValidator is called when tools/call is handled
// ============================================================================

Deno.test("handler_registry_result_validation: injected validator is called after tool execution", async () => {
  const calls: Array<{ toolName: string; response: JSONValue }> = [];
  const validator: IToolResultValidator = {
    validateEnvelope: (_toolName, _result) => null,
    validateMCPResponse: (toolName, response) => {
      calls.push({ toolName, response });
      return null;
    },
  };

  const { server, cleanup } = await makeServerWithValidator(validator);
  try {
    const request = createMCPRequest("tools/call", {
      name: "list_directory",
      arguments: { portal: "NonExistentPortal", path: "." },
    });
    await server.handleRequest(request);
    // The tool may error (no portal), but the validator should have been invoked
    assert(calls.length > 0, "resultValidator.validateMCPResponse must be called after tool execution");
  } finally {
    await cleanup();
  }
});

Deno.test("handler_registry_result_validation: validator failure causes error response", async () => {
  const failure: IToolResultValidationFailure = {
    tool: "list_directory",
    stage: "mcp_boundary",
    severity: Severity.ERROR,
    retryAllowed: false,
    sideEffectRisk: ToolSideEffectScope.NONE,
    issues: [{ path: [], message: "synthetic validation failure", code: "custom" }],
  };
  const validator: IToolResultValidator = {
    validateEnvelope: (_toolName, _result) => null,
    validateMCPResponse: (_toolName, _response) => failure,
  };

  const { server, cleanup } = await makeServerWithValidator(validator);
  try {
    const request = createMCPRequest("tools/call", {
      name: "list_directory",
      arguments: { portal: "NonExistentPortal", path: "." },
    });
    const response = await server.handleRequest(request);
    // The validator returning a failure must surface as isError:true in the result
    assertExists(response.result ?? response.error, "Response must have result or error");
    const result = response.result as
      | { isError?: boolean; content?: Array<{ type: string; text?: string }> }
      | undefined;
    if (result) {
      assertEquals(result.isError, true, "Validator failure must produce isError:true result");
    }
  } finally {
    await cleanup();
  }
});
