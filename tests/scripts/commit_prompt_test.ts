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

describe(".copilot/skills/commit/SKILL.md — Structural Bloom trap (phase-144 retro)", () => {
  it("documents the bullet-point requirement for what: on multi-file commits", async () => {
    const content = await Deno.readTextFile(".copilot/skills/commit/SKILL.md");
    assert(content.includes("Structural Bloom"), "SKILL.md missing 'Structural Bloom' rule");
    assert(
      content.includes("2 bullet points") || content.includes("two bullet points"),
      "SKILL.md missing the 2-bullet-point requirement text",
    );
  });
});

describe(".copilot/skills/remediate-code-gaps/SKILL.md — commit friction guidance (phase-144 retro)", () => {
  it("cross-references #commit's validator traps before the plan-step commit", async () => {
    const content = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");
    assert(
      content.includes("Structured Message Validator Traps") || content.includes("validator-traps"),
      "SKILL.md should point to #commit's validator-traps guidance before committing",
    );
  });

  it("documents grouping remediation steps that share a source file into one commit", async () => {
    const content = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");
    assert(
      content.includes("SAME source file") || content.includes("touching the SAME"),
      "SKILL.md should document the shared-file commit-grouping strategy",
    );
  });

  it("documents the parent-only commit-message-rejection recovery (submodule already valid)", async () => {
    const content = (await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md")).replace(/\s+/g, " ");
    assert(
      content.includes("do NOT roll back the submodule") || content.includes("already valid"),
      "SKILL.md should distinguish the parent-only-rejection recovery from the submodule-rollback recovery",
    );
  });

  it("warns about the read-tool line-truncation trap when editing long plan-doc lines", async () => {
    const content = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");
    assert(
      content.includes("Truncation trap") || content.includes("truncated text into an edit"),
      "SKILL.md should warn about copying a read-truncated line into an edit body",
    );
  });
});

describe(".copilot/skills/submodule-workflow/SKILL.md — parent-only rejection recipe (phase-144 retro)", () => {
  it("documents recovery when the submodule commit succeeds but the parent's message is rejected", async () => {
    const content = await Deno.readTextFile(".copilot/skills/submodule-workflow/SKILL.md");
    assert(
      content.includes("Different failure mode") || content.includes("do NOT roll back the submodule"),
      "SKILL.md should document the parent-only-rejection recovery, distinct from the preflight rollback recipe",
    );
  });
});
