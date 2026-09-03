/**
 * @module PhaseStepManifestParserTest
 * @path packages/flow/tests/phase_step_manifest_parser_test.ts
 * @description Unit tests for the package-pure phase-step manifest parser extracted
 *   from scripts/plan_to_requests.ts (Phase 174 Step 2).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/phase_step_manifest_parser.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parsePhaseStepManifests } from "../src/phase_step_manifest_parser.ts";

// style-exclude:FIXTURE_READABILITY - a realistic two-step manifest doc is the input under test
const VALID_MANIFEST_PLAN = `# Phase Doc

## Step 1

Some text.

\`\`\`yaml
# step-manifest
step: 1
title: First step
agent_role: senior-coder
\`\`\`

## Step 2

More text.

\`\`\`yaml
# step-manifest
step: 2
title: Second step
\`\`\`
`;

Deno.test("[unit] preserves manifest order and content for a well-formed plan with zero diagnostics", () => {
  const result = parsePhaseStepManifests(VALID_MANIFEST_PLAN);
  assertEquals(result.diagnostics, []);
  assertEquals(result.steps.length, 2);
  assertEquals(result.steps[0].stepNumber, 1);
  assertEquals(result.steps[0].manifest?.title, "First step");
  assertEquals(result.steps[1].stepNumber, 2);
  assertEquals(result.steps[1].manifest?.title, "Second step");
  assertStringIncludes(result.steps[0].sectionText, "Some text.");
  assertStringIncludes(result.steps[1].sectionText, "More text.");
});

Deno.test("[unit] fatal-shaped inputs (no steps, duplicates) return diagnostics instead of throwing or exiting", () => {
  const noSteps = parsePhaseStepManifests("no steps here at all");
  assertEquals(noSteps.diagnostics[0].code, "no_steps");

  const duplicate = parsePhaseStepManifests("## Step 1\ntext\n## Step 1\nduplicate");
  assertEquals(duplicate.diagnostics.some((d) => d.code === "duplicate_step_number"), true);
});

Deno.test("[unit] reports no_steps when the document has no step headings", () => {
  const result = parsePhaseStepManifests("# Just a title\n\nNo headings here.");
  assertEquals(result.steps, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "no_steps");
});

Deno.test("[unit] reports duplicate_step_number for a repeated heading number", () => {
  const result = parsePhaseStepManifests("## Step 1\nfirst\n## Step 1\nsecond\n");
  const dupe = result.diagnostics.find((d) => d.code === "duplicate_step_number");
  assertEquals(dupe?.stepNumber, 1);
});

Deno.test("[unit] reports non_contiguous_step_number when a step number is skipped", () => {
  const result = parsePhaseStepManifests("## Step 1\nfirst\n## Step 3\nthird\n");
  const gap = result.diagnostics.find((d) => d.code === "non_contiguous_step_number");
  assertEquals(gap?.stepNumber, 3);
});

Deno.test("[unit] reports missing_manifest when a step has no fenced step-manifest block", () => {
  const result = parsePhaseStepManifests("## Step 1\nplain text, no yaml block\n");
  assertEquals(result.steps[0].manifest, null);
  const diag = result.diagnostics.find((d) => d.code === "missing_manifest");
  assertEquals(diag?.stepNumber, 1);
});

Deno.test("[unit] reports invalid_manifest_yaml on unparsable YAML", () => {
  const result = parsePhaseStepManifests("## Step 1\n```yaml\n# step-manifest\nstep: [1, 2\n```\n");
  assertEquals(result.steps[0].manifest, null);
  const diag = result.diagnostics.find((d) => d.code === "invalid_manifest_yaml");
  assertEquals(diag?.stepNumber, 1);
});

Deno.test("[unit] reports invalid_manifest_schema when the manifest fails StepManifestSchema", () => {
  const result = parsePhaseStepManifests("## Step 1\n```yaml\n# step-manifest\nstep: -1\ntitle: bad\n```\n");
  assertEquals(result.steps[0].manifest, null);
  const diag = result.diagnostics.find((d) => d.code === "invalid_manifest_schema");
  assertEquals(diag?.stepNumber, 1);
});

Deno.test("[unit] reports missing_step_heading when a manifest's step number disagrees with its heading", () => {
  const result = parsePhaseStepManifests("## Step 1\n```yaml\n# step-manifest\nstep: 2\ntitle: mismatched\n```\n");
  assertEquals(result.steps[0].manifest?.title, "mismatched");
  const diag = result.diagnostics.find((d) => d.code === "missing_step_heading");
  assertEquals(diag?.stepNumber, 1);
});

Deno.test("[unit] sorts sections by step number regardless of document order", () => {
  const result = parsePhaseStepManifests("## Step 2\nsecond\n## Step 1\nfirst\n");
  assertEquals(result.steps.map((s) => s.stepNumber), [1, 2]);
});
