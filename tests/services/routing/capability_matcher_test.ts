/**
 * @module CapabilityMatcherTest
 * @path tests/services/routing/capability_matcher_test.ts
 * @description Unit tests for matching blueprint capabilities to routing criteria.
 */

import { assertEquals, assertExists } from "@std/assert";
import { CapabilityMatcher } from "../../../src/services/routing/capability_matcher.ts";
import type { ILoadedBlueprint } from "../../../src/services/blueprint/blueprint_loader.ts";

const makeBlueprint = (overrides: Partial<ILoadedBlueprint>): ILoadedBlueprint => ({
  identityId: overrides.identityId ?? "test-agent",
  name: overrides.name ?? "Test Agent",
  model: overrides.model ?? "anthropic:claude-sonnet-4-20250514",
  capabilities: overrides.capabilities ?? ["code_review", "documentation"],
  systemPrompt: overrides.systemPrompt ?? "You are a test agent.",
  version: overrides.version ?? "1.0.0",
  frontmatter: overrides.frontmatter ?? {
    capabilities: [],
    version: "1.0.0",
    reflexive: false,
    max_reflexion_iterations: 3,
    memory_enabled: false,
    deprecated: false,
  },
  path: overrides.path ?? "/tmp/test-agent.md",
});

Deno.test("CapabilityMatcher: matches blueprint with requested capability", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({ capabilities: ["code_review", "analysis"] });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "code_review", tags: [] });

  assertExists(candidate);
  assertEquals(candidate?.identityId, "test-agent");
  assertEquals(candidate?.score, 1);
});

Deno.test("CapabilityMatcher: scores partially matched tag criteria", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({ capabilities: ["code_review", "documentation"] });

  const candidate = matcher.matchBlueprint(blueprint, {
    capability: "",
    tags: ["documentation", "security"],
  });

  assertExists(candidate);
  assertEquals(candidate?.score, 0.5);
});

Deno.test("CapabilityMatcher: excludes deprecated blueprints by default", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: {
      capabilities: [],
      version: "1.0.0",
      reflexive: false,
      max_reflexion_iterations: 3,
      memory_enabled: false,
      deprecated: true,
    },
  });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "code_review", tags: [] });

  assertEquals(candidate, null);
});

Deno.test("CapabilityMatcher: includes deprecated blueprints when allowed", () => {
  const matcher = new CapabilityMatcher({ allowDeprecated: true });
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: {
      capabilities: [],
      version: "1.0.0",
      reflexive: false,
      max_reflexion_iterations: 3,
      memory_enabled: false,
      deprecated: true,
    },
  });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "code_review", tags: [] });

  assertExists(candidate);
  assertEquals(candidate?.identityId, "test-agent");
});
