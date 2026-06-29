/**
 * @module IdentityStructureLintTest
 * @path tests/blueprints/identity_structure_lint_test.ts
 * @description Phase 131 Step 8 — structure lint for all active identities,
 *   examples, and templates: balanced thought/content tags, terminated fences,
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
  "dogfood-coder.md",
  "mock-agent.md",
  "performance-engineer.md",
  "product-manager.md",
  "qa-engineer.md",
  "quality-judge.md",
  "security-expert.md",
  "senior-coder.md",
  "software-architect.md",
  "technical-writer.md",
  "test-engineer.md",
  "voting-judge.md",
];

const EXAMPLE_FILES = [
  "code-reviewer.md",
  "security-auditor.md",
  "feature-developer.md",
  "api-documenter.md",
  "research-synthesizer.md",
];

const TEMPLATE_FILES = [
  "pipeline-agent.md.template",
  "judge-agent.md.template",
  "reflexive-agent.md.template",
  "conversational-agent.md.template",
  "specialist-agent.md.template",
  "collaborative-agent.md.template",
  "research-agent.md.template",
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

Deno.test({
  name: "[step8] example identities pass structure lint",
  fn() {
    const allIssues: LintIssue[] = [];
    for (const f of EXAMPLE_FILES) {
      const issues = lintFile(filePath("examples", f), `examples/${f}`);
      allIssues.push(...issues);
    }
    if (allIssues.length > 0) {
      const report = allIssues
        .map((i) => `  ${i.file}: ${i.kind} — ${i.detail}`)
        .join("\n");
      assertEquals(allIssues.length, 0, `Structure lint issues found in examples:\n${report}`);
    }
  },
});

Deno.test({
  name: "[step8] template identities pass structure lint",
  fn() {
    const allIssues: LintIssue[] = [];
    for (const f of TEMPLATE_FILES) {
      const issues = lintFile(filePath("templates", f), `templates/${f}`);
      allIssues.push(...issues);
    }
    if (allIssues.length > 0) {
      const report = allIssues
        .map((i) => `  ${i.file}: ${i.kind} — ${i.detail}`)
        .join("\n");
      assertEquals(allIssues.length, 0, `Structure lint issues found in templates:\n${report}`);
    }
  },
});
