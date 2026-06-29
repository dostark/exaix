/**
 * @module TemplateSchemaComplianceTest
 * @path tests/blueprints/template_schema_compliance_test.ts
 * @description Phase 131 Step 8 — Template schema compliance (#5) + .strict() flip (#6).
 * @architectural-layer Integration
 * @dependencies [@std/assert, zod]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";

const IDENTITIES_DIR = "Blueprints/Identities";
type FrontmatterMap = { [key: string]: string | string[] | undefined };

function collectTemplateFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["active", "examples", "templates"]) {
    const dirPath = `${IDENTITIES_DIR}/${dir}`;
    try {
      for (const entry of Deno.readDirSync(dirPath)) {
        if (entry.isFile && entry.name.endsWith(".md.template")) {
          files.push(`${dirPath}/${entry.name}`);
        }
      }
    } catch {
      // directory may not exist
    }
  }
  return files.sort();
}

function collectActiveAndExamples(): string[] {
  const files: string[] = [];
  for (const dir of ["active", "examples"]) {
    const dirPath = `${IDENTITIES_DIR}/${dir}`;
    try {
      for (const entry of Deno.readDirSync(dirPath)) {
        if (!entry.isFile) continue;
        if (!entry.name.endsWith(".md") && !entry.name.endsWith(".md.template")) continue;
        // Skip non-identity files (README, etc.)
        if (entry.name === "README.md") continue;
        const filePath = `${dirPath}/${entry.name}`;
        const content = Deno.readTextFileSync(filePath);
        // Only include files with identity frontmatter
        if (/^---\nidentity_id:/.test(content)) {
          files.push(filePath);
        }
      }
    } catch {
      // skip
    }
  }
  return files.sort();
}

function parseFrontmatter(content: string): FrontmatterMap {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const result: FrontmatterMap = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    let value: string | string[] = rawValue;
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      value = rawValue.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    } else {
      value = rawValue.replace(/^["']|["']$/g, "");
    }
    result[key] = value;
  }
  return result;
}

const knownKeys = new Set([
  "identity_id",
  "name",
  "model",
  "capabilities",
  "deprecated",
  "created",
  "created_by",
  "version",
  "description",
  "default_skills",
  "permitted_tools",
  "hitl",
  "session_delegate",
]);

Deno.test({
  name: "[step8/template-schema] no .template file declares unknown frontmatter fields",
  fn: () => {
    const templates = collectTemplateFiles();
    assertEquals(templates.length > 0, true, "expected at least one .template file");

    const offenders: string[] = [];
    for (const file of templates) {
      const content = Deno.readTextFileSync(file);
      const frontmatter = parseFrontmatter(content);
      const unknownKeys = Object.keys(frontmatter).filter((k) => !knownKeys.has(k));
      if (unknownKeys.length > 0) {
        offenders.push(`${file}: unknown keys [${unknownKeys.join(", ")}]`);
      }
    }

    assertEquals(
      offenders.length,
      0,
      offenders.length > 0
        ? `Template files with unknown frontmatter fields:\n  ${offenders.join("\n  ")}`
        : "All template frontmatter fields are known",
    );
  },
});

const StrictBlueprintFrontmatterSchema = z.object({
  identity_id: z.string().min(1),
  name: z.string().min(1).max(100),
  model: z.string().min(1),
  capabilities: z.array(z.string()).optional().default([]),
  deprecated: z.boolean().optional(),
  created: z.string(),
  created_by: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  default_skills: z.array(z.string()).optional(),
  permitted_tools: z.array(z.string()).optional(),
  hitl: z.unknown().optional(),
  session_delegate: z.unknown().optional(),
}).strict();

Deno.test({
  name: "[step8/strict-schema] active + example identities parse under .strict()",
  fn: () => {
    const files = collectActiveAndExamples();
    assertEquals(files.length > 0, true, "expected at least one identity file");

    const failures: string[] = [];
    for (const file of files) {
      const content = Deno.readTextFileSync(file);
      const frontmatter = parseFrontmatter(content);
      const result = StrictBlueprintFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        failures.push(`${file}: ${result.error.message}`);
      }
    }

    assertEquals(
      failures.length,
      0,
      failures.length > 0
        ? `Files failing .strict() validation:\n  ${failures.join("\n  ")}`
        : "All identities pass .strict()",
    );
  },
});

Deno.test({
  name: "[step8/strict-schema] unknown frontmatter field rejects under .strict()",
  fn: () => {
    const result = StrictBlueprintFrontmatterSchema.safeParse({
      identity_id: "test-agent",
      name: "Test Agent",
      model: "test:model",
      created: "2025-01-01T00:00:00Z",
      created_by: "test",
      unknown_field: "should be rejected",
    });
    assertEquals(result.success, false, "unknown_field should be rejected by .strict()");
  },
});
