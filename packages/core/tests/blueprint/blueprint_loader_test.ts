/**
 * @module BlueprintLoaderTest
 * @path packages/core/tests/blueprint/blueprint_loader_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the IBlueprintLoader's ability to parse agent definitions from YAML
 * frontmatter, ensuring correct schema validation and default value application.
 */

import { McpToolName } from "@exaix/mcp";
import { PROVIDER_OPENAI } from "@exaix/ai-openai";
import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";

import { join } from "@std/path";

import { DEFAULT_AI_MODEL } from "@exaix/core";
import { BlueprintLoadError, createBlueprintLoader, IBlueprintLoader, loadBlueprint } from "@exaix/core/blueprint";
import { readFixtureTextSync, TEST_MODEL_OPENAI } from "@exaix/testing";

// Test directory setup
let testDir: string;
let blueprintsPath: string;

async function setup() {
  testDir = await Deno.makeTempDir({ prefix: "exa_blueprint_test_" });
  blueprintsPath = join(testDir, "Blueprints");
  const identitiesDir = join(blueprintsPath, "Agents");
  await Deno.mkdir(identitiesDir, { recursive: true });
  return { testDir, blueprintsPath, identitiesDir };
}

async function teardown(dir: string) {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// IBlueprintLoader.load() Tests

Deno.test("[IBlueprintLoader] loads blueprint with YAML frontmatter", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "blueprint",
      "content.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "code-reviewer.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("code-reviewer");

    assertExists(blueprint);
    assertEquals(blueprint.agentRole, "code-reviewer");
    assertEquals(blueprint.name, "Code Reviewer Agent");
    assertEquals(blueprint.model, "anthropic:claude-sonnet-5");
    assertEquals(blueprint.capabilities, [McpToolName.READ_FILE, McpToolName.WRITE_FILE]);
    assertEquals(blueprint.version, "1.0.0");
    assertStringIncludes(blueprint.systemPrompt, "You are a code reviewer");
    assertEquals(blueprint.frontmatter.reflexive, false);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] loads blueprint without frontmatter (backward compatible)", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `# Simple Agent

You are a simple agent with no frontmatter.
`;
    await Deno.writeTextFile(join(identitiesDir, "simple-agent.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("simple-agent");

    assertExists(blueprint);
    assertEquals(blueprint.agentRole, "simple-agent");
    assertEquals(blueprint.name, "Simple Agent"); // Derived from ID
    assertEquals(blueprint.model, DEFAULT_AI_MODEL); // Falls through when no model specified
    assertEquals(blueprint.capabilities, []);
    assertStringIncludes(blueprint.systemPrompt, "# Simple Agent");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] uses default model when not specified", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "no-model"
name: "No Model Agent"
---

Agent without model specification.
`;
    await Deno.writeTextFile(join(identitiesDir, "no-model.md"), content);

    const loader = new IBlueprintLoader({
      blueprintsPath,
      defaultModel: `${PROVIDER_OPENAI}:${TEST_MODEL_OPENAI}`,
    });
    const blueprint = await loader.load("no-model");

    assertExists(blueprint);
    assertEquals(blueprint.model, `${PROVIDER_OPENAI}:${TEST_MODEL_OPENAI}`);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] returns null for non-existent blueprint", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("non-existent");

    assertEquals(blueprint, null);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] lists all blueprints in Agents path", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const alpha = readFixtureTextSync(import.meta.url, "blueprint", "alpha.md");
    const beta = readFixtureTextSync(import.meta.url, "blueprint", "beta.md");
    await Deno.writeTextFile(join(identitiesDir, "alpha.md"), alpha);
    await Deno.writeTextFile(join(identitiesDir, "beta.md"), beta);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprints = await loader.listAll();

    assertEquals(blueprints.length, 2);
    assertEquals(new Set(blueprints.map((b) => b.agentRole)), new Set(["alpha", "beta"]));
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] returns empty list when Agents path is missing", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "exa_blueprint_test_" });
  const blueprintsPath = join(testDir, "Blueprints");

  try {
    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprints = await loader.listAll();

    assertEquals(blueprints.length, 0);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] loadOrThrow throws for non-existent blueprint", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new IBlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.loadOrThrow("non-existent"),
      BlueprintLoadError,
      "Identity 'non-existent' not found",
    );
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] throws on invalid YAML frontmatter", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "bad-yaml"
name: [invalid: yaml: syntax
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "bad-yaml.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.load("bad-yaml"),
      BlueprintLoadError,
      "Invalid YAML frontmatter",
    );
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] validates frontmatter schema", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "schema-test"
capabilities: "not-an-array"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "schema-test.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.load("schema-test"),
      BlueprintLoadError,
      "Invalid frontmatter",
    );
  } finally {
    await teardown(testDir);
  }
});

// Extension Fields Tests

Deno.test("[IBlueprintLoader] parses reflexive agent configuration", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "blueprint",
      "content_1.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "reflexive-agent.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("reflexive-agent");

    assertExists(blueprint);
    assertEquals(blueprint.frontmatter.reflexive, true);
    assertEquals(blueprint.frontmatter.max_reflexion_iterations, 5);
    assertEquals(blueprint.frontmatter.confidence_required, 80);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] parses memory and skills configuration", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "blueprint",
      "content_2.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "skilled-agent.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("skilled-agent");

    assertExists(blueprint);
    assertEquals(blueprint.frontmatter.memory_enabled, true);
    assertEquals(blueprint.frontmatter.default_skills, ["tdd-methodology", "security-first"]);
  } finally {
    await teardown(testDir);
  }
});

// Caching Tests

Deno.test("[IBlueprintLoader] caches loaded blueprints", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "cached-agent"
name: "Cached Agent"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "cached-agent.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });

    // First load
    const blueprint1 = await loader.load("cached-agent");

    // Modify file (shouldn't affect cached result)
    await Deno.writeTextFile(
      join(identitiesDir, "cached-agent.md"),
      content.replace("Cached Agent", "Modified Agent"),
    );

    // Second load should return cached version
    const blueprint2 = await loader.load("cached-agent");

    assertExists(blueprint1);
    assertExists(blueprint2);
    assertEquals(blueprint1.name, blueprint2.name);
    assertEquals(blueprint1.name, "Cached Agent"); // Not "Modified Agent"
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] invalidate clears specific cache entry", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "invalidate-test"
name: "Original Name"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "invalidate-test.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });

    // First load
    const blueprint1 = await loader.load("invalidate-test");
    assertEquals(blueprint1?.name, "Original Name");

    // Modify file and invalidate cache
    await Deno.writeTextFile(
      join(identitiesDir, "invalidate-test.md"),
      content.replace("Original Name", "New Name"),
    );
    loader.invalidate("invalidate-test");

    // Second load should get new version
    const blueprint2 = await loader.load("invalidate-test");
    assertEquals(blueprint2?.name, "New Name");
  } finally {
    await teardown(testDir);
  }
});

// Backward Compatibility Tests

Deno.test("[IBlueprintLoader] toLegacyBlueprint returns compatible interface", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "legacy-test"
name: "Legacy Test"
---

System prompt content.
`;
    await Deno.writeTextFile(join(identitiesDir, "legacy-test.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const loaded = await loader.load("legacy-test");

    assertExists(loaded);
    const legacy = loader.toLegacyBlueprint(loaded);

    assertEquals(legacy.systemPrompt, "System prompt content.");
    assertEquals(legacy.agentRole, "legacy-test");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] toLegacyBlueprint carries default_skills through as defaultSkills", async () => {
  // Regression: frontmatter.default_skills was parsed onto ILoadedBlueprint.frontmatter, but
  // toLegacyBlueprint's mapping to IBlueprint dropped it, so AgentRunner.run() never received it.
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    // style-exclude:SMALL_FIXTURE_OK - 5-line frontmatter fixture, inline for readability
    const content = `---
agent_role: "skills-test"
name: "Skills Test"
default_skills: ["response-contract", "error-handling"]
---

System prompt content.
`;
    await Deno.writeTextFile(join(identitiesDir, "skills-test.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const loaded = await loader.load("skills-test");

    assertExists(loaded);
    const legacy = loader.toLegacyBlueprint(loaded);

    assertEquals(legacy.defaultSkills, ["response-contract", "error-handling"]);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[loadBlueprint] standalone function returns legacy Blueprint", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
agent_role: "standalone-test"
name: "Standalone Test"
---

Standalone system prompt.
`;
    await Deno.writeTextFile(join(identitiesDir, "standalone-test.md"), content);

    const blueprint = await loadBlueprint(blueprintsPath, "standalone-test");

    assertExists(blueprint);
    assertEquals(blueprint.systemPrompt, "Standalone system prompt.");
    assertEquals(blueprint.agentRole, "standalone-test");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[createBlueprintLoader] factory function creates loader", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = createBlueprintLoader(blueprintsPath);
    assertExists(loader);

    // Should be able to check existence
    const exists = await loader.exists("non-existent");
    assertEquals(exists, false);
  } finally {
    await teardown(testDir);
  }
});

// Name Derivation Tests

Deno.test("[IBlueprintLoader] derives name from agent ID correctly", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    // Test various ID patterns
    const testCases = [
      { id: "simple", expectedName: "Simple" },
      { id: "two-words", expectedName: "Two Words" },
      { id: "three-word-agent", expectedName: "Three Word Agent" },
    ];

    for (const { id, expectedName } of testCases) {
      const content = `# Agent\n\nPrompt`;
      await Deno.writeTextFile(join(identitiesDir, `${id}.md`), content);

      const loader = new IBlueprintLoader({ blueprintsPath });
      loader.clearCache(); // Clear cache between tests

      const blueprint = await loader.load(id);
      assertExists(blueprint, `Blueprint ${id} should exist`);
      assertEquals(blueprint.name, expectedName, `Name for ${id} should be ${expectedName}`);
    }
  } finally {
    await teardown(testDir);
  }
});

// Agents Path Tests

Deno.test("[IBlueprintLoader] loads from Agents path (canonical)", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "blueprint",
      "content_3.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "senior-coder.md"), content);

    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("senior-coder");

    assertExists(blueprint);
    assertEquals(blueprint.agentRole, "senior-coder");
    assertEquals(blueprint.name, "Senior Coder");
    assertEquals(blueprint.path, join(identitiesDir, "senior-coder.md"));
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[IBlueprintLoader] returns null when identity not found in Agents path", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new IBlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("non-existent");

    assertEquals(blueprint, null);
  } finally {
    await teardown(testDir);
  }
});
