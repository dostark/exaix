/**
 * @module PromptFormatterTest
 * @path packages/core/tests/func/prompt_formatter_test.ts
 * @description Phase 196 Step 7/14 — tests for the `examples`-aware, trimmed-mode-honoring
 *   behavior of `renderSkillsSection`/`renderCriticalSkillsSection`. `instructions` carry
 *   the full skill body byte-identically (ordering is a compatibility contract), so full
 *   mode is verbatim and `trimmed: true` *strips* the `## Examples` section; critical
 *   skills are always rendered in full.
 * @architectural-layer Test
 * @related-files [packages/core/src/func/prompt_formatter.ts, packages/core/src/func/skill_body.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import type { ISkillsContext } from "@exaix/core/types";

function makeContext(overrides: Partial<ISkillsContext["matched"][number]> = {}): ISkillsContext {
  return {
    matched: [
      {
        skillId: crypto.randomUUID(),
        title: "Test Skill",
        description: "A test skill.",
        content: "Do the thing.\n\n## Examples\n\nExample content here.\n\n## Later\n\nKept in order.",
        matchScore: 0.9,
        tags: [],
        critical: false,
        ...overrides,
      },
    ],
    totalAvailable: 1,
    retrievalLatencyMs: 0,
  };
}

Deno.test("[renderSkillsSection] full mode keeps the Examples section in its authored position (byte-identical body)", () => {
  const ctx = makeContext();
  const output = renderSkillsSection(ctx);
  assert(output.includes("## Examples"), "full mode must keep the Examples heading in place");
  assert(output.includes("Example content here."), "full mode must include examples content");
  assert(output.includes("## Later\n\nKept in order."), "content after Examples stays after it");
  assert(
    output.indexOf("## Examples") < output.indexOf("## Later"),
    "Examples must precede the Later section in full mode (original ordering preserved)",
  );
});

Deno.test("[renderSkillsSection] trimmed mode strips the Examples section but keeps surrounding content in order", () => {
  const ctx = makeContext();
  const output = renderSkillsSection(ctx, true);
  assert(!output.includes("## Examples"), "trimmed mode must remove the Examples heading");
  assert(!output.includes("Example content here."), "trimmed mode must remove examples content");
  assert(output.includes("Do the thing."), "content before Examples survives");
  assert(output.includes("## Later\n\nKept in order."), "content after Examples survives");
  assert(
    output.indexOf("## Later") > output.indexOf("Do the thing."),
    "surrounding sections keep their relative order in trimmed mode",
  );
});

Deno.test("[renderSkillsSection] a skill with no Examples section renders identically regardless of trimmed", () => {
  const ctx = makeContext({ content: "Do the thing only." });
  assertEquals(renderSkillsSection(ctx, false), renderSkillsSection(ctx, true));
});

Deno.test("[renderCriticalSkillsSection] always renders the full body including Examples, ignoring any trimmed intent", () => {
  const ctx = makeContext({ critical: true });
  const output = renderCriticalSkillsSection(ctx);
  assert(output.includes("## Examples"), "critical skills render their Examples section in full");
  assert(output.includes("Example content here."), "critical skill examples content must survive");
});
