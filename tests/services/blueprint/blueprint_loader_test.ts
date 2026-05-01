/**
 * @module BlueprintLoaderTest
 * @path tests/services/blueprint/blueprint_loader_test.ts
 * @description Verifies the BlueprintLoader's ability to parse agent definitions from YAML
 * frontmatter, ensuring correct schema validation and default value application.
 */

import { McpToolName } from "@exaix/mcp";
import { PROVIDER_OPENAI } from "@exaix/ai";
import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";

import { join } from "@std/path";

import {
  BlueprintLoader,
  BlueprintLoadError,
  createBlueprintLoader,
  loadBlueprint,
} from "../../../src/services/blueprint/blueprint_loader.ts";
import { TEST_MODEL_OPENAI } from "@exaix/testing";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

// Test directory setup
let testDir: string;
let blueprintsPath: string;

async function setup() {
  testDir = await Deno.makeTempDir({ prefix: "exa_blueprint_test_" });
  blueprintsPath = join(testDir, "Blueprints");
  const identitiesDir = join(blueprintsPath, "Identities");
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

// ============================================================================
// BlueprintLoader.load() Tests
// ============================================================================

Deno.test("[BlueprintLoader] loads blueprint with YAML frontmatter", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "services",
      "blueprint",
      "blueprint_loader_test",
      "content.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "code-reviewer.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("code-reviewer");

    assertExists(blueprint);
    assertEquals(blueprint.identityId, "code-reviewer");
    assertEquals(blueprint.name, "Code Reviewer Agent");
    assertEquals(blueprint.model, "anthropic:claude-sonnet-4-20250514");
    assertEquals(blueprint.capabilities, [McpToolName.READ_FILE, McpToolName.WRITE_FILE]);
    assertEquals(blueprint.version, "1.0.0");
    assertStringIncludes(blueprint.systemPrompt, "You are a code reviewer");
    assertEquals(blueprint.frontmatter.reflexive, false);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] loads blueprint without frontmatter (backward compatible)", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `# Simple Agent

You are a simple agent with no frontmatter.
`;
    await Deno.writeTextFile(join(identitiesDir, "simple-agent.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("simple-agent");

    assertExists(blueprint);
    assertEquals(blueprint.identityId, "simple-agent");
    assertEquals(blueprint.name, "Simple Agent"); // Derived from ID
    assertEquals(blueprint.model, "anthropic:claude-sonnet-4-20250514"); // Default
    assertEquals(blueprint.capabilities, []);
    assertStringIncludes(blueprint.systemPrompt, "# Simple Agent");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] uses default model when not specified", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "no-model"
name: "No Model Agent"
---

Agent without model specification.
`;
    await Deno.writeTextFile(join(identitiesDir, "no-model.md"), content);

    const loader = new BlueprintLoader({
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

Deno.test("[BlueprintLoader] returns null for non-existent blueprint", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("non-existent");

    assertEquals(blueprint, null);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] lists all blueprints in Identities path", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const alpha = readFixtureTextSync(import.meta.url, "services", "blueprint", "blueprint_loader_test", "alpha.md");
    const beta = readFixtureTextSync(import.meta.url, "services", "blueprint", "blueprint_loader_test", "beta.md");
    await Deno.writeTextFile(join(identitiesDir, "alpha.md"), alpha);
    await Deno.writeTextFile(join(identitiesDir, "beta.md"), beta);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprints = await loader.listAll();

    assertEquals(blueprints.length, 2);
    assertEquals(new Set(blueprints.map((b) => b.identityId)), new Set(["alpha", "beta"]));
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] returns empty list when Identities path is missing", async () => {
  const testDir = await Deno.makeTempDir({ prefix: "exa_blueprint_test_" });
  const blueprintsPath = join(testDir, "Blueprints");

  try {
    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprints = await loader.listAll();

    assertEquals(blueprints.length, 0);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] loadOrThrow throws for non-existent blueprint", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new BlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.loadOrThrow("non-existent"),
      BlueprintLoadError,
      "Identity 'non-existent' not found",
    );
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] throws on invalid YAML frontmatter", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "bad-yaml"
name: [invalid: yaml: syntax
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "bad-yaml.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.load("bad-yaml"),
      BlueprintLoadError,
      "Invalid YAML frontmatter",
    );
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] validates frontmatter schema", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "schema-test"
capabilities: "not-an-array"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "schema-test.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });

    await assertRejects(
      () => loader.load("schema-test"),
      BlueprintLoadError,
      "Invalid frontmatter",
    );
  } finally {
    await teardown(testDir);
  }
});

// ============================================================================
// Phase 16.4+ Extension Fields Tests
// ============================================================================

Deno.test("[BlueprintLoader] parses reflexive agent configuration", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "services",
      "blueprint",
      "blueprint_loader_test",
      "content_1.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "reflexive-agent.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("reflexive-agent");

    assertExists(blueprint);
    assertEquals(blueprint.frontmatter.reflexive, true);
    assertEquals(blueprint.frontmatter.max_reflexion_iterations, 5);
    assertEquals(blueprint.frontmatter.confidence_required, 80);
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] parses memory and skills configuration", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "services",
      "blueprint",
      "blueprint_loader_test",
      "content_2.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "skilled-agent.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("skilled-agent");

    assertExists(blueprint);
    assertEquals(blueprint.frontmatter.memory_enabled, true);
    assertEquals(blueprint.frontmatter.default_skills, ["tdd-methodology", "security-first"]);
  } finally {
    await teardown(testDir);
  }
});

// ============================================================================
// Caching Tests
// ============================================================================

Deno.test("[BlueprintLoader] caches loaded blueprints", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "cached-agent"
name: "Cached Agent"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "cached-agent.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });

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

Deno.test("[BlueprintLoader] invalidate clears specific cache entry", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "invalidate-test"
name: "Original Name"
---

Content
`;
    await Deno.writeTextFile(join(identitiesDir, "invalidate-test.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });

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

// ============================================================================
// Backward Compatibility Tests
// ============================================================================

Deno.test("[BlueprintLoader] toLegacyBlueprint returns compatible interface", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "legacy-test"
name: "Legacy Test"
---

System prompt content.
`;
    await Deno.writeTextFile(join(identitiesDir, "legacy-test.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const loaded = await loader.load("legacy-test");

    assertExists(loaded);
    const legacy = loader.toLegacyBlueprint(loaded);

    assertEquals(legacy.systemPrompt, "System prompt content.");
    assertEquals(legacy.identityId, "legacy-test");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[loadBlueprint] standalone function returns legacy Blueprint", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = `---
identity_id: "standalone-test"
name: "Standalone Test"
---

Standalone system prompt.
`;
    await Deno.writeTextFile(join(identitiesDir, "standalone-test.md"), content);

    const blueprint = await loadBlueprint(blueprintsPath, "standalone-test");

    assertExists(blueprint);
    assertEquals(blueprint.systemPrompt, "Standalone system prompt.");
    assertEquals(blueprint.identityId, "standalone-test");
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

// ============================================================================
// Name Derivation Tests
// ============================================================================

Deno.test("[BlueprintLoader] derives name from agent ID correctly", async () => {
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

      const loader = new BlueprintLoader({ blueprintsPath });
      loader.clearCache(); // Clear cache between tests

      const blueprint = await loader.load(id);
      assertExists(blueprint, `Blueprint ${id} should exist`);
      assertEquals(blueprint.name, expectedName, `Name for ${id} should be ${expectedName}`);
    }
  } finally {
    await teardown(testDir);
  }
});

// ============================================================================
// Phase 53: Identities Path Tests
// ============================================================================

Deno.test("[BlueprintLoader] loads from Identities path (canonical)", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    const content = readFixtureTextSync(
      import.meta.url,
      "services",
      "blueprint",
      "blueprint_loader_test",
      "content_3.md",
    );
    await Deno.writeTextFile(join(identitiesDir, "senior-coder.md"), content);

    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("senior-coder");

    assertExists(blueprint);
    assertEquals(blueprint.identityId, "senior-coder");
    assertEquals(blueprint.name, "Senior Coder");
    assertEquals(blueprint.path, join(identitiesDir, "senior-coder.md"));
  } finally {
    await teardown(testDir);
  }
});

Deno.test("[BlueprintLoader] returns null when identity not found in Identities path", async () => {
  const { blueprintsPath, testDir } = await setup();

  try {
    const loader = new BlueprintLoader({ blueprintsPath });
    const blueprint = await loader.load("non-existent");

    assertEquals(blueprint, null);
  } finally {
    await teardown(testDir);
  }
});
