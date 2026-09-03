/**
 * @module IdentitySchemaComplianceTest
 * @path tests/blueprints/template_schema_compliance_test.ts
 * @description Phase 131 — strict-schema compliance for the active identity
 *   catalog. After the catalog reconciliation the separate examples/ and
 *   templates/ directories are retired (their content moved to concrete
 *   identities and skills), so this asserts every active identity parses under a
 *   `.strict()` frontmatter schema and that an unknown field is rejected.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/yaml, zod]
 */

import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { z } from "zod";

const AGENTS_DIR = "Blueprints/Agents";

/** Active identities are the top-level `*.md` files (no subdirectories remain). */
function collectActiveAgentRoles(): string[] {
  const files: string[] = [];
  for (const entry of Deno.readDirSync(AGENTS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    files.push(`${AGENTS_DIR}/${entry.name}`);
  }
  return files.sort();
}

function parseFrontmatter(content: string): Record<string, string | string[] | boolean | undefined> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return parseYaml(match[1]) as Record<string, string | string[] | boolean | undefined>;
}

const StrictBlueprintFrontmatterSchema = z.object({
  agent_role: z.string().min(1),
  name: z.string().min(1).max(100),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional().default([]),
  deprecated: z.boolean().optional(),
  created: z.string(),
  created_by: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  default_skills: z.array(z.string()).optional(),
  permitted_tools: z.array(z.string()).optional(),
  preferred_provider: z.string().optional(),
  model_size: z.string().optional(),
  characteristics: z.array(z.string()).optional(),
  thinking: z.boolean().optional(),
  effort: z.string().optional(),
  hitl: z.unknown().optional(),
  session_delegate: z.unknown().optional(),
}).strict();

Deno.test({
  name: "[catalog/strict-schema] every active identity parses under .strict()",
  fn: () => {
    const files = collectActiveAgentRoles();
    assertEquals(files.length > 0, true, "expected at least one identity file");

    const failures: string[] = [];
    for (const file of files) {
      const frontmatter = parseFrontmatter(Deno.readTextFileSync(file));
      const result = StrictBlueprintFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        failures.push(`${file}: ${result.error.message}`);
      }
    }

    assertEquals(
      failures.length,
      0,
      failures.length > 0
        ? `Identities failing .strict() validation:\n  ${failures.join("\n  ")}`
        : "All identities pass .strict()",
    );
  },
});

Deno.test({
  name: "[catalog/strict-schema] unknown frontmatter field rejects under .strict()",
  fn: () => {
    const result = StrictBlueprintFrontmatterSchema.safeParse({
      agent_role: "test-agent",
      name: "Test Agent",
      model: "test:model",
      created: "2025-01-01T00:00:00Z",
      created_by: "test",
      unknown_field: "should be rejected",
    });
    assertEquals(result.success, false, "unknown_field should be rejected by .strict()");
  },
});
