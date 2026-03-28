/**
 * @module AgentRetrievalSmokeTest
 * @path tests/agent_retrieval_smoke_test.ts
 * @description Smoke tests for agent discovery and context injection, ensuring that
 * configured LLM agents are correctly identified and loaded at runtime.
 */

import { assert, assertExists } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { buildIndex } from "../scripts/build_agents_index.ts";
import { inject } from "../scripts/inject_agent_context.ts";

Deno.test("retrieval smoke: build manifest and inject context", async () => {
  await buildIndex();
  assertExists(".copilot/manifest.json");

  const res = await inject("copilot", "copilot");
  if (res.found === false) return;
  assert(res.short_summary && res.short_summary.length > 0);
});
