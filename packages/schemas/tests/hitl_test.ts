/**
 * @module HitlSchemaTest
 * @path packages/schemas/tests/hitl_test.ts
 * @related-files ["packages/schemas/src/hitl.ts"]
 * @architectural-layer Schemas
 * @description Tests for HitlRuleSchema and HitlPolicySchema (Phase 118).
 */

import { assertEquals, assertFalse } from "@std/assert";
import { HitlPolicySchema, HitlRuleSchema } from "@exaix/schemas/hitl.ts";

const BASE_RULE = {
  tool: "git_commit",
  path_pattern: "**/migrations/**",
  reason: "Commits to migrations need approval",
};

Deno.test("HitlRuleSchema: valid rule set parses", () => {
  const result = HitlRuleSchema.parse(BASE_RULE);
  assertEquals(result.tool, "git_commit");
  assertEquals(result.path_pattern, "**/migrations/**");
  assertEquals(result.reason, "Commits to migrations need approval");
});

Deno.test("HitlRuleSchema: command_pattern parses", () => {
  const result = HitlRuleSchema.parse({
    tool: "run_command",
    command_pattern: "*rm -rf*",
    reason: "Destructive command",
  });
  assertEquals(result.command_pattern, "*rm -rf*");
});

Deno.test("HitlRuleSchema: tables field parses", () => {
  const result = HitlRuleSchema.parse({
    tool: "write_file",
    tables: ["users", "secrets"],
  });
  assertEquals(result.tables, ["users", "secrets"]);
});

Deno.test("HitlRuleSchema: branch_pattern parses", () => {
  const result = HitlRuleSchema.parse({
    tool: "git_commit",
    branch_pattern: "**/main",
  });
  assertEquals(result.branch_pattern, "**/main");
});

Deno.test("HitlRuleSchema: only tool is required", () => {
  const result = HitlRuleSchema.parse({ tool: "run_command" });
  assertEquals(result.tool, "run_command");
  assertEquals(result.path_pattern, undefined);
  assertEquals(result.reason, undefined);
});

Deno.test("HitlRuleSchema: missing tool fails", () => {
  const result = HitlRuleSchema.safeParse({
    path_pattern: "**/.env",
  });
  assertFalse(result.success, "Missing tool must be rejected");
});

Deno.test("HitlRuleSchema: empty tool fails", () => {
  const result = HitlRuleSchema.safeParse({ tool: "" });
  assertFalse(result.success, "Empty tool must be rejected");
});

Deno.test("HitlRuleSchema: unknown field rejected", () => {
  const result = HitlRuleSchema.safeParse({
    ...BASE_RULE,
    unknown_field: "should_not_exist",
  });
  assertFalse(result.success, "Unknown field must be rejected");
});

Deno.test("HitlPolicySchema: valid rule set parses", () => {
  const result = HitlPolicySchema.parse({
    require_secondary_approval: [BASE_RULE],
  });
  assertEquals(result.require_secondary_approval.length, 1);
  assertEquals(result.require_secondary_approval[0].tool, "git_commit");
});

Deno.test("HitlPolicySchema: empty/absent block defaults to []", () => {
  const result = HitlPolicySchema.parse({});
  assertEquals(result.require_secondary_approval, []);
});

Deno.test("HitlPolicySchema: multiple rules parse", () => {
  const result = HitlPolicySchema.parse({
    require_secondary_approval: [
      { tool: "git_commit", path_pattern: "**/migrations/**" },
      { tool: "run_command", command_pattern: "*rm -rf*" },
      { tool: "write_file", path_pattern: "**/.env*" },
    ],
  });
  assertEquals(result.require_secondary_approval.length, 3);
});
