/**
 * @module DogfoodCoderHitlTest
 * @path tests/blueprints/dogfood_developer_hitl_test.ts
 * @description Phase 131 Step 8 — Verifies dogfood-developer declares a HITL policy gating destructive tools.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/schemas]
 */

import { assertEquals, assertExists } from "@std/assert";
import { HitlPolicySchema } from "@exaix/schemas/hitl.ts";

const FILE_PATH = "Blueprints/Agents/dogfood-developer.md";

interface ParsedHitlField {
  require_secondary_approval: Array<{
    tool: string;
    reason?: string;
  }>;
}

function parseHitlFromFile(filePath: string): ParsedHitlField {
  const content = Deno.readTextFileSync(filePath);
  const inHitl: string[] = [];
  let inBlock = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("hitl:")) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.startsWith("---") || (line.length > 0 && line[0] !== " " && line[0] !== "\t")) {
        break;
      }
      inHitl.push(line);
    }
  }

  // Manually parse the YAML-ish block
  const rules: ParsedHitlField["require_secondary_approval"] = [];
  let currentRule: Partial<{ tool: string; reason: string }> | null = null;

  for (const line of inHitl) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- tool:")) {
      if (currentRule) rules.push(currentRule as { tool: string; reason?: string });
      currentRule = { tool: trimmed.replace("- tool:", "").trim().replace(/^["']|["']$/g, "") };
    } else if (trimmed.startsWith("reason:") && currentRule) {
      currentRule.reason = trimmed.replace("reason:", "").trim().replace(/^["']|["']$/g, "");
    }
  }
  if (currentRule) rules.push(currentRule as { tool: string; reason?: string });

  return { require_secondary_approval: rules };
}

Deno.test({
  name: "[step8/hitl] dogfood-developer has HITL policy block",
  fn: () => {
    const content = Deno.readTextFileSync(FILE_PATH);
    assertExists(content.includes("hitl:"), "dogfood-developer should declare a hitl: block");
    assertExists(
      content.includes("require_secondary_approval"),
      "hitl block should include require_secondary_approval",
    );
  },
});

Deno.test({
  name: "[step8/hitl] HITL policy validates against HitlPolicySchema",
  fn: () => {
    const hitl = parseHitlFromFile(FILE_PATH);
    const result = HitlPolicySchema.safeParse(hitl);
    assertEquals(result.success, true, `HITL policy should validate: ${result.success ? "" : result.error?.message}`);
  },
});

Deno.test({
  name: "[step8/hitl] HITL policy gates destructive tools (write_file, patch_file, run_command)",
  fn: () => {
    const hitl = parseHitlFromFile(FILE_PATH);
    const gatedTools = hitl.require_secondary_approval.map((r) => r.tool);

    for (const tool of ["write_file", "patch_file", "run_command"]) {
      assertEquals(
        gatedTools.includes(tool),
        true,
        `HITL policy should gate '${tool}' (destructive tool) — gated: [${gatedTools.join(", ")}]`,
      );
    }
  },
});

Deno.test({
  name: "[step8/hitl] HITL policy has a reason for each gated tool",
  fn: () => {
    const hitl = parseHitlFromFile(FILE_PATH);
    const rulesWithoutReason = hitl.require_secondary_approval.filter((r) => !r.reason);
    assertEquals(
      rulesWithoutReason.length,
      0,
      rulesWithoutReason.length > 0
        ? `Rules missing reason: ${rulesWithoutReason.map((r) => r.tool).join(", ")}`
        : "All HITL rules have a reason",
    );
  },
});
