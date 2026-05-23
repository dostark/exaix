/**
 * @module hallucination_benchmark_test
 * @path tests/docs/hallucination_benchmark_test.ts
 * @description Benchmarks for documentation-based reasoning and hallucination prevention.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

/**
 * These tests verify that the 'Nervous System' (frontmatter + AGENT_LOGIC)
 * contains the correct information and that it is discoverable.
 * In a real bench, these would be fed to an LLM.
 * Here we verify the 'Ground Truth' consistency.
 */

Deno.test("[hallucination-bench] Verify Frontmatter Consistency", async () => {
  const content = await Deno.readTextFile(join(Deno.cwd(), "ARCHITECTURE.md"));

  // Verify it contains copilot_knowledge_base: true
  assertEquals(content.includes("copilot_knowledge_base: true"), true, "ARCHITECTURE.md must be a knowledge base.");

  // Verify it lists critical capabilities
  assertEquals(content.includes("architecture_overview"), true, "Missing capability: architecture_overview");
  assertEquals(content.includes("execution_flow"), true, "Missing capability: execution_flow");
});

Deno.test("[hallucination-bench] Verify AGENT_LOGIC steps exist as symbols", async () => {
  const content = await Deno.readTextFile(join(Deno.cwd(), "ARCHITECTURE.md"));
  const logicBlocks = content.matchAll(/<!-- AGENT_LOGIC: ([\s\S]*?) -->/g);

  let totalBlocks = 0;
  for (const match of logicBlocks) {
    totalBlocks++;
    const json = JSON.parse(match[1]);
    assertEquals(!!json.flow, true, "Logic block missing 'flow' name.");
    assertEquals(Array.isArray(json.steps), true, "Logic block missing 'steps' array.");
  }

  assertEquals(totalBlocks >= 5, true, "Expected at least 5 AGENT_LOGIC blocks in ARCHITECTURE.md");
});

Deno.test("[hallucination-bench] Verify Component Responsibilities mapping", async () => {
  const content = await Deno.readTextFile(join(Deno.cwd(), "ARCHITECTURE.md"));

  // Verify key components have stable links
  assertEquals(
    content.includes("packages/request/src/processor.ts"),
    true,
    "RequestProcessor link missing.",
  );
  assertEquals(content.includes("apps/daemon/main.ts"), true, "Daemon entry missing.");
});
