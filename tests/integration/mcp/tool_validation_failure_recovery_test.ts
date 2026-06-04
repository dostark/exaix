/**
 * @module ToolValidationFailureRecoveryTest
 * @path tests/integration/mcp/tool_validation_failure_recovery_test.ts
 * @description Integration tests verifying that tool validation failure logging and
 * remediation outcome events are correctly emitted from the live MCP boundary.
 * (Phase 78 Step 78.4)
 */

import { assertEquals, assertExists } from "@std/assert";
import { Severity, ToolSideEffectScope } from "@exaix/core";
import { TOOL_VALIDATION_EVENT_FAIL_CLOSED, TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS } from "@exaix/tool-runtime";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import { validateMCPToolResponse } from "@exaix/schemas/tool_result_validator.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { MCPServer } from "@exaix/mcp/server";
import { ToolRegistry } from "@exaix/tool-runtime";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import { createMCPRequest } from "@exaix/mcp/testing";

Deno.test("tool_validation_failure_recovery_integration: live MCP fail_closed validation writes event to journal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-validation-fail-closed-" });
  const portalAlias = "TestPortal";
  const portalPath = `${tempDir}/${portalAlias}`;

  try {
    await Deno.mkdir(portalPath, { recursive: true });
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
    const validator: IToolResultValidator = {
      validateEnvelope: () => null,
      validateMCPResponse: (toolName, response) => ({
        tool: toolName,
        stage: "mcp_boundary",
        severity: Severity.ERROR,
        retryAllowed: false,
        sideEffectRisk: ToolSideEffectScope.PORTAL,
        issues: [{ path: ["content"], message: "synthetic validation failure", code: "custom" }],
        rawResult: response as IToolResultValidationFailure["rawResult"],
      }),
    };
    const context = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(),
      toolRegistry: new ToolRegistry({ config }),
    };
    const logger = new EventLogger({ db });
    const server = new MCPServer({
      context,
      transport: McpTransportType.STDIO,
      permissions: new AllowAllPermissionsService(),
      resultValidator: validator,
      logger,
    });
    server.start();

    try {
      const response = await server.handleRequest(createMCPRequest("tools/call", {
        name: "write_file",
        arguments: { portal: portalAlias, path: "note.txt", content: "hello", identity_id: "agent" },
      }));
      assertExists(response.result);
      await db.waitForFlush();

      const activities = await db.getRecentActivity(50);
      const event = activities.find((activity) => activity.action_type === TOOL_VALIDATION_EVENT_FAIL_CLOSED);
      assertExists(event, "live MCP validation failure should emit fail_closed event");
      assertEquals(event.target, "write_file");
    } finally {
      server.stop();
      await dbCleanup();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("tool_validation_failure_recovery_integration: live MCP recovery writes normalization_success event to journal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-validation-recovery-" });
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
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(),
      toolRegistry: new ToolRegistry({ config }),
    };
    const logger = new EventLogger({ db });
    const server = new MCPServer({
      context,
      transport: McpTransportType.STDIO,
      permissions: new AllowAllPermissionsService(),
      resultValidator: validator,
      logger,
    });
    server.start();

    try {
      const response = await server.handleRequest(createMCPRequest("tools/call", {
        name: "list_directory",
        arguments: { portal: portalAlias, path: ".", identity_id: "agent" },
      }));
      assertExists(response.result);
      await db.waitForFlush();

      const activities = await db.getRecentActivity(50);
      const event = activities.find((activity) => activity.action_type === TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS);
      assertExists(event, "live MCP recovery should emit normalization_success event");
      const payload = JSON.parse(event.payload);
      assertEquals(payload.metricName, TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS);
    } finally {
      server.stop();
      await dbCleanup();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
