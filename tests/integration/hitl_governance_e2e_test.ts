/**
 * @module HitlGovernanceE2ETest
 * @path tests/integration/hitl_governance_e2e_test.ts
 * @description End-to-end HITL governance integration tests — verifies the
 * full HitlPolicyEvaluator-to-ToolRegistry-middleware chain.
 * Phase 118 Step 6.
 * @dependencies @exaix-team/hitl, @exaix/tool-runtime, @exaix/testing
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { HitlPolicyEvaluator } from "@exaix-team/hitl";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { HitlRule } from "@exaix/schemas/hitl.ts";

const TOOL_EXECUTED_MARKER = "outside the allowed directories";

function decisionId(): string {
  return crypto.randomUUID();
}

function createDenyInterceptor(): IToolConfirmationInterceptor {
  return {
    requestApproval: (
      _req: ToolConfirmationRequest,
    ): Promise<ToolConfirmationDecision> => {
      return Promise.resolve({
        id: decisionId(),
        approved: false,
        reason: "E2E test denial",
        decidedAt: new Date().toISOString(),
        decidedBy: "system:test",
      });
    },
  };
}

class ApproveTrackingInterceptor implements IToolConfirmationInterceptor {
  requests: ToolConfirmationRequest[] = [];
  requestApproval(req: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    this.requests.push(req);
    return Promise.resolve({
      id: decisionId(),
      approved: true,
      reason: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: "system:test",
    });
  }
}

async function withRegistry(
  evaluator: HitlPolicyEvaluator | undefined,
  interceptor: IToolConfirmationInterceptor | undefined,
  blueprintRules: HitlRule[] | undefined,
  fn: (registry: ToolRegistry) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "hitl-e2e-" });
  const { db, cleanup } = await initTestDbService();
  const config = createMockConfig(tempDir);
  const logger = new EventLogger({ db });

  try {
    const registry = new ToolRegistry({
      config,
      logger,
      hitlPolicyEvaluator: evaluator,
      confirmationInterceptor: interceptor,
      hitlBlueprintRules: blueprintRules,
    });
    await fn(registry);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

describe("[hitl] ToolRegistry path — E2E HITL wiring", () => {
  it("mandatory rule + approve interceptor — tool runs to completion (reaches executor)", async () => {
    const interceptor = new ApproveTrackingInterceptor();
    await withRegistry(
      new HitlPolicyEvaluator([{ tool: "read_file", path_pattern: "**/*", reason: "E2E" }]),
      interceptor,
      undefined,
      async (registry) => {
        const result = await registry.execute("read_file", { path: "/outside/allowed" });
        // Tool should have executed (access denied by path security, not HITL)
        assertEquals(result.success, false);
        assert(
          result.error?.includes(TOOL_EXECUTED_MARKER),
          `Expected tool-executed marker, got: ${result.error}`,
        );
        assertEquals(interceptor.requests.length, 1, "Interceptor should have been called");
        assertEquals(interceptor.requests[0].toolName, "read_file");
        assertEquals(interceptor.requests[0].reason, "E2E");
      },
    );
  });

  it("mandatory rule + deny interceptor — tool denied by HITL (never reaches executor)", async () => {
    await withRegistry(
      new HitlPolicyEvaluator([{ tool: "read_file", path_pattern: "**/*", reason: "E2E" }]),
      createDenyInterceptor(),
      undefined,
      async (registry) => {
        const result = await registry.execute("read_file", { path: "/any/path" });
        assertEquals(result.success, false);
        assert(
          result.error?.includes("denied"),
          `Expected denial message, got: ${result.error}`,
        );
      },
    );
  });

  it("no evaluator => identical to today (no HITL intervention)", async () => {
    await withRegistry(undefined, undefined, undefined, async (registry) => {
      const result = await registry.execute("read_file", { path: "/outside/allowed" });
      assertEquals(result.success, false);
      assert(
        result.error?.includes(TOOL_EXECUTED_MARKER),
        "Tool should have executed when no evaluator present",
      );
    });
  });

  it("blueprint-only rule with no interceptor — proceeds (degrade-to-proceed)", async () => {
    await withRegistry(
      new HitlPolicyEvaluator([]),
      undefined,
      [{ tool: "read_file", path_pattern: "**/*", reason: "Blueprint" }],
      async (registry) => {
        const result = await registry.execute("read_file", { path: "/outside/allowed" });
        assertEquals(result.success, false);
        assert(
          result.error?.includes(TOOL_EXECUTED_MARKER),
          `Blueprint-only rule without interceptor should proceed to executor`,
        );
      },
    );
  });

  it("mandatory rule with no interceptor — fails closed (tool denied)", async () => {
    await withRegistry(
      new HitlPolicyEvaluator([{ tool: "read_file", path_pattern: "**/*", reason: "Catch-all" }]),
      undefined,
      undefined,
      async (registry) => {
        const result = await registry.execute("read_file", { path: "/any" });
        assertEquals(result.success, false);
        assert(
          result.error?.includes("no approver"),
          `Expected fail-closed, got: ${result.error}`,
        );
      },
    );
  });

  it("non-matching tool arg does NOT trigger confirmation", async () => {
    await withRegistry(
      new HitlPolicyEvaluator([{ tool: "read_file", path_pattern: "**/.env*", reason: "E2E" }]),
      createDenyInterceptor(),
      undefined,
      async (registry) => {
        const result = await registry.execute("read_file", { path: "/outside/allowed" });
        assertEquals(result.success, false);
        assert(
          result.error?.includes(TOOL_EXECUTED_MARKER),
          "Non-matching path should not trigger HITL — tool should execute",
        );
      },
    );
  });
});
