/**
 * @module BlueprintValidationTest
 * @path tests/blueprints/blueprint_validation_test.ts
 * @description Verifies the core agent blueprints, ensuring that Senior Coder,
 * Quality Judge, and default identities pass strict schema validation.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

const BLUEPRINTS_DIR = "./Blueprints/Identities";

interface BlueprintFrontmatter {
  identity_id: string;
  name: string;
  model: string;
  capabilities?: string[];
  created: string;
  created_by: string;
  version: string;
  description?: string;
  default_skills?: string[];
}

/**
 * Parse YAML frontmatter from a markdown file
 */
function parseFrontmatter(content: string): BlueprintFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]) as BlueprintFrontmatter;
}

/**
 * Get all .md files in a directory (non-recursive)
 */
async function getMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (
        entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md"
      ) {
        files.push(join(dir, entry.name));
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return files;
}

// ============================================================================
// Root Blueprint Tests
// ============================================================================

Deno.test("Blueprint validation: default.md passes schema", async () => {
  const content = await Deno.readTextFile(join(BLUEPRINTS_DIR, "default.md"));
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "default");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: senior-coder.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "senior-coder.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "senior-coder");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: quality-judge.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "quality-judge.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "quality-judge");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

// ============================================================================
// Example Blueprint Tests
// ============================================================================

// The separate examples/ directory was retired in the Phase 131 catalog
// reconciliation: 4 example stubs duplicated concrete identities and were
// deleted, and research-synthesizer was promoted to a concrete identity.
Deno.test("Blueprint validation: research-synthesizer.md (promoted from examples) passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "research-synthesizer.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "research-synthesizer");
  assertExists(frontmatter!.default_skills, "Should have default_skills");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

// ============================================================================
// New Agent Tests (Phase 18)
// ============================================================================

Deno.test("Blueprint validation: security-expert.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "security-expert.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "security-expert");
  assertExists(frontmatter!.default_skills, "Should have default_skills");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: performance-engineer.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "performance-engineer.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "performance-engineer");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: technical-writer.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "technical-writer.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "technical-writer");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: software-architect.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "software-architect.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "software-architect");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

Deno.test("Blueprint validation: test-engineer.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "test-engineer.md"),
  );
  const frontmatter = parseFrontmatter(content);

  assertExists(frontmatter, "Should have frontmatter");
  assertEquals(frontmatter!.identity_id, "test-engineer");

  const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
  assertEquals(
    result.success,
    true,
    `Schema errors: ${!result.success ? result.error?.message : ""}`,
  );
});

// ============================================================================
// Model Format Tests
// ============================================================================

Deno.test("Blueprint validation: all agents have valid model format", async () => {
  const modelRegex = /^[a-z]+:[a-z0-9-.:/]+$/;
  const allFiles = [
    ...await getMarkdownFiles(BLUEPRINTS_DIR),
  ];

  for (const file of allFiles) {
    const content = await Deno.readTextFile(file);
    const frontmatter = parseFrontmatter(content);

    if (frontmatter) {
      // Empty model is valid — means resolve via ModelResolver using model_size
      if (!frontmatter.model) continue;
      const isValid = modelRegex.test(frontmatter.model);
      assertEquals(
        isValid,
        true,
        `${file}: model "${frontmatter.model}" should match provider:model format`,
      );
    }
  }
});

// ============================================================================
// YAML Format Tests
// ============================================================================

Deno.test("Blueprint validation: all agents use YAML frontmatter (not TOML)", async () => {
  const allFiles = [
    ...await getMarkdownFiles(BLUEPRINTS_DIR),
  ];

  for (const file of allFiles) {
    const content = await Deno.readTextFile(file);

    // Check for TOML markers
    const hasToml = content.startsWith("+++");
    assertEquals(
      hasToml,
      false,
      `${file}: should use YAML frontmatter (---) not TOML (+++)`,
    );

    // Check for YAML markers
    const hasYaml = content.startsWith("---");
    assertEquals(
      hasYaml,
      true,
      `${file}: should have YAML frontmatter starting with ---`,
    );
  }
});

// ============================================================================
// Skills Assignment Tests
// ============================================================================

Deno.test("Blueprint validation: voting-judge.md passes schema", async () => {
  const content = await Deno.readTextFile(
    join(BLUEPRINTS_DIR, "voting-judge.md"),
  );
  const frontmatter = parseFrontmatter(content);
  assertExists(
    frontmatter,
    "voting-judge.md should have valid YAML frontmatter",
  );
  const parsed = BlueprintFrontmatterSchema.parse(frontmatter);
  assertEquals(parsed.identity_id, "voting-judge");
  assertEquals(parsed.name, "Voting Consensus Judge");
});

Deno.test("Blueprint validation: every active identity declares default_skills", async () => {
  const files = await getMarkdownFiles(BLUEPRINTS_DIR);

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const frontmatter = parseFrontmatter(content);

    if (frontmatter) {
      assertExists(
        frontmatter.default_skills,
        `${file}: should have default_skills field`,
      );
    }
  }
});
