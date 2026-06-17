/**
 * @module HitlPolicyEvaluatorTest
 * @path packages-team/hitl/tests/hitl_policy_evaluator_test.ts
 * @description Tests for HitlPolicyEvaluator: matching, mandatory vs blueprint
 * priority, security canonicalization, fail-safe, null-byte rejection, and
 * benchmark budget verification (Phase 118 Step 2).
 */

import { assert, assertEquals } from "@std/assert";
import { HitlPolicyEvaluator } from "../mod.ts";
import { HITL_EVAL_BUDGET_MS } from "@exaix/core";
import type { HitlRule } from "@exaix/schemas/hitl.ts";

Deno.test("evaluator: tool + path_pattern match", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  const result = eval_.evaluate(blueprintRules, "write_file", {
    path: ".env.prod",
  });
  assert(result !== null, "Expected a match");
  assertEquals(result.source, "blueprint");
  assertEquals(result.rule.tool, "write_file");
});

Deno.test("evaluator: command_pattern match", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "run_command", command_pattern: "*rm -rf*" },
  ];
  const result = eval_.evaluate(blueprintRules, "run_command", {
    command: "rm -rf /tmp",
  });
  assert(result !== null);
  assertEquals(result.rule.command_pattern, "*rm -rf*");
});

Deno.test("evaluator: tables match", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "run_command", tables: ["users", "secrets"] },
  ];
  const result = eval_.evaluate(blueprintRules, "run_command", {
    tables: ["secrets"],
  });
  assert(result !== null, "Expected tables match");
});

Deno.test("evaluator: no match returns null", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  const result = eval_.evaluate(blueprintRules, "write_file", {
    path: "src/main.ts",
  });
  assertEquals(result, null);
});

Deno.test("evaluator: non-matching tool returns null", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  const result = eval_.evaluate(blueprintRules, "git_commit", { path: ".env" });
  assertEquals(result, null);
});

Deno.test("evaluator: mandatory rule fires even when blueprint omits it", () => {
  const eval_ = new HitlPolicyEvaluator([
    { tool: "run_command", command_pattern: "*rm -rf*" },
  ]);
  const result = eval_.evaluate([], "run_command", { command: "rm -rf /" });
  assert(result !== null);
  assertEquals(result.source, "mandatory");
});

Deno.test("evaluator: mandatory cannot be overridden by blueprint", () => {
  const eval_ = new HitlPolicyEvaluator([
    { tool: "run_command", command_pattern: "*rm -rf*" },
  ]);
  // Blueprint has a different rule for the same tool — mandatory still wins
  const blueprintRules: HitlRule[] = [
    { tool: "run_command", command_pattern: "**/safe/*" },
  ];
  const result = eval_.evaluate(blueprintRules, "run_command", {
    command: "rm -rf /tmp",
  });
  assert(result !== null);
  assertEquals(result.source, "mandatory");
});

Deno.test("[security] evaluator: path arg aliasing/normalisation cannot dodge a **/.env rule", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  // Various aliases for .env
  const aliases = [
    ".env",
    ".env.prod",
    "./.env",
    "subdir/../.env",
    "subdir/../.env.prod",
  ];
  for (const alias of aliases) {
    const result = eval_.evaluate(blueprintRules, "write_file", {
      path: alias,
    });
    assert(result !== null, `Expected match for path alias: ${alias}`);
  }
});

Deno.test("[security] evaluator: absent target arg fails safe to require confirmation", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  // path arg is absent — should match (fail-safe)
  const result = eval_.evaluate(blueprintRules, "write_file", {});
  assert(
    result !== null,
    "Absent path arg should fail safe to require confirmation",
  );
  assertEquals(result.source, "blueprint");
});

Deno.test("[security] evaluator: null-byte arg triggers mandatory block", () => {
  const eval_ = new HitlPolicyEvaluator([]);
  const blueprintRules: HitlRule[] = [
    { tool: "write_file", path_pattern: "**/.env*" },
  ];
  const result = eval_.evaluate(blueprintRules, "write_file", {
    path: ".env\u0000",
  });
  assert(result !== null, "Null-byte arg should trigger a mandatory block");
  assertEquals(result.source, "mandatory");
  assertEquals(result.rule.tool, "write_file");
  assert(
    result.rule.reason?.includes("Null byte"),
    `Expected reason about null byte, got: ${result.rule.reason}`,
  );
});

Deno.test("benchmark: 50-rule unmatched evaluation under HITL_EVAL_BUDGET_MS", () => {
  const rules: HitlRule[] = [];
  for (let i = 0; i < 50; i++) {
    rules.push({ tool: `tool_${i}`, path_pattern: `**/path_${i}/*` });
  }
  const eval_ = new HitlPolicyEvaluator(rules);
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    eval_.evaluate(rules, "nonexistent_tool", { path: "/some/path" });
  }
  const elapsed = performance.now() - start;
  const avgPerCall = elapsed / 100;
  assert(
    avgPerCall < HITL_EVAL_BUDGET_MS,
    `Average evaluation time ${avgPerCall.toFixed(3)}ms exceeds budget of ${HITL_EVAL_BUDGET_MS}ms`,
  );
});
