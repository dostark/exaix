/**
 * @module CheckCommitMsgTest
 * @path tests/scripts/check_commit_msg_test.ts
 * @description Unit tests for the check_commit_msg.ts script.
 * Verifies validation logic for structured commit messages, including
 * mandatory fields, impact grounding, and provider/model validation.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { validateCommitMsg } from "../../scripts/check_commit_msg.ts";

describe("validateCommitMsg", () => {
  it("passes a valid structured message", () => {
    const msg = `feat: add new feature

what: implemented a new feature in ReqProc based on requirement X
rationale: to provide users with better control over Y
tests: all 5 unit tests passed
who: Antigravity
impact: ReqProc: added validation logic
model: Gemini`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("fails if a required field is missing", () => {
    const msg = `feat: missing rationale

what: something
tests: pass
who: user
impact: ReqProc: update`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("rationale")), true);
  });

  it("fails if a required field is empty", () => {
    const msg = `feat: empty who

what: something
rationale: why
tests: pass
who:
impact: ReqProc: update`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("who")), true);
  });

  it("fails if impact is incorrectly formatted (missing component or colon)", () => {
    const msg = `feat: bad impact

what: something
rationale: why
tests: pass
who: user
impact: just some text without a component`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.toLowerCase().includes("impact")), true);
  });

  it("allows optional fields", () => {
    const msg = `feat: with optional fields

what: something in ReqProc
rationale: why
tests: pass
who: user
impact: ReqProc: update
conversation_id: 123
links: http://link
prompt: "the prompt"
tool_audit: write_to_file
model: Gemini`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("enforces conventional commit prefix", () => {
    const msg = `no-prefix: message

what: something
rationale: why
tests: pass
who: user
impact: ReqProc: update`;
    // Assuming we want to enforce standard types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("prefix") || e.includes("type")), true);
  });

  it("skips validation for merge commits", () => {
    const msg = `Merge branch 'main' into feature/x`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true); // Should bypass
  });

  it("skips validation for merge commits when merge state is detected", () => {
    const msg = `chore: merge feature branch`;
    const result = validateCommitMsg(msg, { isMergeCommit: true });
    assertEquals(result.success, true); // Should bypass merge commit validation
  });

  it("skips validation for revert commits", () => {
    const msg = `Revert "feat: add feature"

This reverts commit a1b2c3d4.`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true); // Should bypass
  });

  it("skips validation for fixup! commits", () => {
    const msg = `fixup! feat: add feature`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true); // Should bypass
  });

  it("fails if model is faked/hallucinated (optional but desired check)", () => {
    // This test might depend on how we implement "actual model" check.
    // E.g. if we have a list of known valid models.
    const msg = `feat: faked model

what: something
rationale: why
tests: pass
who: user
impact: ReqProc: update
model: SuperIntelligence-9000`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("model")), true);
  });

  it("fails if impact component is not mentioned in what (Component Traceability)", () => {
    const msg = `feat: missing component mention

what: implemented some other thing without mentioning the component
rationale: to improve X
tests: pass
who: user
impact: ReqProc: added validation logic`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("traceability") || e.includes("mentioned")), true);
  });

  it("passes if impact component IS mentioned in what", () => {
    const msg = `feat: with component mention

what: updated ReqProc to handle new validation rules
rationale: to improve X
tests: pass
who: user
impact: ReqProc: added validation logic`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("fails if > 3 files changed and no bullet points in what (Structural Bloom)", () => {
    const msg = `feat: many files but no bullets

what: I changed many things but I am using a single paragraph to describe everything which is hard to read for many files.
rationale: why
tests: pass
who: user
impact: ReqProc: update`;
    const result = validateCommitMsg(msg, { changedFileCount: 4 });
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.toLowerCase().includes("bullet")), true);
  });

  it("passes if > 3 files changed and bullet points are present", () => {
    const msg = `feat: many files with bullets

what:
- changed ReqProc logic and updated core validation rules
- updated file 2 and other related components
rationale: this change was made to address the requirement for more detailed commit messages and to ensure that ReqProc is correctly grounding the impact.
tests: pass
who: user
impact: ReqProc: update`;
    const result = validateCommitMsg(msg, { changedFileCount: 4 });
    if (!result.success) console.log("ERRORS:", result.errors);
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("fails if description is too short for number of files (Density Threshold)", () => {
    const msg = `feat: sparse description

what: fixed it
rationale: because
tests: pass
who: user
impact: ReqProc: update`;
    // 5 words per file requirement. 10 files = 50 words required.
    // "fixed it because" = 3 words.
    const result = validateCommitMsg(msg, { changedFileCount: 10 });
    assertEquals(result.success, false);
    assertEquals(
      result.errors.some((e: string) => e.toLowerCase().includes("detail") || e.toLowerCase().includes("word")),
      true,
    );
  });

  it("caps the density requirement at 50 words", () => {
    const msg = `feat: large commit but reasonable length

what:
- This is a reasonably long description for ReqProc that should satisfy the cap even if many files are changed.
- We want to ensure that it explains the changes across all components touched in the workspace effectively without being an essay.
rationale: The rationale is also provided here to ensure we meet the word count requirement across both sections. We are explaining the why and the how in enough detail for the ReqProc update.
tests: pass
who: user
impact: ReqProc: update`;
    // ~50 words. If 20 files changed, it should still pass because of the cap.
    const result = validateCommitMsg(msg, { changedFileCount: 20 });
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("passes when impact has trailing plain-text clause after semicolon (no spurious component)", () => {
    // Regression: "CompA: details; plain sentence." must not parse "plain sentence." as a component name.
    const msg = `feat: regression trap B

what: updated ReqProc to handle new validation rules for better coverage
rationale: to fix an edge case
tests: pass
who: user
impact: ReqProc: added validation logic; no runtime changes.`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("still enforces component traceability when multiple real components are listed", () => {
    // "CompA: details; CompB: details" — both components must appear in what.
    const msg = `feat: multi-component impact

what: updated ReqProc rules
rationale: to fix an edge case
tests: pass
who: user
impact: ReqProc: added validation; EventLogger: added audit entry`;
    const result = validateCommitMsg(msg);
    // "EventLogger" is not in what: → should fail
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e: string) => e.includes("EventLogger")), true);
  });
});
