/**
 * @module AgentDocsVerificationTest
 * @path tests/agents/agents_docs_test.ts
 * @description Verifies that agent documentation matches the actual agent
 * implementations, ensuring that capabilities and triggers are accurately described.
 */

import { assert } from "@std/assert";
import { validateFile } from "../../scripts/validate_agents_docs.ts";

Deno.test("agent docs validate", async () => {
  // Find at least one doc and validate it
  const files = [
    ".copilot/workflows/exaix-development.md",
    ".copilot/providers/openai.md",
  ];
  for (const f of files) {
    const errors = await validateFile(f);
    assert(errors.length === 0, `Validation errors for ${f}: ${errors.join(", ")}`);
  }
});
