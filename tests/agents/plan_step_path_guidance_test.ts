/**
 * @module PlanStepPathGuidanceTest
 * @path tests/agents/plan_step_path_guidance_test.ts
 * @description Verifies the next-steps and remediate-code-gaps skills document the
 * plan-step commit arrow rules for plan-doc-self-referencing criteria, and that the
 * clean-codebase skill names the staged md-path ratchet as the enforceable gate.
 * Regression for phase-162 Step 12: the plan doc's criteria arrows used the internal
 * submodule path, which the parent commit gate rejected ("…not among this commit's
 * changed files"); the fix (gitlink `exaix-dev-docs` arrow + amending the submodule
 * commit instead of adding a follow-up one) had to be reverse-engineered from
 * check_commit_msg.ts + a phase-144 precedent. Also regression for phase-163's
 * self-improvement-retro: a `→ \`path\`` line with extra backtick-wrapped code
 * mentions after the arrow made `extractArrowPaths()` demand those mentions as
 * staged files too, blocking a valid commit twice before the cause was traced to
 * check_commit_msg.ts's source.
 */

import { assert } from "@std/assert";

Deno.test("Agent docs: next-steps documents the gitlink arrow for plan-doc criteria", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assert(
    md.includes("exaix-dev-docs`") && md.includes("gitlink"),
    "next-steps should name the gitlink path convention for plan-doc criteria arrows",
  );
  assert(
    md.includes("not among this commit's changed files"),
    "next-steps should warn about the parent gate rejection message",
  );
  assert(
    md.includes("--amend --no-edit"),
    "next-steps should direct amending the submodule commit when the parent gate rejects plan-doc lines",
  );
});

Deno.test("Agent docs: remediate-code-gaps documents the same arrow + amend rules", async () => {
  const md = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");

  assert(
    md.includes("exaix-dev-docs`") && md.includes("gitlink"),
    "remediate-code-gaps should name the gitlink path convention for plan-doc criteria arrows",
  );
  assert(
    md.includes("--amend --no-edit"),
    "remediate-code-gaps should direct amending the submodule commit when the parent gate rejects plan-doc lines",
  );
  assert(
    md.includes("HEAD~1..HEAD"),
    "remediate-code-gaps should cite the validatePlanStepDiff added-lines requirement",
  );
});

Deno.test("Agent docs: clean-codebase names the staged md-path ratchet as the enforceable gate", async () => {
  const md = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");

  assert(
    md.includes("check:md-path:staged"),
    "clean-codebase should run the staged md-path ratchet, not the full sweep",
  );
  assert(
    md.includes("unenforced drift"),
    "clean-codebase should warn against fixing historical submodule planning-doc drift",
  );
});

Deno.test("Agent docs: commit skill warns that impact: consumes text through end-of-message", async () => {
  const md = await Deno.readTextFile(".copilot/skills/commit/SKILL.md");

  assert(
    md.includes("KNOWN_COMMIT_FIELDS"),
    "commit skill should name the parser's field-boundary mechanism",
  );
  assert(
    md.includes("CI gates:"),
    "commit skill should give the trailing-summary-block example that actually caused this failure",
  );
  assert(
    md.toLowerCase().includes("blank-line-separated trailing summary paragraph") ||
      md.toLowerCase().includes("trailing paragraph"),
    "commit skill should warn that a trailing paragraph after impact: is still parsed as impact content",
  );
});

Deno.test("Agent docs: commit skill warns that only ONE backtick span may follow a plan-step arrow", async () => {
  const md = await Deno.readTextFile(".copilot/skills/commit/SKILL.md");

  assert(
    md.includes("extractArrowPaths()"),
    "commit skill should name the exact parser function that treats every backtick span as a required path",
  );
  assert(
    md.includes("exactly ONE backtick-wrapped path after the arrow"),
    "commit skill should state the one-backtick-path-only rule explicitly",
  );
  assert(
    md.includes("Put any incidental backtick-wrapped code/type mentions in the sentence BEFORE the arrow"),
    "commit skill should tell the agent where to put incidental code mentions instead",
  );
});

Deno.test("Agent docs: remediate-code-gaps documents the arrow sweep trap for its own marking step", async () => {
  const md = await Deno.readTextFile(".copilot/skills/remediate-code-gaps/SKILL.md");

  assert(
    md.includes("extractArrowPaths()"),
    "remediate-code-gaps should name the parser whose arrow-sweep blocks the plan-step commit",
  );
  assert(
    md.includes("BEFORE the arrow"),
    "remediate-code-gaps should direct incidental mentions before the arrow, not after it",
  );
  assert(
    md.includes("put ONLY the real source/test paths after"),
    "remediate-code-gaps should state the real-paths-only rule for the arrow tail",
  );
});

Deno.test("Agent docs: clean-codebase warns the optional-params gate is a file-level staged ratchet", async () => {
  const md = await Deno.readTextFile(".copilot/skills/clean-codebase/SKILL.md");

  assert(
    md.includes("FILE-LEVEL RATCHET"),
    "clean-codebase should warn that check:optional-params --staged is a file-level ratchet",
  );
  assert(
    md.includes("Opt<T, Reason.*>"),
    "clean-codebase should direct wrapping bare optionals in Opt<T, Reason.*>",
  );
});

Deno.test("Agent docs: next-steps distinguishes presence from value propagation in wiring checks", async () => {
  const md = await Deno.readTextFile(".copilot/skills/next-steps/SKILL.md");

  assert(
    md.includes("PRESENCE ≠ PROPAGATION"),
    "next-steps should warn that a dependency name appearing in a call site is not wiring",
  );
  assert(
    md.includes("STORED-BUT-NEVER-READ") || md.includes("Stored-but-never-read"),
    "next-steps should name the stored-but-never-read config signature",
  );
  assert(
    md.includes("storage\n proof ≠ consumption proof") ||
      md.includes("storage proof ≠ consumption proof") ||
      md.includes("storage\n            proof ≠ consumption proof"),
    "next-steps should contrast storage proof with consumption proof",
  );
});

Deno.test("Agent docs: test-development warns against proxy assertions that survive a property violation", async () => {
  const md = await Deno.readTextFile(".copilot/skills/test-development/SKILL.md");

  assert(
    md.includes("proxy assertion"),
    "test-development should name the proxy-assertion defect class",
  );
  assert(
    md.includes("ORDER, BYTE-IDENTITY, or a STRICT\n       REDUCTION") ||
      md.includes("ORDER, BYTE-IDENTITY, or a STRICT REDUCTION") ||
      md.includes("ORDER, BYTE-IDENTITY, or a STRICT"),
    "test-development should scope the rule to order/byte-identity/strict-reduction claims",
  );
  assert(
    md.includes("multiset"),
    "test-development should cite the character-multiset proxy as a recurring example",
  );
});

Deno.test("Agent docs: doc skill requires runtime claims be implemented before documented", async () => {
  const md = await Deno.readTextFile(".copilot/skills/doc/SKILL.md");

  assert(
    md.includes("Every runtime claim is implemented"),
    "doc skill should require grepping the code for each documented event/key/flag",
  );
  assert(
    md.includes("grep the code for each documented event name"),
    "doc skill should tell the agent to grep for documented event names/config keys",
  );
});

Deno.test("Agent docs: security warns read-only/dry-run paths must not invoke a mutating getter", async () => {
  const md = await Deno.readTextFile(".copilot/skills/audit-security/SKILL.md");

  assert(
    md.includes("advertised as read-only"),
    "security should warn a read-only/dry-run path must not invoke a mutating getter",
  );
  assert(
    md.includes("a pure cached"),
    "security should direct exposing a pure cached lookup for read-only access",
  );
});
