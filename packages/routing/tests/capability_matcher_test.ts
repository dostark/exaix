/** @module CapabilityMatcherTest
 * @path packages/routing/tests/capability_matcher_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals, assertExists } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { CapabilityMatcher } from "@exaix/routing";

interface TestBlueprintFrontmatter {
  capabilities?: string[];
  version?: string;
  deprecated?: boolean;
  language?: string;
  task_type?: string;
  portal_type?: string;
  [key: string]: JSONValue;
}

interface TestBlueprint {
  identityId: string;
  version: string;
  capabilities: string[];
  frontmatter: TestBlueprintFrontmatter;
}

function createFrontmatter(overrides: Partial<TestBlueprintFrontmatter> = {}): TestBlueprintFrontmatter {
  return {
    capabilities: [],
    version: "1.0.0",
    deprecated: false,
    ...overrides,
  };
}

const makeBlueprint = (overrides: Partial<TestBlueprint>): TestBlueprint => ({
  identityId: overrides.identityId ?? "test-agent",
  version: overrides.version ?? "1.0.0",
  capabilities: overrides.capabilities ?? ["code_review", "documentation"],
  frontmatter: overrides.frontmatter ?? createFrontmatter(),
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

Deno.test("CapabilityMatcher: boosts score when language, taskType, and portalType match", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: createFrontmatter({
      language: "typescript",
      task_type: "implementation",
      portal_type: "api",
    }),
  });

  const candidate = matcher.matchBlueprint(blueprint, {
    capability: "code_review",
    language: "typescript",
    taskType: "implementation",
    portalType: "api",
    tags: [],
  });

  assertExists(candidate);
  assertEquals(candidate?.score, 1);
});

Deno.test("CapabilityMatcher: lowers score when metadata fields mismatch", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: createFrontmatter({
      language: "python",
      task_type: "analysis",
      portal_type: "console",
    }),
  });

  const candidate = matcher.matchBlueprint(blueprint, {
    capability: "code_review",
    language: "typescript",
    taskType: "implementation",
    portalType: "api",
    tags: [],
  });

  assertExists(candidate);
  assertEquals(candidate?.score, 0.75);
});

Deno.test("CapabilityMatcher: excludes deprecated blueprints by default", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: createFrontmatter({ deprecated: true }),
  });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "code_review", tags: [] });

  assertEquals(candidate, null);
});

Deno.test("CapabilityMatcher: includes deprecated blueprints when allowed", () => {
  const matcher = new CapabilityMatcher({ allowDeprecated: true });
  const blueprint = makeBlueprint({
    capabilities: ["code_review"],
    frontmatter: createFrontmatter({ deprecated: true }),
  });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "code_review", tags: [] });

  assertExists(candidate);
  assertEquals(candidate?.identityId, "test-agent");
});

// ── Streaming capability tests ──────────────────────────────────────────────

Deno.test("CapabilityMatcher: matches blueprint with streaming capability", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({ capabilities: ["chat", "streaming"] });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "streaming", tags: [] });

  assertExists(candidate);
  assertEquals(candidate?.identityId, "test-agent");
  assertEquals(candidate?.score, 1);
});

Deno.test("CapabilityMatcher: returns null when blueprint lacks streaming capability", () => {
  const matcher = new CapabilityMatcher();
  const blueprint = makeBlueprint({ capabilities: ["chat"] });

  const candidate = matcher.matchBlueprint(blueprint, { capability: "streaming", tags: [] });

  assertEquals(candidate, null);
});

Deno.test("CapabilityMatcher: fallback selects streaming-capable blueprint over non-streaming one", () => {
  const matcher = new CapabilityMatcher();
  const streamingBp = makeBlueprint({
    identityId: "streaming-agent",
    capabilities: ["chat", "streaming"],
  });
  const nonStreamingBp = makeBlueprint({
    identityId: "basic-agent",
    capabilities: ["chat"],
  });

  const candidate = matcher.fallback([streamingBp, nonStreamingBp], {
    capability: "streaming",
    tags: [],
  });

  assertExists(candidate);
  assertEquals(candidate?.identityId, "streaming-agent");
});
