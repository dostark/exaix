/**
 * @module CommitPromptTest
 * @path tests/scripts/commit_prompt_test.ts
 * @description Verifies that the agent commit prompt matches the new structured guidelines.
 */

import { assert } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe(".copilot/skills/commit/SKILL.md", () => {
  it("contains all mandatory headers for structured commits", async () => {
    const content = await Deno.readTextFile(".copilot/skills/commit/SKILL.md");
    assert(content.includes("what:"), "Prompt missing 'what:'");
    assert(content.includes("rationale:"), "Prompt missing 'rationale:'");
    assert(content.includes("tests:"), "Prompt missing 'tests:'");
    assert(content.includes("who:"), "Prompt missing 'who:'");
    assert(content.includes("impact:"), "Prompt missing 'impact:'");
    assert(content.includes("ARCHITECTURE.md"), "Prompt missing 'ARCHITECTURE.md' reference");
    assert(content.includes("hallucinate"), "Prompt missing hallucination warning");
  });
});
