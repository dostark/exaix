/**
 * @module IdentityCatalogStep7Test
 * @path tests/blueprints/identity_catalog_step7_test.ts
 * @description Phase 131 Step 7 — validates the catalog-wide skill migration.
 *   After Step 7:
 *   - every active identity has response-contract in default_skills
 *   - no {{include:standard-response-format}} or {{include:plan-schema-full}}
 *     or {{include:blueprint-best-practices}} remains under Blueprints/Identities/**
 *   - Blueprints/Fragments/ contains no contract/methodology fragments
 *     (only static boilerplate, if any; else the dir is retired)
 *   - every example and template declares default_skills incl. response-contract
 *   - every active identity body is slim (role/scope/voice, no methodology section)
 * @architectural-layer Skill (test)
 * @dependencies [@std/assert, @std/path]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const IDENTITIES_DIR = join(ROOT, "Blueprints/Identities");
const FRAGMENTS_DIR = join(ROOT, "Blueprints/Fragments");
const SKILLS_DIR = join(ROOT, "Blueprints/Skills");

const CONTRACT_FRAGMENTS = new Set([
  "standard-response-format.md",
  "plan-schema-full.md",
  "blueprint-best-practices.md",
]);

const FRAGMENT_INCLUDES = [
  "{{include:standard-response-format}}",
  "{{include:plan-schema-full}}",
  "{{include:blueprint-best-practices}}",
];

interface IFrontmatter {
  default_skills?: string[];
}

/** Extract frontmatter fields from a markdown file. */
function parseFrontmatter(filePath: string): IFrontmatter {
  const content = Deno.readTextFileSync(filePath);
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`malformed frontmatter in ${filePath}`);
  const fm: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].replace(/^["']|["']$/g, "");
    if (raw === "[]" || raw === "") {
      fm[kv[1]] = [] as string[];
    } else if (raw.startsWith("[")) {
      try {
        fm[kv[1]] = JSON.parse(raw.replace(/'/g, '"'));
      } catch {
        fm[kv[1]] = raw;
      }
    } else {
      fm[kv[1]] = raw;
    }
  }
  return { default_skills: fm.default_skills as string[] | undefined };
}

/** List all active identity files (non-example, non-template, non-README). */
function listActiveIdentityFiles(): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(IDENTITIES_DIR)) {
    if (!e.isFile || !e.name.endsWith(".md") || e.name === "README.md") continue;
    out.push(join(IDENTITIES_DIR, e.name));
  }
  return out;
}

/** Walk all files under Blueprints/Identities/** (recursive). */
function walkIdentitiesTree(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const e of Deno.readDirSync(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory) walk(p);
      else if (e.name.endsWith(".md") || e.name.endsWith(".template")) out.push(p);
    }
  }
  walk(IDENTITIES_DIR);
  return out;
}

// ─────────────────────────────────────────────
// Test 1: Every active identity has response-contract in default_skills
// ─────────────────────────────────────────────
Deno.test({
  name: "[step7] every active identity has response-contract in default_skills",
  fn() {
    const files = listActiveIdentityFiles();
    assert(files.length > 0, "no active identity files found");
    const missing: string[] = [];
    for (const fp of files) {
      const fm = parseFrontmatter(fp);
      const skills = fm.default_skills;
      if (!skills || !skills.some((s) => s === "response-contract")) {
        missing.push(fp);
      }
    }
    assertEquals(missing, [], `identities missing response-contract: ${missing.join(", ")}`);
  },
});

// ─────────────────────────────────────────────
// Test 2: No file under Blueprints/Identities/** contains a contract-fragment include
// ─────────────────────────────────────────────
Deno.test({
  name: "[step7] no identity/example/template contains a contract-fragment {{include:}}",
  fn() {
    const files = walkIdentitiesTree();
    assert(files.length > 0, "no files found under Blueprints/Identities");
    const offenders: string[] = [];
    for (const fp of files) {
      const content = Deno.readTextFileSync(fp);
      for (const inc of FRAGMENT_INCLUDES) {
        if (content.includes(inc)) {
          offenders.push(`${fp} contains ${inc}`);
        }
      }
    }
    assertEquals(offenders, [], `files still referencing retired fragments: ${offenders.join(", ")}`);
  },
});

// ─────────────────────────────────────────────
// Test 3: Blueprints/Fragments/ no longer contains contract fragments
// ─────────────────────────────────────────────
Deno.test({
  name: "[step7] Fragments/ directory no longer contains contract/methodology fragments",
  fn() {
    const remaining: string[] = [];
    for (const e of Deno.readDirSync(FRAGMENTS_DIR)) {
      if (CONTRACT_FRAGMENTS.has(e.name)) {
        remaining.push(e.name);
      }
    }
    assertEquals(remaining, [], `contract fragments still exist: ${remaining.join(", ")}`);
  },
});

// ─────────────────────────────────────────────
// Test 4: Every example/template declares default_skills incl. response-contract
// ─────────────────────────────────────────────
Deno.test({
  name: "[step7] examples and templates declare default_skills including response-contract",
  fn() {
    const subdirs = ["examples", "templates"];
    const missing: string[] = [];
    for (const sub of subdirs) {
      const dir = join(IDENTITIES_DIR, sub);
      for (const e of Deno.readDirSync(dir)) {
        if (e.name === "README.md" || !e.name.endsWith(".md") && !e.name.endsWith(".template")) continue;
        const fp = join(dir, e.name);
        const fm = parseFrontmatter(fp);
        const skills = fm.default_skills;
        if (!skills || !skills.some((s) => s === "response-contract")) {
          missing.push(fp);
        }
      }
    }
    assertEquals(missing, [], `files missing default_skills with response-contract: ${missing.join(", ")}`);
  },
});

// ─────────────────────────────────────────────
// Test 5: New skills exist on disk
// ─────────────────────────────────────────────
Deno.test({
  name:
    "[step7] new domain skills exist (verdict-rubric, architecture-review, performance-analysis, requirements-analysis, research-methodology, blueprint-best-practices)",
  fn() {
    const expected = [
      "verdict-rubric.skill.md",
      "architecture-review.skill.md",
      "performance-analysis.skill.md",
      "requirements-analysis.skill.md",
      "research-methodology.skill.md",
      "blueprint-best-practices.skill.md",
    ];
    const missing: string[] = [];
    for (const name of expected) {
      const fp = join(SKILLS_DIR, name);
      try {
        Deno.statSync(fp);
      } catch {
        missing.push(name);
      }
    }
    assertEquals(missing, [], `new skills not created: ${missing.join(", ")}`);
  },
});

// ─────────────────────────────────────────────
// Test 6: Every active identity body is slim (no methodology sections)
// ─────────────────────────────────────────────
const METHODOLOGY_HEADINGS = [
  "## Core Responsibilities",
  "## Analysis Framework",
  "## Architecture Principles",
  "## Writing Principles",
  "## Testing Framework",
  "## Evaluation Principles",
  "## Research Methodology",
  "## Methodology",
];

Deno.test({
  name: "[step7] no active identity embeds a methodology section (role/scope/voice only)",
  fn() {
    const files = listActiveIdentityFiles();
    const offenders: string[] = [];
    for (const fp of files) {
      const content = Deno.readTextFileSync(fp);
      const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
      for (const h of METHODOLOGY_HEADINGS) {
        if (body.includes(h)) {
          offenders.push(`${fp} contains "${h}"`);
        }
      }
    }
    assertEquals(offenders, [], `identities with methodology sections: ${offenders.join(", ")}`);
  },
});
