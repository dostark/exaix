/**
 * @module MemoryFormatterSkillSanitizeTest
 * @path packages/cli/tests/formatters/memory_formatter_skill_sanitize_test.ts
 * @description Skill output that reaches a terminal carries no control byte. A skill written by another harness
 *   or learned from a run can hold escape sequences in any field, and an operator reads exactly that text while
 *   deciding to approve it. Tab and newline stay, and the text of the skill is otherwise unchanged.
 * @architectural-layer Test
 * @related-files [packages/cli/src/formatters/memory_formatter.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import { runtimeSkillFixture } from "@exaix/testing";

const OSC = "\x1b]0;pwned\x07";
const CSI = "\x1b[2J";
const HOSTILE = `before ${OSC}${CSI} after\tkept\nnext line`;
// deno-lint-ignore no-control-regex
const CONTROL_BYTE = /[\x00-\x08\x0B-\x1F\x7F]/;

function hostileSkill() {
  return runtimeSkillFixture({
    title: `Title${CSI}`,
    description: `Description ${OSC}`,
    instructions: HOSTILE,
    triggers: { keywords: [`kw${CSI}`], task_types: [], file_patterns: [], tags: [`tag${OSC}`] },
  });
}

Deno.test("[skill sanitize] list, show and match renderers print no control byte", () => {
  const formatter = new MemoryFormatter();
  const skill = hostileSkill();
  const outputs = [
    formatter.formatSkillListTable([skill]),
    formatter.formatSkillListMarkdown([skill]),
    formatter.formatSkillShowTable(skill),
    formatter.formatSkillShowMarkdown(skill),
    formatter.formatSkillMatchTable([{
      skillId: `id${CSI}`,
      revisionId: skill.id,
      confidence: 1,
      triggersSource: "authored",
      matchedTriggers: { keywords: [`kw${OSC}`] },
    }]),
    formatter.formatSkillMatchMarkdown([{
      skillId: `id${CSI}`,
      revisionId: skill.id,
      confidence: 1,
      triggersSource: "authored",
      matchedTriggers: { keywords: [`kw${OSC}`] },
    }]),
  ];
  for (const output of outputs) assertEquals(CONTROL_BYTE.test(output), false, JSON.stringify(output));
});

Deno.test("[skill sanitize] history, trace and diagnostic renderers print no control byte", () => {
  const formatter = new MemoryFormatter();
  const outputs = [
    formatter.formatSkillRevisions(`name${OSC}`, [{
      revisionId: "r",
      contentSha256: "a".repeat(64),
      firstSeenAt: `t${CSI}`,
      useCount: 1,
      lastUsedAt: null,
    }]),
    formatter.formatSkillTrace(`trace${OSC}`, [{
      usedAt: "t",
      skillName: `skill${CSI}`,
      revisionId: "r",
      matchSource: "pinned",
      renderMode: "full",
      submissionKind: "provider",
      round: 1,
      attempt: 1,
      rootKind: "blueprint",
      sourcePath: `path${OSC}`,
      contentSha256: "a".repeat(64),
    }] as never),
    formatter.formatSkillDiagnostics([{
      name: `name${CSI}`,
      root_kind: "blueprint",
      safe_path: `path${OSC}`,
      reason: "invalid_frontmatter",
      severity: "error",
    }] as never),
  ];
  for (const output of outputs) assertEquals(CONTROL_BYTE.test(output), false, JSON.stringify(output));
});

Deno.test("[skill sanitize] tab, newline and the visible text survive", () => {
  const shown = new MemoryFormatter().formatSkillShowMarkdown(hostileSkill());
  assertStringIncludes(shown, "before ");
  assertStringIncludes(shown, "after\tkept\nnext line");
});
