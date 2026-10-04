/**
 * @module RemediateCodeGapsCommitGuidanceTest
 * @path tests/agents/remediate_code_gaps_commit_guidance_test.ts
 * @description Verifies the remediate-code-gaps and plan skills carry two fixes found
 * during phase-91's self-improvement-retro: (1) the commit message has no `remediation:`
 * field — gap numbers belong in `what:`, because `check_commit_msg.ts`'s
 * `KNOWN_COMMIT_FIELDS` would swallow a `remediation:` line into `impact:`; (2) when a
 * plan-step's submodule commit succeeds but ANY parent pre-commit gate rejects, the
 * parent is committed directly rather than rolling the submodule back; (3) relocating a
 * step's deliverable must not leave `- [ ]` behind.
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: remediate-code-gaps does not suggest a nonexistent remediation: field", async () => {
  const md = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");

  assert(
    !md.includes("numbers e.g. `remediation: GAP-1, GAP-3`"),
    "remediate-code-gaps must not present `remediation:` as a commit field — it is not in KNOWN_COMMIT_FIELDS",
  );
  assert(
    md.includes("swallowed into `impact:`"),
    "remediate-code-gaps must warn that a `remediation:` line is swallowed into `impact:`",
  );
});

Deno.test("Agent docs: remediate-code-gaps recovers from any parent gate, not just check_commit_msg", async () => {
  const md = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");

  assert(
    md.includes("staged-file gate"),
    "remediate-code-gaps must generalize the parent-gate recovery beyond the message check",
  );
  assert(
    md.includes("check:ste100-comments:staged"),
    "remediate-code-gaps must name a concrete non-message parent gate as an example",
  );
});

Deno.test("Agent docs: plan forbids leaving an open checkbox when relocating a deliverable", async () => {
  const md = await Deno.readTextFile(".copilot/skills/plan/SKILL.md");

  assert(
    md.includes("Relocating a step's deliverable"),
    "plan must document how to handle a relocated/folded step's criteria",
  );
});
