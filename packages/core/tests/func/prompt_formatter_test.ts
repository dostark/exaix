/**
 * @module PromptFormatterTest
 * @path packages/core/tests/func/prompt_formatter_test.ts
 * @description Phase 196 Step 7 — tests for the `examples`-aware, trimmed-mode-honoring
 *   behavior of `renderSkillsSection`/`renderCriticalSkillsSection`: an ordinary skill's
 *   `examples` content is included by default and omitted under `trimmed: true`;
 *   `renderCriticalSkillsSection` always includes `examples` when present, regardless of
 *   the `trimmed` flag it doesn't accept.
 * @architectural-layer Test
 * @related-files [packages/core/src/func/prompt_formatter.ts, packages/core/src/types/prompt_context.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import type { ISkillsContext } from "@exaix/core/types";

function makeContext(overrides: Partial<ISkillsContext["matched"][number]> = {}): ISkillsContext {
  return {
    matched: [
      {
        skillId: crypto.randomUUID(),
        title: "Test Skill",
        description: "A test skill.",
        content: "Do the thing.",
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

Deno.test("[renderSkillsSection] includes examples by default (full mode)", () => {
  const ctx = makeContext({ examples: "Example content here." });
  const output = renderSkillsSection(ctx);
  assertStringIncludes(output, "**Examples:**");
  assertStringIncludes(output, "Example content here.");
});

Deno.test("[renderSkillsSection] omits examples when trimmed is true", () => {
  const ctx = makeContext({ examples: "Example content here." });
  const output = renderSkillsSection(ctx, true);
  assert(!output.includes("**Examples:**"));
  assert(!output.includes("Example content here."));
});

Deno.test("[renderSkillsSection] a skill with no examples renders identically regardless of trimmed", () => {
  const ctx = makeContext();
  assertEquals(renderSkillsSection(ctx, false), renderSkillsSection(ctx, true));
});

Deno.test("[renderCriticalSkillsSection] always includes examples, ignoring any trimmed intent", () => {
  const ctx = makeContext({ critical: true, examples: "Critical example content." });
  const output = renderCriticalSkillsSection(ctx);
  assertStringIncludes(output, "**Examples:**");
  assertStringIncludes(output, "Critical example content.");
});
