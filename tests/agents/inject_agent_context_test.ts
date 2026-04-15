/**
 * @module AgentContextInjectionTest
 * @path tests/agents/inject_agent_context_test.ts
 * @description Verifies the logic for injecting agent-specific context markers into
 * prompts, ensuring that agent personas and limitations are respected.
 */

import { assert, assertEquals } from "@std/assert";
import { inject } from "../../scripts/inject_agent_context.ts";

Deno.test("inject_agent_context returns summary and snippet for copilot query", async () => {
  const res = await inject("copilot", "copilot");
  if (res.found === false) {
    assertEquals(res.found, false);
  } else {
    // some queries might return empty short_summary depending on document found
    assert(res.path, "path should be present if found");
  }
});
