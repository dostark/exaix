/**
 * @module SkillsConfigDefaultsTest
 * @path packages/schemas/tests/skills_config_defaults_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Tests for skills-related configuration defaults.
 */
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ConfigSchema } from "@exaix/schemas";

describe("Skills Config Defaults", () => {
  it("should have correct skill defaults in ConfigSchema", () => {
    const rawConfig = {
      system: { root: "/tmp" },
      paths: {},
    };

    const result = ConfigSchema.parse(rawConfig);

    assertEquals(result.skills.max_per_request, 5);
    assertEquals(result.skills.match_threshold, 0.3);
    assertEquals(result.skills.inject_in_prompt, true);
    assertEquals(result.skills.log_matched_ids, true);
    assertEquals(result.skills.context_budget_chars, 32_000);
  });

  it("defaults a partial skills section to the full response-contract budget", () => {
    const result = ConfigSchema.parse({ system: { root: "/tmp" }, paths: {}, skills: {} });
    assertEquals(result.skills.context_budget_chars, 32_000);
  });

  it("should allow overriding skill config", () => {
    const rawConfig = {
      system: { root: "/tmp" },
      paths: {},
      skills: {
        max_per_request: 10,
        match_threshold: 0.5,
        context_budget_chars: 2000,
      },
    };

    const result = ConfigSchema.parse(rawConfig);

    assertEquals(result.skills.context_budget_chars, 2000);
    assertEquals(result.skills.max_per_request, 10);
    assertEquals(result.skills.match_threshold, 0.5);
    assertEquals(result.skills.inject_in_prompt, true);
  });
});
