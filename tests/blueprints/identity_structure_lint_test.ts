/**
 * @module IdentityStructureLintTest
 * @path tests/blueprints/identity_structure_lint_test.ts
 * @description Phase 131 Step 8 — structure lint for all active identities,
 *   active identities: balanced thought/content tags, terminated fences,
 *   no empty numbered list markers.
 * @architectural-layer Integration
 * @dependencies [@std/path, @std/assert]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const IDENTITIES_DIR = join(REPO_ROOT, "Blueprints", "Identities");

const ACTIVE_FILES = [
  "code-analyst.md",
  "default.md",
  "dogfood-developer.md",
  "mock-agent.md",
  "performance-engineer.md",
  "product-manager.md",
  "qa-engineer.md",
  "quality-judge.md",
  "research-synthesizer.md",
  "security-expert.md",
  "senior-coder.md",
  "software-architect.md",
  "technical-writer.md",
  "test-engineer.md",
  "voting-judge.md",
];

interface LintIssue {
  file: string;
  kind: string;
  detail: string;
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    idx = text.indexOf(pattern, idx);
    if (idx === -1) break;
    count++;
    idx += pattern.length;
  }
  return count;
}

function stripFrontmatterAndFences(raw: string): string {
  const noFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n/, "");

  return noFrontmatter
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/`[^`]*`/g, "");
}

function lintFile(filePath: string, label: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const content = Deno.readTextFileSync(filePath);

  const structural = stripFrontmatterAndFences(content);

  const thoughtOpen = countOccurrences(structural, "<thought>");
  const thoughtClose = countOccurrences(structural, "</thought>");
  if (thoughtOpen !== thoughtClose) {
    issues.push({
      file: label,
      kind: "unbalanced-thought",
      detail: `<thought>: ${thoughtOpen}, </thought>: ${thoughtClose}`,
    });
  }

  const contentOpen = countOccurrences(structural, "<content>");
  const contentClose = countOccurrences(structural, "</content>");
  if (contentOpen !== contentClose) {
    issues.push({
      file: label,
      kind: "unbalanced-content",
      detail: `<content>: ${contentOpen}, </content>: ${contentClose}`,
    });
  }

  const fences = content.match(/^```/gm);
  if (fences && fences.length % 2 !== 0) {
    issues.push({
      file: label,
      kind: "unclosed-fence",
      detail: `${fences.length} backtick fences (odd — unclosed)`,
    });
  }

  const emptyMarkers = structural.match(/^\d+\.\s*$/m);
  if (emptyMarkers) {
    issues.push({
      file: label,
      kind: "empty-n-marker",
      detail: `empty numbered list markers: ${emptyMarkers.join(", ")}`,
    });
  }

  return issues;
}

function filePath(...parts: string[]): string {
  return join(IDENTITIES_DIR, ...parts);
}

Deno.test({
  name: "[step8] active identities pass structure lint (balanced tags, terminated fences, no empty markers)",
  fn() {
    const allIssues: LintIssue[] = [];
    for (const f of ACTIVE_FILES) {
      const issues = lintFile(filePath(f), f);
      allIssues.push(...issues);
    }
    if (allIssues.length > 0) {
      const report = allIssues
        .map((i) => `  ${i.file}: ${i.kind} — ${i.detail}`)
        .join("\n");
      assertEquals(allIssues.length, 0, `Structure lint issues found:\n${report}`);
    }
  },
});

// (Example and template structure-lint tests were removed in the Phase 131
// catalog reconciliation — the examples/ and templates/ directories no longer
// exist; example content was merged/promoted into concrete identities and
// templates were converted to skills.)
