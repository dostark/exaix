/**
 * @module ToolCommandsTest
 * @path apps/exactl/tests/tool_commands_test.ts
 * @description Focused tests for the Phase 79 tool confirmation CLI commands.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { ToolCommands } from "../src/commands/tool_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { captureConsoleOutput } from "./helpers/console_utils.ts";
import { createStubGit } from "../../../tests/helpers/test_helpers.ts";

function createRequest(id: string): ToolConfirmationRequest {
  return {
    id,
    toolName: "exaix_create_request",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "trace-1",
    requestedAt: "2026-05-18T10:00:00.000Z",
    expiresAt: "2099-05-18T10:02:00.000Z",
  };
}

Deno.test("ToolCommands: pending lists queued tool confirmations", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    const request = createRequest(crypto.randomUUID());
    await db.insertToolConfirmationRequest(request);

    const commands = new ToolCommands(context);
    const output = await captureConsoleOutput(async () => {
      await commands.pending();
    });

    assertStringIncludes(output, request.id);
    assertStringIncludes(output, request.toolName);
    assertStringIncludes(output, request.stepId);
  } finally {
    await cleanup();
  }
});

Deno.test("ToolCommands: confirm writes approval with CLI decidedBy identity", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    context.git = createStubGit({
      getCurrentBranch: () => Promise.resolve("main"),
    });
    const request = createRequest(crypto.randomUUID());
    await db.insertToolConfirmationRequest(request);

    const commands = new ToolCommands(context);
    const output = await captureConsoleOutput(async () => {
      await commands.confirm(request.id);
    });

    const decision = await db.getToolConfirmationDecision(request.id);
    assertEquals(decision?.approved, true);
    assertEquals(decision?.decidedBy, "cli-user");
    assertStringIncludes(output, request.id);
    assertStringIncludes(output, "approved");
  } finally {
    await cleanup();
  }
});

Deno.test("ToolCommands: deny writes denial reason with CLI decidedBy identity", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    context.git = createStubGit({
      getCurrentBranch: () => Promise.resolve("main"),
    });
    const request = createRequest(crypto.randomUUID());
    await db.insertToolConfirmationRequest(request);

    const commands = new ToolCommands(context);
    const output = await captureConsoleOutput(async () => {
      await commands.deny(request.id, "User declined");
    });

    const decision = await db.getToolConfirmationDecision(request.id);
    assertEquals(decision?.approved, false);
    assertEquals(decision?.reason, "User declined");
    assertEquals(decision?.decidedBy, "cli-user");
    assertStringIncludes(output, request.id);
    assertStringIncludes(output, "denied");
  } finally {
    await cleanup();
  }
});

Deno.test("ToolCommands: confirm rejects invalid confirmation UUID", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const commands = new ToolCommands(context);
    await assertRejects(() => commands.confirm("not-a-uuid"), Error, "valid UUID");
  } finally {
    await cleanup();
  }
});
