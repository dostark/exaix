/**
 * @module RoutingDescriptionMatchTest
 * @path tests/blueprints/routing_description_match_test.ts
 * @description Phase 131 Step 8 — Verifies CapabilityMatcher.fallback() scores blueprints by description/routing_hint.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/routing]
 */

import { assertEquals, assertExists } from "@std/assert";
import { CapabilityMatcher } from "@exaix/routing/capability_matcher.ts";
import type { ILoadedBlueprint } from "@exaix/routing/internal_types.ts";
import type { JSONValue } from "@exaix/core";

function makeBlueprint(
  overrides: Partial<ILoadedBlueprint> & { description?: string; routing_hint?: string },
): ILoadedBlueprint {
  const fm: Record<string, JSONValue> = {};
  if (overrides.description) fm.description = overrides.description;
  if (overrides.routing_hint) fm.routing_hint = overrides.routing_hint;

  return {
    agentRole: overrides.agentRole ?? "test-agent",
    version: overrides.version ?? "1.0.0",
    capabilities: overrides.capabilities ?? ["general"],
    frontmatter: fm,
  };
}

Deno.test({
  name: "[step8/routing] fallback prefers blueprint with description matching request text",
  fn: () => {
    const matcher = new CapabilityMatcher();

    const blueprints: ILoadedBlueprint[] = [
      makeBlueprint({
        agentRole: "general-agent",
        capabilities: ["general"],
        description: "General purpose assistant",
      }),
      makeBlueprint({
        agentRole: "code-expert",
        capabilities: ["code_review"],
        description: "Expert in TypeScript code review, refactoring, and best practices",
      }),
      makeBlueprint({
        agentRole: "data-analyst",
        capabilities: ["data_analysis"],
        description: "Specialist in data analysis and visualization",
      }),
    ];

    const result = matcher.fallback(blueprints, {
      tags: [],
      requestText: "I need help reviewing and refactoring my TypeScript code",
    });

    assertExists(result, "fallback should return a candidate");
    assertEquals(
      result.agentRole,
      "code-expert",
      `Expected code-expert (description matches request), got ${result.agentRole}`,
    );
  },
});

Deno.test({
  name: "[step8/routing] fallback prefers blueprint with routing_hint matching request text",
  fn: () => {
    const matcher = new CapabilityMatcher();

    const blueprints: ILoadedBlueprint[] = [
      makeBlueprint({
        agentRole: "general-agent",
        capabilities: ["general"],
        routing_hint: "general_purpose",
      }),
      makeBlueprint({
        agentRole: "ts-expert",
        capabilities: ["code_review"],
        routing_hint: "typescript_refactoring_expert",
      }),
    ];

    const result = matcher.fallback(blueprints, {
      tags: [],
      requestText: "Help me refactor my TypeScript project",
    });

    assertExists(result, "fallback should return a candidate");
    assertEquals(
      result.agentRole,
      "ts-expert",
      `Expected ts-expert (routing_hint matches request), got ${result.agentRole}`,
    );
  },
});

Deno.test({
  name: "[step8/routing] fallback without requestText falls back to capability scoring",
  fn: () => {
    const matcher = new CapabilityMatcher();

    const blueprints: ILoadedBlueprint[] = [
      makeBlueprint({
        agentRole: "general-agent",
        capabilities: ["general"],
        description: "General purpose assistant",
      }),
      makeBlueprint({
        agentRole: "code-expert",
        capabilities: ["code_review"],
        description: "TypeScript code review expert",
      }),
    ];

    const result = matcher.fallback(blueprints, { tags: [] });

    assertExists(result, "fallback should return a candidate");
    assertEquals(
      result.agentRole,
      "general-agent",
      "Without requestText, first blueprint by score should win",
    );
  },
});
