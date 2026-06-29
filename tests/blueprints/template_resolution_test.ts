/**
 * @module TemplateResolutionTest
 * @path tests/blueprints/template_resolution_test.ts
 * @description Phase 131 Step 8 — Asserts every CLI --template name resolves to a .template file.
 * @architectural-layer Integration
 * @dependencies [@std/assert]
 */

import { assertEquals } from "@std/assert";

const TEMPLATES_DIR = "Blueprints/Identities/templates";

/**
 * Maps CLI template names to their corresponding .template filenames.
 * This is the single source of truth after reconciliation (Option A):
 * every name maps to a real file on disk.
 */
const TEMPLATE_NAME_MAP: Record<string, string> = {
  default: "pipeline-agent",
  coder: "specialist-agent",
  reviewer: "judge-agent",
  architect: "collaborative-agent",
  researcher: "research-agent",
  gemini: "conversational-agent",
  mock: "reflexive-agent",
};

Deno.test({
  name: "[step8/template-resolution] every CLI template name maps to a .template file on disk",
  fn: () => {
    const missing: string[] = [];

    for (const [cliName, fileName] of Object.entries(TEMPLATE_NAME_MAP)) {
      const filePath = `${TEMPLATES_DIR}/${fileName}.md.template`;
      try {
        Deno.statSync(filePath);
      } catch {
        missing.push(`${cliName} → ${fileName}.md.template`);
      }
    }

    assertEquals(
      missing.length,
      0,
      missing.length > 0
        ? `CLI template names missing a .template file:\n  ${missing.join("\n  ")}`
        : "All CLI template names resolve to .template files on disk",
    );
  },
});

Deno.test({
  name: "[step8/template-resolution] every .template file is reachable by a CLI template name",
  fn: () => {
    const diskFiles: string[] = [];
    for (const entry of Deno.readDirSync(TEMPLATES_DIR)) {
      if (entry.isFile && entry.name.endsWith(".md.template")) {
        diskFiles.push(entry.name.replace(/\.md\.template$/, ""));
      }
    }

    const mappedFiles = new Set(Object.values(TEMPLATE_NAME_MAP));
    const unreachable = diskFiles.filter((f) => !mappedFiles.has(f));

    assertEquals(
      unreachable.length,
      0,
      unreachable.length > 0
        ? `.template files not reachable by any CLI name:\n  ${unreachable.join("\n  ")}`
        : "All .template files are reachable via a CLI template name",
    );
  },
});
