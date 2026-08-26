/**
 * @module CheckCommitMsgTest
 * @path tests/scripts/check_commit_msg_test.ts
 * @description Unit tests for the check_commit_msg.ts script.
 * Verifies validation logic for structured commit messages, including
 * mandatory fields, impact grounding, and provider/model validation.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  gitOut,
  parseLedgerSymbols,
  parsePlanField,
  parsePlanStep,
  validateCommitMsg,
  validatePlanStepDiff,
} from "../../scripts/check_commit_msg.ts";

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

  it("does not misparse a colon-containing body line as a new field (regression: Phase 166 commit-msg drafting hit this with 'Corrects:'/'check:style' body lines, silently truncating the 'what:' field and breaking Component Traceability)", () => {
    const msg = `fix(ai): correct default model

what: Phase 166's Gate found the default codex-cli model was wrong.
Corrects: packages/ai-clidelegate/src/constants.ts default codex model.
Component AI is fixed to a ChatGPT-account-compatible model.
rationale: the old default failed for every real subscription user.
tests: full suite passing, 202/202.
who: Claude
impact: AI: corrected default model, no other providers affected`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true, result.errors?.join(", "));
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

  it("skips validation for GitHub pull-request merge commits", () => {
    // Regression: GitHub's default "Merge pull request" button message (distinct
    // from git CLI's "Merge branch" local-merge default) was not exempted, so any
    // PR merged via the GitHub UI/API failed CI's Gate 0 with no way for the author
    // to have written a structured message - GitHub, not a human or agent, writes it.
    const msg = `Merge pull request #8 from dostark/copilot/fix-sequential-test-suite`;
    const result = validateCommitMsg(msg);
    assertEquals(result.success, true);
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

// ── Plan-step traceability (path: <doc>#<step>) ──────────────────────────────

// style-exclude:FIXTURE_READABILITY - Compact plan-doc excerpt kept inline for step-parsing test clarity
const PLAN_DOC = `## Implementation Plan

### Step 5: Something earlier

**Planned Tests**:

- ✅ \`earlier test\` → \`packages/x/tests/earlier_test.ts\`

**Success Criteria**:

- ✅ earlier criterion → \`packages/x/src/earlier.ts\`

### Step 6: Solo curation CLI

**Planned Tests**:

- ✅ \`config model writes candidates\` → \`apps/exactl/tests/model_commands_test.ts\`
- ✅ Integration: \`loop honoured\` → \`tests/integration/model_curation_cli_loop_test.ts\`

**Success Criteria**:

- ✅ Full curation loop → \`apps/exactl/src/commands/model_commands.ts\`
- ✅ Registry wired → \`apps/exactl/src/init.ts\`, \`apps/exactl/src/exactl.ts\`

\`\`\`yaml
# step-manifest
step: 6
\`\`\`

### Step 7: Terminal

**Success Criteria**:

- ✅ later criterion → \`tests/scenario/x_test.ts\`
`;

describe("parsePlanField", () => {
  it("extracts the doc path and step number from a plan: field", () => {
    const msg = `feat: x (Step 6)

what: - a\n- b
rationale: because reasons here that are long enough
tests: pass
who: user
impact: Foo: update
plan: exaix-dev-docs/planning/phase-134.md#6`;
    const ref = parsePlanField(msg);
    assertEquals(ref?.docPath, "exaix-dev-docs/planning/phase-134.md");
    assertEquals(ref?.step, 6);
  });

  it("returns undefined when no plan: field is present", () => {
    const msg = `feat: x

what: something normal here without a plan
rationale: because
tests: pass
who: user
impact: Foo: update`;
    assertEquals(parsePlanField(msg), undefined);
  });

  it("accepts '#step-6' and '#step 6' spellings", () => {
    for (const suffix of ["#step-6", "#Step6", "#6"]) {
      const msg = `feat: x\n\nwhat: a\nplan: doc.md${suffix}`;
      assertEquals(parsePlanField(msg)?.step, 6, `suffix ${suffix}`);
    }
  });
});

describe("parsePlanStep", () => {
  it("collects checked-criterion and done-test paths for the named step only", () => {
    const parsed = parsePlanStep(PLAN_DOC, 6);
    assertEquals(parsed.errors, []);
    // Only step 6 ✅ criteria + ✅ tests, deduped, not bleeding into other steps.
    assertEquals(parsed.testPaths.sort(), [
      "apps/exactl/tests/model_commands_test.ts",
      "tests/integration/model_curation_cli_loop_test.ts",
    ]);
    assertEquals(parsed.criteriaPaths.sort(), [
      "apps/exactl/src/commands/model_commands.ts",
      "apps/exactl/src/exactl.ts",
      "apps/exactl/src/init.ts",
    ]);
  });

  it("does not bleed into the next step's items", () => {
    const parsed = parsePlanStep(PLAN_DOC, 6);
    assertEquals(parsed.criteriaPaths.includes("tests/scenario/x_test.ts"), false);
    assertEquals(parsed.criteriaPaths.includes("packages/x/src/earlier.ts"), false);
  });

  it("does not bleed into a later '## ' phase-level section (e.g. Success Metrics) when the step is the doc's last '### Step'", () => {
    // style-exclude:FIXTURE_READABILITY - Compact plan-doc excerpt kept inline for step-parsing test clarity
    const planDocLastStep = `## Implementation Plan

### Step 6: Terminal, last step in the doc

**Success Criteria**:

- ✅ done criterion → \`packages/x/src/done.ts\`

## Success Metrics

- [ ] Phase-level aspirational target unrelated to Step 6
- [ ] Another phase-level target
`;
    const parsed = parsePlanStep(planDocLastStep, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/done.ts"]);
  });

  it("captures the raw ✅ item lines for diff verification", () => {
    const parsed = parsePlanStep(PLAN_DOC, 6);
    assertEquals(
      parsed.itemLines.includes("- ✅ Full curation loop → `apps/exactl/src/commands/model_commands.ts`"),
      true,
    );
    // Step 6 has 2 tests + 2 criteria = 4 item lines.
    assertEquals(parsed.itemLines.length, 4);
  });

  it("errors when a ✅ criterion is missing its → path", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ a criterion with no path here
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.length >= 1, true);
    assertEquals(parsed.errors.some((e) => e.toLowerCase().includes("path")), true);
  });

  it("errors when the step is not found in the doc", () => {
    const parsed = parsePlanStep(PLAN_DOC, 99);
    assertEquals(parsed.errors.some((e) => e.includes("Step 99")), true);
  });

  it("errors on any remaining unchecked '- [ ]' criterion (no unimplemented escape hatch)", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ done → \`packages/x/src/a.ts\`
- [ ] still unimplemented criterion
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.includes("[ ]") || e.toLowerCase().includes("unchecked")), true);
  });

  it("errors on any remaining unchecked '- [ ]' planned test", () => {
    const doc = `### Step 6: x

**Planned Tests**:

- ✅ \`done test\` → \`packages/x/tests/a_test.ts\`
- [ ] \`not written yet\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.includes("[ ]") || e.toLowerCase().includes("unchecked")), true);
  });

  it("errors when a ✅ criterion's → path is not backtick-wrapped (check:md-path parity)", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ bare path criterion → packages/x/src/a.ts
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.toLowerCase().includes("backtick")), true);
    // A bare (un-backticked) path is not accepted as a valid source path.
    assertEquals(parsed.criteriaPaths, []);
  });

  it("accepts a backtick-wrapped → path and strips the backticks", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ good criterion → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/a.ts"]);
  });

  it("accepts the repo's dominant heading convention — colon INSIDE the closing ** (e.g. `**Success Criteria:**`, `**Planned Tests:**`) — not just colon-after (regression: 104/113 files under exaix-dev-docs/planning/ use colon-inside, but the section-entry regex previously required an exact `**Success Criteria**` prefix and silently never entered the section for colon-inside docs)", () => {
    const doc = `### Step 6: x

**Planned Tests:**

- ✅ \`a test\` → \`packages/x/tests/a_test.ts\`

**Success Criteria:**

- ✅ a criterion → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.testPaths, ["packages/x/tests/a_test.ts"]);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/a.ts"]);
  });

  it("still rejects an unchecked '- [ ]' criterion under the colon-inside heading convention", () => {
    const doc = `### Step 6: x

**Success Criteria:**

- ✅ done → \`packages/x/src/a.ts\`
- [ ] still unimplemented criterion
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.includes("[ ]") || e.toLowerCase().includes("unchecked")), true);
  });

  it("accepts a leading '- ' bullet before the bold heading (e.g. `- **Success Criteria**:`, `- **Planned Tests**:`) — a real, minority-but-live convention used by 13 files under exaix-dev-docs/planning/ including phase-112, 106, 107, 111, 113, and 170 (regression: the section-entry regex required the line to START with `**`, so it silently never entered the section — criteriaPaths/testPaths came back empty and the changed-file traceability cross-check became a no-op for every step in these docs)", () => {
    const doc = `### Step 6: x

- **Planned Tests**:

- ✅ \`a test\` → \`packages/x/tests/a_test.ts\`

- **Success Criteria**:

- ✅ a criterion → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.testPaths, ["packages/x/tests/a_test.ts"]);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/a.ts"]);
  });

  it("also accepts the leading-dash bullet combined with colon-inside (`- **Success Criteria:**`)", () => {
    const doc = `### Step 6: x

- **Success Criteria:**

- ✅ a criterion → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/a.ts"]);
  });

  it("still rejects an unchecked '- [ ]' criterion under the leading-dash heading convention", () => {
    const doc = `### Step 6: x

- **Success Criteria**:

- ✅ done → \`packages/x/src/a.ts\`
- [ ] still unimplemented criterion
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.includes("[ ]") || e.toLowerCase().includes("unchecked")), true);
  });

  it("joins a Success Criteria bullet soft-wrapped across multiple lines before matching its → path", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ Every provider/CLI that reports a reasoning/thinking-token breakdown (Anthropic, OpenAI,
  Google, OpenRouter) surfaces it on \`IGenerateResult.usage.reasoningTokens\`, never silently
  discarded → \`packages/ai/src/provider_common_utils.ts\`, \`packages/session/src/delegate_return_parser.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths.sort(), [
      "packages/ai/src/provider_common_utils.ts",
      "packages/session/src/delegate_return_parser.ts",
    ]);
  });

  it("joins a Planned Tests bullet soft-wrapped across multiple lines before matching its → path", () => {
    const doc = `### Step 6: x

**Planned Tests**:

- ✅ A long test description that keeps going and going across a couple of
  wrapped lines before reaching its own path → \`packages/x/tests/long_test.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.testPaths, ["packages/x/tests/long_test.ts"]);
  });

  it("does not swallow the next bullet's line into the previous wrapped bullet", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ First criterion wraps across
  two lines → \`packages/x/src/a.ts\`
- ✅ Second criterion → \`packages/x/src/b.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths.sort(), ["packages/x/src/a.ts", "packages/x/src/b.ts"]);
  });

  it("stops a wrapped bullet's continuation at the next bold heading", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ A criterion whose text wraps
  right up to the next heading → \`packages/x/src/a.ts\`

**Architecture Notes**:

More prose here that must never be treated as part of the criterion above.
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths, ["packages/x/src/a.ts"]);
  });

  it("captures each physical line of a wrapped ✅ item individually in itemLines (for per-diff-line traceability)", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ First line of a wrapped criterion
  second continuation line → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.itemLines, [
      "- ✅ First line of a wrapped criterion",
      "second continuation line → `packages/x/src/a.ts`",
    ]);
  });

  it("still rejects a wrapped unchecked '- [ ]' criterion (no unimplemented escape hatch)", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- [ ] An unchecked criterion whose explanation
  wraps across a continuation line too
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.includes("[ ]") || e.toLowerCase().includes("unchecked")), true);
  });
});

// A plan whose step 6 has a ✅ item AND a ⚠️ deferred item, plus a Reachability Ledger.
// style-exclude:FIXTURE_READABILITY - Compact plan-doc excerpt kept inline for deferred-parsing test clarity
const PLAN_DOC_DEFERRED = `## Implementation Plan

### Step 6: With a deferral

**Success Criteria**:

- ✅ Done criterion → \`apps/exactl/src/commands/model_commands.ts\`
- ⚠️ deferred Team live registry wiring → IModelRegistryProvider

## Reachability Ledger (pending production consumers)

| Symbol                   | Added in | Wiring step | Production call-site | Status |
| ------------------------ | -------- | ----------- | -------------------- | ------ |
| \`IModelRegistryProvider\` | Step 5   | 135 Step 1  | apps/daemon/main.ts  | ⏳     |
`;

describe("parsePlanStep deferred items", () => {
  it("collects ⚠️ deferred tokens separately from ✅ done paths", () => {
    const parsed = parsePlanStep(PLAN_DOC_DEFERRED, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.criteriaPaths, ["apps/exactl/src/commands/model_commands.ts"]);
    assertEquals(parsed.deferredTokens, ["IModelRegistryProvider"]);
  });

  it("errors when a ⚠️ deferred line has no → ledger token", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ⚠️ deferred something with no arrow token
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors.some((e) => e.toLowerCase().includes("deferred")), true);
  });

  it("joins a ⚠️ deferred item soft-wrapped across multiple lines before matching its → token", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ⚠️ deferred A long deferred criterion whose explanation wraps across a
  second line before naming its ledger token → IModelRegistryProvider
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    assertEquals(parsed.deferredTokens, ["IModelRegistryProvider"]);
  });
});

describe("parseLedgerSymbols", () => {
  it("extracts the backtick-wrapped Symbol column from Reachability Ledger rows", () => {
    const symbols = parseLedgerSymbols(PLAN_DOC_DEFERRED);
    assertEquals(symbols, ["IModelRegistryProvider"]);
  });

  it("returns [] when there is no ledger table", () => {
    assertEquals(parseLedgerSymbols(PLAN_DOC), []);
  });
});

describe("validateCommitMsg plan-step traceability", () => {
  const baseMsg = `feat: implement step 6 (Step 6)

what:
- add ModelCommands to expose the curation and display subcommands to users
- wire the DefaultModelRegistry into the CLI init path and command registration
rationale: closes the Solo curation loop so humans steer the resolver candidate authority
  without hand-editing TOML, with enough detail across sections to satisfy the density gate
tests: model_commands_test 10/10 and one integration test green
who: user
impact: ModelCommands: curation surface
plan: exaix-dev-docs/planning/phase-134.md#6`;

  it("passes when every checked criterion + done test path is in the changed files", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: [
          "apps/exactl/src/commands/model_commands.ts",
          "apps/exactl/src/init.ts",
          "apps/exactl/src/exactl.ts",
        ],
        testPaths: [
          "apps/exactl/tests/model_commands_test.ts",
          "tests/integration/model_curation_cli_loop_test.ts",
        ],
        planErrors: [],
        changedFiles: [
          "apps/exactl/src/commands/model_commands.ts",
          "apps/exactl/src/init.ts",
          "apps/exactl/src/exactl.ts",
          "apps/exactl/tests/model_commands_test.ts",
          "tests/integration/model_curation_cli_loop_test.ts",
          "exaix-dev-docs/planning/phase-134.md",
        ],
      },
    });
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("blocks when a criterion's source module is NOT among the changed files", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: ["apps/exactl/tests/model_commands_test.ts"],
        planErrors: [],
        changedFiles: [
          // model_commands.ts is MISSING → the criterion is unfairly claimed
          "apps/exactl/tests/model_commands_test.ts",
        ],
      },
    });
    assertEquals(result.success, false);
    assertEquals(
      result.errors.some((e) => e.includes("model_commands.ts") && e.toLowerCase().includes("criteri")),
      true,
    );
  });

  it("blocks when a planned test's module is NOT among the changed files", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: ["apps/exactl/tests/model_commands_test.ts"],
        planErrors: [],
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"], // test file missing
      },
    });
    assertEquals(result.success, false);
    assertEquals(
      result.errors.some((e) => e.includes("model_commands_test.ts") && e.toLowerCase().includes("test")),
      true,
    );
  });

  it("surfaces plan-parse errors (e.g. missing path on a checked criterion)", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: [],
        testPaths: [],
        planErrors: ['Step 6 criterion "foo" is marked ✅ but has no → source path.'],
        changedFiles: ["exaix-dev-docs/planning/phase-134.md"],
      },
    });
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e) => e.includes("no → source path")), true);
  });

  it("does not run plan-step checks when planValidation is absent (normal commits)", () => {
    const msg = `feat: normal change

what: updated ReqProc to handle validation with adequate detail for density
rationale: to fix a bug in the flow that needed addressing thoroughly here
tests: pass
who: user
impact: ReqProc: update`;
    const result = validateCommitMsg(msg, { changedFileCount: 1 });
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("passes a deferred item when its token has a Reachability Ledger row (no changed-file check)", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: [],
        deferredTokens: ["IModelRegistryProvider"],
        ledgerSymbols: ["IModelRegistryProvider"],
        planErrors: [],
        // Note: the deferred token is NOT a changed file — that's fine for deferred items.
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"],
      },
    });
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("blocks a deferred item whose token is NOT in the Reachability Ledger", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: [],
        deferredTokens: ["IModelRegistryProvider"],
        ledgerSymbols: [], // ledger row missing → deferral is untracked → block
        planErrors: [],
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"],
      },
    });
    assertEquals(result.success, false);
    assertEquals(
      result.errors.some((e) => e.includes("IModelRegistryProvider") && e.toLowerCase().includes("ledger")),
      true,
    );
  });

  it("integrates the diff/sync facet: blocks a stale item line via planValidation", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: [],
        planErrors: [],
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"],
        // Diff facet inputs: the item line is NOT among the plan doc's added lines.
        itemLines: ["- ✅ Full loop → `apps/exactl/src/commands/model_commands.ts`"],
        addedPlanLines: ["some unrelated added line"],
        planSync: "in_sync",
      },
    });
    assertEquals(result.success, false);
    assertEquals(result.errors.some((e) => e.includes("not an added line")), true);
  });

  it("integrates the diff/sync facet: passes when item lines are added and in sync", () => {
    const line = "- ✅ Full loop → `apps/exactl/src/commands/model_commands.ts`";
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: [],
        planErrors: [],
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"],
        itemLines: [line],
        addedPlanLines: [line, "other added line"],
        planSync: "in_sync",
      },
    });
    assertEquals(result.success, true, result.errors?.join(", "));
  });

  it("skips the diff/sync facet when its inputs are absent (path facet still runs)", () => {
    const result = validateCommitMsg(baseMsg, {
      changedFileCount: 6,
      planValidation: {
        criteriaPaths: ["apps/exactl/src/commands/model_commands.ts"],
        testPaths: [],
        planErrors: [],
        changedFiles: ["apps/exactl/src/commands/model_commands.ts"],
        // No itemLines/addedPlanLines/planSync → diff facet skipped.
      },
    });
    assertEquals(result.success, true, result.errors?.join(", "));
  });
});

describe("validatePlanStepDiff", () => {
  const items = [
    "- ✅ Full curation loop → `apps/exactl/src/commands/model_commands.ts`",
    "- ✅ Registry wired → `apps/exactl/src/init.ts`, `apps/exactl/src/exactl.ts`",
  ];

  it("passes when every item line is an added diff line and the pointer is in sync", () => {
    const added = [
      "- ✅ Full curation loop → `apps/exactl/src/commands/model_commands.ts`",
      "- ✅ Registry wired → `apps/exactl/src/init.ts`, `apps/exactl/src/exactl.ts`",
      "some other added prose line",
    ];
    const result = validatePlanStepDiff(items, added, "in_sync");
    assertEquals(result.ok, true, result.errors.join(", "));
  });

  it("blocks when an item line is not among the plan doc's added diff lines (stale mark)", () => {
    // Only the first item was actually changed in this commit's plan diff.
    const added = ["- ✅ Full curation loop → `apps/exactl/src/commands/model_commands.ts`"];
    const result = validatePlanStepDiff(items, added, "in_sync");
    assertEquals(result.ok, false);
    assertEquals(result.errors.some((e) => e.includes("Registry wired") && e.includes("not an added line")), true);
  });

  it("blocks and asks to roll back the submodule when the pointer is out of sync", () => {
    const added = items.slice();
    const result = validatePlanStepDiff(items, added, "out_of_sync");
    assertEquals(result.ok, false);
    assertEquals(
      result.errors.some((e) => e.toLowerCase().includes("roll back") && e.toLowerCase().includes("sync")),
      true,
    );
  });

  it("blocks and asks to roll back when the plan diff is unresolvable (unknown)", () => {
    const result = validatePlanStepDiff(items, [], "unknown");
    assertEquals(result.ok, false);
    assertEquals(result.errors.some((e) => e.toLowerCase().includes("roll back")), true);
  });
});

describe("parsePlanStep + validatePlanStepDiff integration (wrapped bullets)", () => {
  it("accepts a wrapped bullet's itemLines against per-physical-line added diff lines", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ First line of a wrapped criterion
  second continuation line → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    assertEquals(parsed.errors, []);
    const added = [
      "- ✅ First line of a wrapped criterion",
      "second continuation line → `packages/x/src/a.ts`",
    ];
    const result = validatePlanStepDiff(parsed.itemLines, added, "in_sync");
    assertEquals(result.ok, true, result.errors.join(", "));
  });

  it("still flags a stale wrapped bullet whose continuation line was not actually added in this commit's diff", () => {
    const doc = `### Step 6: x

**Success Criteria**:

- ✅ First line of a wrapped criterion
  second continuation line → \`packages/x/src/a.ts\`
`;
    const parsed = parsePlanStep(doc, 6);
    // Only the first physical line shows up as added — the continuation line is stale.
    const added = ["- ✅ First line of a wrapped criterion"];
    const result = validatePlanStepDiff(parsed.itemLines, added, "in_sync");
    assertEquals(result.ok, false);
    assertEquals(result.errors.some((e) => e.includes("not an added line")), true);
  });
});

// ── Cross-repo git resolution under an inherited hook environment ────────────

describe("gitOut", () => {
  it("ignores inherited GIT_DIR/GIT_INDEX_FILE/GIT_PREFIX when running a cross-repo -C command", async () => {
    // Reproduces the live failure: git sets GIT_DIR/GIT_INDEX_FILE/GIT_PREFIX for every
    // hook subprocess (verified live via a real commit-msg hook trigger in a worktree
    // checkout). Without sanitization, a nested `git -C <submodule> diff HEAD~1 HEAD`
    // silently resolves against the INHERITED (wrong) repo instead of <submodule>,
    // returning an empty diff — which made every plan-step ✅/deferred item look "not an
    // added line" and blocked the commit. gitOut must produce the correct, non-empty
    // result regardless of what GIT_* vars the calling process inherited.
    const repoDir = await Deno.makeTempDir();
    try {
      const run = (args: string[]) =>
        new Deno.Command("git", { args, cwd: repoDir, env: { LD_LIBRARY_PATH: "" } }).output();
      await run(["init", "-q"]);
      await run(["config", "user.email", "test@example.com"]);
      await run(["config", "user.name", "Test"]);
      await Deno.writeTextFile(`${repoDir}/file.txt`, "line one\n");
      await run(["add", "file.txt"]);
      await run(["commit", "-q", "-m", "first"]);
      await Deno.writeTextFile(`${repoDir}/file.txt`, "line one\nline two\n");
      await run(["add", "file.txt"]);
      await run(["commit", "-q", "-m", "second"]);

      const baseline = await gitOut(["diff", "HEAD~1", "HEAD", "--unified=0", "--", "file.txt"], repoDir);
      assertEquals(baseline.includes("+line two"), true, "sanity: baseline diff must be non-empty");

      // Simulate git's own hook environment: GIT_DIR/GIT_INDEX_FILE/GIT_PREFIX pointing at
      // an unrelated bogus location, exactly as a real commit-msg hook inherits them.
      const otherRepo = await Deno.makeTempDir();
      try {
        Deno.env.set("GIT_DIR", `${otherRepo}/.git`);
        Deno.env.set("GIT_INDEX_FILE", `${otherRepo}/.git/index`);
        Deno.env.set("GIT_PREFIX", "");
        try {
          const underPoisonedEnv = await gitOut(
            ["diff", "HEAD~1", "HEAD", "--unified=0", "--", "file.txt"],
            repoDir,
          );
          assertEquals(underPoisonedEnv, baseline);
          assertEquals(underPoisonedEnv.includes("+line two"), true);
        } finally {
          Deno.env.delete("GIT_DIR");
          Deno.env.delete("GIT_INDEX_FILE");
          Deno.env.delete("GIT_PREFIX");
        }
      } finally {
        await Deno.remove(otherRepo, { recursive: true });
      }
    } finally {
      await Deno.remove(repoDir, { recursive: true });
    }
  });
});
