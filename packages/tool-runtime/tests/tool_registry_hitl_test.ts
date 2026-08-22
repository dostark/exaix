/**
 * @module ToolRegistryHitlTest
 * @path packages/tool-runtime/tests/tool_registry_hitl_test.ts
 * @description Tests for the Phase 118 HITL confirmation stage in the ToolRegistry
 * pipeline: mandatory/blueprint rule evaluation, confirmation interception,
 * Solo no-op regression, and fail-closed security.
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "../mod.ts";
import { EventLogger } from "@exaix/core/logger";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type {
  HitlRuleSource,
  IHitlPolicyEvaluator,
  IToolConfirmationInterceptor,
  LogMetadata,
} from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";

class MockHitlPolicyEvaluator implements IHitlPolicyEvaluator {
  #match: { rule: HitlRule; source: HitlRuleSource } | null;

  constructor(match: { rule: HitlRule; source: HitlRuleSource } | null) {
    this.#match = match;
  }

  evaluate(
    _blueprintRules: HitlRule[],
    _toolName: string,
    _toolArgs: LogMetadata,
  ): { rule: HitlRule; source: HitlRuleSource } | null {
    return this.#match;
  }
}

class MockConfirmationInterceptor implements IToolConfirmationInterceptor {
  #approved: boolean;
  requests: ToolConfirmationRequest[] = [];

  constructor(approved: boolean) {
    this.#approved = approved;
  }

  requestApproval(
    request: ToolConfirmationRequest,
  ): Promise<ToolConfirmationDecision> {
    this.requests.push(request);
    return Promise.resolve({
      id: crypto.randomUUID(),
      approved: this.#approved,
      decidedAt: new Date().toISOString(),
    });
  }
}

async function withRegistry(
  evaluator: IHitlPolicyEvaluator | undefined,
  interceptor: IToolConfirmationInterceptor | undefined,
  blueprintRules: HitlRule[] | undefined,
  fn: (registry: ToolRegistry) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "hitl-registry-" });
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
    await Deno.remove(tempDir, { recursive: true });
  }
}

const TOOL_EXECUTED_MARKER = "outside the allowed directories";

Deno.test("hitl: no evaluator injected => pipeline behaviour identical to today", async () => {
  await withRegistry(undefined, undefined, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/nonexistent/path" });
    assertEquals(result.success, false);
    assert(
      result.error?.includes(TOOL_EXECUTED_MARKER),
      "Tool should have executed (access denied, not HITL block)",
    );
  });
});

Deno.test("hitl: no match => tool executes normally", async () => {
  const evaluator = new MockHitlPolicyEvaluator(null);
  await withRegistry(evaluator, undefined, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/nonexistent/path" });
    assertEquals(result.success, false);
    assert(
      result.error?.includes(TOOL_EXECUTED_MARKER),
      "Tool should have executed when no rule matches",
    );
  });
});

Deno.test("hitl: mandatory rule match with interceptor approves => tool executes", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: "read_file", command_pattern: "*" },
    source: "mandatory" as HitlRuleSource,
  });
  const interceptor = new MockConfirmationInterceptor(true);
  await withRegistry(evaluator, interceptor, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/nonexistent/path" });
    assertEquals(result.success, false);
    assert(
      result.error?.includes(TOOL_EXECUTED_MARKER),
      "Tool should execute after HITL approval",
    );
    assertEquals(interceptor.requests.length, 1);
    assertEquals(interceptor.requests[0].toolName, "read_file");
  });
});

Deno.test("hitl: interceptor denies => tool denied and not executed", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: "read_file" },
    source: "blueprint" as HitlRuleSource,
  });
  const interceptor = new MockConfirmationInterceptor(false);
  await withRegistry(evaluator, interceptor, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/some/path" });
    assertEquals(result.success, false);
    assert(result.error?.includes("denied"), "Expected denial error");
  });
});

Deno.test("[security] hitl: mandatory match with no interceptor fails closed", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: "read_file" },
    source: "mandatory" as HitlRuleSource,
  });
  await withRegistry(evaluator, undefined, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/some/path" });
    assertEquals(result.success, false);
    assert(
      result.error?.includes("no approver"),
      `Expected fail-closed message, got: ${result.error}`,
    );
  });
});

Deno.test("hitl: blueprint-only match with no interceptor proceeds", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: "read_file", path_pattern: "**/.env*" },
    source: "blueprint" as HitlRuleSource,
  });
  await withRegistry(evaluator, undefined, undefined, async (registry) => {
    const result = await registry.execute("read_file", { path: "/nonexistent/path" });
    assertEquals(result.success, false);
    assert(
      result.error?.includes(TOOL_EXECUTED_MARKER),
      "Tool should proceed when blueprint-only match has no interceptor",
    );
  });
});

Deno.test("hitl: blueprint rules passed via config are used by evaluator", async () => {
  let receivedBlueprintRules: HitlRule[] | undefined;
  class InspectingEvaluator implements IHitlPolicyEvaluator {
    evaluate(
      blueprintRules: HitlRule[],
      _toolName: string,
      _toolArgs: LogMetadata,
    ): { rule: HitlRule; source: HitlRuleSource } | null {
      receivedBlueprintRules = blueprintRules;
      return null;
    }
  }

  const blueprintRules: HitlRule[] = [
    { tool: "some_tool", path_pattern: "**/.env*" },
  ];

  await withRegistry(new InspectingEvaluator(), undefined, blueprintRules, async (registry) => {
    await registry.execute("read_file", { path: "/nonexistent" });
    assertEquals(receivedBlueprintRules, blueprintRules);
  });
});

Deno.test("hitl: setHitlBlueprintRules updates the rules used by evaluator on the next execute()", async () => {
  let receivedBlueprintRules: HitlRule[] | undefined;
  class InspectingEvaluator implements IHitlPolicyEvaluator {
    evaluate(
      blueprintRules: HitlRule[],
      _toolName: string,
      _toolArgs: LogMetadata,
    ): { rule: HitlRule; source: HitlRuleSource } | null {
      receivedBlueprintRules = blueprintRules;
      return null;
    }
  }

  const newRules: HitlRule[] = [{ tool: "write_file", reason: "set post-construction" }];

  // Constructed with NO blueprint rules, mirroring every real ToolRegistry construction
  // site (Phase 154 Step 3: hitlBlueprintRules was never populated by any of them).
  await withRegistry(new InspectingEvaluator(), undefined, undefined, async (registry) => {
    registry.setHitlBlueprintRules(newRules);
    await registry.execute("read_file", { path: "/nonexistent" });
    assertEquals(receivedBlueprintRules, newRules);
  });
});
