/**
 * @module ExampleAgentsVerificationTest
 * @path tests/agents/example_agents_test.ts
 * @description Verifies the baseline set of example agents, ensuring that all
 * required files and blueprint definitions are structurally valid.
 */

import { assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { getDefaultPaths } from "@exaix/core/config/paths.ts";
import { parse as parseYaml } from "@std/yaml";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

const paths = getDefaultPaths(".");

Deno.test("Agent Examples - Files Exist", async () => {
  const examplesDir = join(paths.blueprints, "Identities", "examples");
  const templatesDir = join(paths.blueprints, "Identities", "templates");

  // Check example files
  const exampleFiles = [
    "code-reviewer.md",
    "feature-developer.md",
    "api-documenter.md",
    "security-auditor.md",
    "research-synthesizer.md",
    "README.md",
  ];

  for (const file of exampleFiles) {
    const filePath = join(examplesDir, file);
    assertExists(await exists(filePath), `Example file ${file} should exist`);
  }

  // Check template files
  const templateFiles = [
    "pipeline-agent.md.template",
    "collaborative-agent.md.template",
  ];

  for (const file of templateFiles) {
    const filePath = join(templatesDir, file);
    assertExists(await exists(filePath), `Template file ${file} should exist`);
  }
});

Deno.test("Agent Examples - Validate Blueprints", async () => {
  const examplesDir = join(paths.blueprints, "Identities", "examples");
  const exampleFiles = [
    "code-reviewer.md",
    "feature-developer.md",
    "api-documenter.md",
    "security-auditor.md",
    "research-synthesizer.md",
  ];

  for (const file of exampleFiles) {
    const filePath = join(examplesDir, file);
    const content = await Deno.readTextFile(filePath);

    // Extract frontmatter
    const yamlRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    const match = content.match(yamlRegex);
    assertExists(match, `File ${file} should have frontmatter`);

    const yamlContent = match[1];
    const frontmatter = parseYaml(yamlContent);

    // Validate against schema
    const result = BlueprintFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      console.error(`Validation failed for ${file}:`, result.error);
    }
    assertEquals(result.success, true, `Blueprint ${file} should be valid`);
  }
});
