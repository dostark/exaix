/**
 * @module ConfigHitlTest
 * @path packages/schemas/tests/config_hitl_test.ts
 * @related-files ["packages/schemas/src/config.ts"]
 * @architectural-layer Schemas
 * @description Verifies the ConfigSchema `hitl` block (Phase 118).
 */

import { assert, assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { ExaPathDefaults } from "@exaix/core";

function baseConfig() {
  return {
    system: { root: "/tmp" },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("ConfigSchema: hitl defaults to disabled with empty mandatory_rules", () => {
  const result = ConfigSchema.parse(baseConfig());
  assertEquals(result.hitl?.enabled, false);
  assertEquals(result.hitl?.mandatory_rules, []);
});

Deno.test("ConfigSchema: hitl enabled with mandatory rule", () => {
  const result = ConfigSchema.parse({
    ...baseConfig(),
    hitl: {
      enabled: true,
      mandatory_rules: [
        { tool: "run_command", command_pattern: "*rm -rf*" },
      ],
    },
  });
  assertEquals(result.hitl?.enabled, true);
  assertEquals(result.hitl?.mandatory_rules.length, 1);
  assertEquals(result.hitl?.mandatory_rules[0].tool, "run_command");
});

Deno.test("ConfigSchema: hitl mandatory_rules empty defaults to []", () => {
  const result = ConfigSchema.parse({
    ...baseConfig(),
    hitl: { enabled: true },
  });
  assertEquals(result.hitl?.mandatory_rules, []);
});

Deno.test("[security][hitl] config mandatory_rules accepts the Write alias and stores write_file", () => {
  const result = ConfigSchema.parse({
    ...baseConfig(),
    hitl: { mandatory_rules: [{ tool: "Write", path_pattern: "**/.env*" }] },
  });
  assertEquals(result.hitl?.mandatory_rules[0].tool, "write_file");
});

Deno.test("[security][hitl] config mandatory_rules reject a retired native alias", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    hitl: { mandatory_rules: [{ tool: "list_symbols", path_pattern: "**/.env*" }] },
  });
  assert(!result.success);
});
