/**
 * @module PromptFormatterReferencesTest
 * @path packages/core/tests/func/prompt_formatter_references_test.ts
 * @description Linked reference files render after the skill body in full and critical blocks, in sorted
 *   path order under a fixed heading. Trimmed mode drops them, unlinked files never render, and a skill
 *   without references keeps its block byte for byte.
 * @architectural-layer Test
 * @related-files [packages/core/src/func/prompt_formatter.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderCriticalSkillsSection, renderSkillEntry, renderSkillsSection } from "@exaix/core/func";
import type { ISkillsContext } from "@exaix/core/types";
import { skillMatchFixture } from "@exaix/testing";

const REFERENCES = [
  { path: "references/zeta.md", content: "Zeta text.", linked: true },
  { path: "references/alpha.md", content: "Alpha text.", linked: true },
  { path: "references/unlinked.md", content: "Never rendered.", linked: false },
];

function contextOf(overrides: Partial<ISkillsContext["matched"][number]> = {}): ISkillsContext {
  return {
    matched: [skillMatchFixture({ name: "Ref Skill", description: "Has references.", content: "Body.", ...overrides })],
    totalAvailable: 1,
    retrievalLatencyMs: 0,
  };
}

Deno.test("[render] full mode appends linked references in sorted path order and skips unlinked ones", () => {
  const output = renderSkillsSection(contextOf({ references: REFERENCES }));
  const alpha = output.indexOf("##### Reference: references/alpha.md\nAlpha text.");
  const zeta = output.indexOf("##### Reference: references/zeta.md\nZeta text.");
  assertEquals(alpha > output.indexOf("Body."), true);
  assertEquals(zeta > alpha, true);
  assertEquals(output.includes("Never rendered."), false);
});

Deno.test("[render] trimmed mode drops the references and the examples", () => {
  const output = renderSkillsSection(
    contextOf({ references: REFERENCES, content: "Body.\n\n## Examples\n\nExample." }),
    true,
  );
  assertEquals(output.includes("Reference:"), false);
  assertEquals(output.includes("Example."), false);
  assertStringIncludes(output, "Body.");
});

Deno.test("[render] a critical skill appends its references even in the protected block", () => {
  const output = renderCriticalSkillsSection(contextOf({ critical: true, references: REFERENCES }));
  assertStringIncludes(output, "##### Reference: references/alpha.md\nAlpha text.");
  assertStringIncludes(output, "##### Reference: references/zeta.md\nZeta text.");
});

Deno.test("[render] the block of a skill without references is unchanged", () => {
  const withNone = renderSkillEntry(contextOf().matched[0], true);
  assertEquals(withNone, "#### Ref Skill\nHas references.\n\n**Instructions:**\nBody.\n\n");
  const withUnlinkedOnly = renderSkillEntry(
    contextOf({ references: [REFERENCES[2]] }).matched[0],
    true,
  );
  assertEquals(withUnlinkedOnly, withNone);
});
