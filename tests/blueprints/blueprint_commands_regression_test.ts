/**
 * @module BlueprintCommandsRegressionTest
 * @path tests/blueprints/blueprint_commands_regression_test.ts
 * @description Regression tests for blueprint CLI commands, ensuring correct
 * application and discovery of project blueprints within the workspace.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { createStubDb } from "@exaix/testing";
import { ExaPathDefaults } from "@exaix/core";
import type { IBlueprintMetadata } from "@exaix/schemas/blueprint.ts";
import { createStubConfig, createStubContext } from "@exaix/testing";
import { BlueprintCommands } from "../../apps/exactl/src/commands/blueprint_commands.ts";
import type { Config } from "@exaix/schemas/config.ts";

const AGENT_ID_YAML = "yaml-agent";
const AGENT_NAME_YAML = "YAML Format Agent";
const AGENT_MODEL_MOCK = "mock:test-model";
const AGENT_CAP_TESTING = "testing";
const AGENT_VERSION_V1 = "1.0.0";
const AGENT_CREATOR_TEST = "test";
const AGENT_DATE = "2026-01-18T12:00:00Z";

const AGENT_ID_TOML = "toml-agent";
const AGENT_NAME_TOML = "TOML Format Agent";

const AGENT_ID_SHOW = "show-yaml-test";
const AGENT_NAME_SHOW = "Show YAML Test";

function createBlueprintCommands(tempDir: string): { commands: BlueprintCommands; config: Config } {
  const config = createTestConfig(tempDir);
  const commands = new BlueprintCommands(
    createStubContext({ config: createStubConfig(config), db: stubDb }),
  );
  return { commands, config };
}
const AGENT_MODEL_OLLAMA = "ollama:llama3.2";
const AGENT_CAP_CODE = "code_generation";

const AGENT_ID_VALIDATE = "validate-yaml-test";
const AGENT_NAME_VALIDATE = "Validate YAML Test";

const AGENT_ID_MIXED_YAML = "mixed-yaml";
const AGENT_ID_MIXED_TOML = "mixed-toml";

const AGENT_ID_ARRAY = "array-test";

// Helper to create test workspace structure
async function createTestBlueprintsDir(baseDir: string): Promise<string> {
  const blueprintsDir = join(baseDir, "Blueprints", "Agents");
  await ensureDir(blueprintsDir);
  return blueprintsDir;
}

// Create minimal config for testing
function createTestConfig(root: string) {
  return {
    system: { root },
    paths: { ...ExaPathDefaults },
  } as Partial<Config> as Config;
}

// Create stub db for testing
const stubDb = createStubDb();

// Regression Tests for Blueprint Frontmatter Parsing

Deno.test("[regression] Blueprint list works with YAML frontmatter (---)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create blueprint with YAML frontmatter (--- delimiters)
    const yamlBlueprint = `---
agent_role: "${AGENT_ID_YAML}"
name: "${AGENT_NAME_YAML}"
model: "${AGENT_MODEL_MOCK}"
capabilities: ["${AGENT_CAP_TESTING}"]
created: "${AGENT_DATE}"
created_by: "${AGENT_CREATOR_TEST}"
version: "${AGENT_VERSION_V1}"
description: "Agent with YAML frontmatter"
---

# YAML Agent

This agent uses YAML frontmatter format.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_YAML}.md`), yamlBlueprint);

    const { commands: blueprintCommands } = createBlueprintCommands(tempDir);

    // List should find the YAML-format blueprint
    const blueprints = await blueprintCommands.list();

    // Before the fix, this would return 0 (only looked for +++ delimiters)
    // After the fix, this should return 1 (supports both +++ and --- delimiters)
    assertEquals(blueprints.length, 1, "Should find blueprint with YAML frontmatter");
    assertEquals(blueprints[0].agent_role, AGENT_ID_YAML);
    assertEquals(blueprints[0].name, AGENT_NAME_YAML);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Blueprint list works with TOML frontmatter (+++)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create blueprint with TOML frontmatter (+++ delimiters)
    const tomlBlueprint = `+++
identity_id = "${AGENT_ID_TOML}"
name = "${AGENT_NAME_TOML}"
model = "${AGENT_MODEL_MOCK}"
capabilities = ["${AGENT_CAP_TESTING}"]
created = "${AGENT_DATE}"
created_by = "${AGENT_CREATOR_TEST}"
version = "${AGENT_VERSION_V1}"
description = "Agent with TOML frontmatter"
+++

# TOML Agent

This agent uses TOML frontmatter format.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_TOML}.md`), tomlBlueprint);
    const { commands: blueprintCommands } = createBlueprintCommands(tempDir);

    // List should find the TOML-format blueprint
    const blueprints = await blueprintCommands.list();

    assertEquals(blueprints.length, 1, "Should find blueprint with TOML frontmatter");
    assertEquals(blueprints[0].agent_role, AGENT_ID_TOML);
    assertEquals(blueprints[0].name, AGENT_NAME_TOML);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Blueprint show works with YAML frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create blueprint with YAML frontmatter
    const yamlBlueprint = `---
agent_role: "${AGENT_ID_SHOW}"
name: "${AGENT_NAME_SHOW}"
model: "${AGENT_MODEL_OLLAMA}"
capabilities: ["${AGENT_CAP_CODE}"]
created: "${AGENT_DATE}"
created_by: "tester"
version: "${AGENT_VERSION_V1}"
description: "Testing show with YAML"
---

# Show YAML Test Agent

System prompt content here.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_SHOW}.md`), yamlBlueprint);

    const config = createTestConfig(tempDir);
    const blueprintCommands = new BlueprintCommands(
      createStubContext({ config: createStubConfig(config), db: stubDb }),
    );

    // Show should work with YAML format
    // Before the fix, this would throw "Invalid blueprint format"
    const details = await blueprintCommands.show(AGENT_ID_SHOW);

    assertExists(details, "Should return blueprint details");
    assertEquals(details.agent_role, AGENT_ID_SHOW);
    assertEquals(details.model, AGENT_MODEL_OLLAMA);
    assertEquals(details.name, AGENT_NAME_SHOW);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Blueprint validate works with YAML frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create valid blueprint with YAML frontmatter
    // Includes required <thought> and <content> tags for validation
    const yamlBlueprint = `---
agent_role: "${AGENT_ID_VALIDATE}"
name: "${AGENT_NAME_VALIDATE}"
model: "${AGENT_MODEL_MOCK}"
capabilities: ["${AGENT_CAP_TESTING}"]
created: "${AGENT_DATE}"
created_by: "tester"
version: "${AGENT_VERSION_V1}"
---

# Validate YAML Test Agent

You are a test agent. Use <thought> tags for reasoning and <content> tags for responses.

{{RESPONSE_FORMAT}}
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_VALIDATE}.md`), yamlBlueprint);

    const config = createTestConfig(tempDir);
    const blueprintCommands = new BlueprintCommands(
      createStubContext({ config: createStubConfig(config), db: stubDb }),
    );

    // Validate should work with YAML format
    // Before the fix, this would show "Missing or invalid TOML frontmatter"
    const result = await blueprintCommands.validate(AGENT_ID_VALIDATE);

    assertEquals(result.valid, true, "Blueprint with YAML frontmatter should be valid");
    assertEquals(result.errors.length, 0, "Should have no errors");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Blueprint list finds both YAML and TOML formats in same directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create YAML blueprint
    const yamlBlueprint = `---
agent_role: "${AGENT_ID_MIXED_YAML}"
name: "Mixed YAML Agent"
model: "mock:yaml"
version: "${AGENT_VERSION_V1}"
---

YAML content.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_MIXED_YAML}.md`), yamlBlueprint);

    // Create TOML blueprint
    const tomlBlueprint = `+++
identity_id = "${AGENT_ID_MIXED_TOML}"
name = "Mixed TOML Agent"
model = "mock:toml"
version = "${AGENT_VERSION_V1}"
+++

TOML content.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_MIXED_TOML}.md`), tomlBlueprint);

    const config = createTestConfig(tempDir);
    const blueprintCommands = new BlueprintCommands(
      createStubContext({ config: createStubConfig(config), db: stubDb }),
    );

    // Should find both blueprints
    const blueprints = await blueprintCommands.list();

    assertEquals(blueprints.length, 2, "Should find both YAML and TOML blueprints");

    const ids = blueprints.map((b: IBlueprintMetadata) => b.agent_role).sort();
    assertEquals(ids, [AGENT_ID_MIXED_TOML, AGENT_ID_MIXED_YAML]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] YAML frontmatter parses arrays correctly", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_blueprint_regression_" });

  try {
    const blueprintsDir = await createTestBlueprintsDir(tempDir);

    // Create blueprint with array in YAML frontmatter
    const yamlBlueprint = `---
agent_role: "${AGENT_ID_ARRAY}"
name: "Array Test Agent"
model: "${AGENT_MODEL_MOCK}"
capabilities: ["code_generation", "testing", "debugging"]
default_skills: ["typescript", "deno"]
version: "${AGENT_VERSION_V1}"
---

Array test.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID_ARRAY}.md`), yamlBlueprint);

    const config = createTestConfig(tempDir);
    const blueprintCommands = new BlueprintCommands(
      createStubContext({ config: createStubConfig(config), db: stubDb }),
    );

    const details = await blueprintCommands.show(AGENT_ID_ARRAY);

    assertExists(details.capabilities, "Should parse capabilities array");
    assertEquals(
      (details.capabilities as string[]).length,
      3,
      "Should have 3 capabilities",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
