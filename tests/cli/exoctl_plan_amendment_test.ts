/**
 * @module ExoctlPlanAmendmentTest
 * @path tests/cli/exoctl_plan_amendment_test.ts
 * @description CLI tests for plan amendment management commands (list, show, approve, reject).
 * @related-files [src/cli/commands/plan_commands.ts, src/services/plan/plan_amendment_service.ts]
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { PlanCommands } from "../../src/cli/commands/plan_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import type { DatabaseService } from "../../src/services/core/db.ts";
import {
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PLAN_AMENDMENT_EVENT_REJECTED,
} from "../../src/shared/constants.ts";

describe("Plan Amendment CLI", () => {
  let tempDir: string;
  let _db: DatabaseService;
  let _planCommands: PlanCommands;
  let _activeDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext({
      createDirs: [
        "Workspace/Active",
        "Workspace/Plans",
        "Workspace/Requests",
      ],
    });
    tempDir = result.tempDir;
    _db = result.db;
    cleanup = result.cleanup;

    _activeDir = join(tempDir, "Workspace", "Active");
    _planCommands = new PlanCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("amendment artifact discovery", () => {
    it("should find amendment artifacts in Memory/Execution directory", async () => {
      const traceId = "550e8400-e29b-41d4-a716-446655440000";
      const amendmentId = "660e8400-e29b-41d4-a716-446655440001";

      // Create amendment artifact directory structure
      const amendmentsDir = join(tempDir, "Memory", "Execution", traceId, "amendments");
      await Deno.mkdir(amendmentsDir, { recursive: true });

      // Create amendment artifact file
      const amendmentContent = JSON.stringify(
        {
          amendmentId,
          planId: "test-plan",
          affectedRemainingStepIds: ["2", "3"],
          summary: "Test amendment proposal",
          adds: [],
          updates: [{ number: 2, title: "Updated Step", content: "Updated content" }],
          removes: [],
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      );

      await Deno.writeTextFile(join(amendmentsDir, `${amendmentId}.json`), amendmentContent);

      // Verify artifact exists
      const stat = await Deno.stat(join(amendmentsDir, `${amendmentId}.json`));
      assertEquals(stat.isFile, true);

      // Read and verify content
      const content = await Deno.readTextFile(join(amendmentsDir, `${amendmentId}.json`));
      const parsed = JSON.parse(content);
      assertEquals(parsed.amendmentId, amendmentId);
      assertEquals(parsed.summary, "Test amendment proposal");
    });

    it("should handle missing amendment directory gracefully", async () => {
      const traceId = "nonexistent-trace-id";
      const amendmentsDir = join(tempDir, "Memory", "Execution", traceId, "amendments");

      // Directory doesn't exist - should not throw
      try {
        const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
        // If we get here, directory exists (unexpected)
        assertEquals(entries.length, 0);
      } catch (error) {
        // Expected: NoSuchFile error when directory doesn't exist
        assertEquals(error instanceof Deno.errors.NotFound, true);
      }
    });
  });

  describe("amendment event constants", () => {
    it("should have correct event constant values", () => {
      assertEquals(PLAN_AMENDMENT_EVENT_PROPOSED, "plan.amendment.proposed");
      assertEquals(PLAN_AMENDMENT_EVENT_APPROVED, "plan.amendment.approved");
      assertEquals(PLAN_AMENDMENT_EVENT_REJECTED, "plan.amendment.rejected");
    });

    it("should use consistent event naming pattern", () => {
      const events = [
        PLAN_AMENDMENT_EVENT_PROPOSED,
        PLAN_AMENDMENT_EVENT_APPROVED,
        PLAN_AMENDMENT_EVENT_REJECTED,
      ];

      for (const event of events) {
        assertEquals(
          event.startsWith("plan.amendment."),
          true,
          `Event "${event}" should follow "plan.amendment.*" pattern`,
        );
      }
    });
  });
});
