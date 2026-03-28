/**
 * @module AgentDocsVerificationTest
 * @path tests/agents_docs_test.ts
 * @description Verifies that agent documentation matches the actual agent
 * implementations, ensuring that capabilities and triggers are accurately described.
 */

import { assert } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { validateFile } from "../scripts/validate_agents_docs.ts";

Deno.test("agent docs validate", async () => {
  // Find at least one doc and validate it
  const files = [
    ".copilot/copilot/exaix.md",
    ".copilot/providers/openai.md",
  ];
  for (const f of files) {
    const errors = await validateFile(f);
    assert(errors.length === 0, `Validation errors for ${f}: ${errors.join(", ")}`);
  }
});
