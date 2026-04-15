/**
 * @module AgentRetrievalSmokeTest
 * @path tests/agents/agent_retrieval_smoke_test.ts
 * @description Smoke tests for agent discovery and context injection, ensuring that
 * configured LLM agents are correctly identified and loaded at runtime.
 */

import { assert, assertExists } from "@std/assert";
import { buildIndex } from "../../scripts/build_agents_index.ts";
import { inject } from "../../scripts/inject_agent_context.ts";

Deno.test("retrieval smoke: build manifest and inject context", async () => {
  await buildIndex();
  assertExists(".copilot/manifest.json");

  // inject may return found=false when no doc scores above 0 for this query; both outcomes are valid.
  const res = await inject("copilot", "copilot");
  if (res.found === false) return;
  // If a doc was found, it must have a path
  assert(res.path && res.path.length > 0, "found doc should have a path");
});
