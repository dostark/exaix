/**
 * @module BlueprintMultilineArrayTest
 * @path tests/blueprint_multiline_array_regression_test.ts
 * @description Regression tests for blueprint parsing, specifically ensuring that
 * complex multiline arrays in frontmatter are correctly serialized and deserialized.
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { createStubConfig, createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import { ExaPathDefaults } from "../src/shared/constants.ts";
import { BlueprintCommands } from "../src/cli/commands/blueprint_commands.ts";
import { ConfigSchema } from "../src/shared/schemas/config.ts";

const AGENT_ID = "multiline-test";
const CAP_TESTING = "testing";
const CAP_VALIDATION = "validation";
const CAP_DEBUGGING = "debugging";
const SKILL_TS = "typescript";
const SKILL_DENO = "deno";

Deno.test("[regression] YAML multi-line array format parses correctly", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_multiline_regression_" });

  try {
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsDir);

    // Create blueprint with multi-line array format (like mock-agent.md)
    const multilineBlueprint = `---
identity_id: "${AGENT_ID}"
name: "Multi-line Array Test"
model: "mock:test-model"
capabilities:
  - ${CAP_TESTING}
  - ${CAP_VALIDATION}
  - ${CAP_DEBUGGING}
created: "2026-01-18T14:00:00Z"
created_by: "tester"
version: "1.0.0"
default_skills:
  - ${SKILL_TS}
  - ${SKILL_DENO}
---

# Multi-line Array Test

This blueprint uses multi-line YAML array format.
`;
    await Deno.writeTextFile(join(blueprintsDir, `${AGENT_ID}.md`), multilineBlueprint);

    // Use ConfigSchema to create a valid config object with defaults
    const config = ConfigSchema.parse({
      system: { root: tempDir, log_level: "info" },
      paths: { ...ExaPathDefaults },
    });

    const stubDb = createStubDb();

    const blueprintCommands = new BlueprintCommands(
      createStubContext({ config: createStubConfig(config), db: stubDb }),
    );

    // List should find the blueprint and parse arrays correctly
    const blueprints = await blueprintCommands.list();

    assertEquals(blueprints.length, 1, "Should find multi-line blueprint");
    assertEquals(blueprints[0].identity_id, AGENT_ID);

    // CRITICAL: capabilities should be an array, not a string
    assertEquals(Array.isArray(blueprints[0].capabilities), true, "capabilities should be an array");
    assertEquals(blueprints[0].capabilities?.length, 3, "Should have 3 capabilities");
    assertEquals(blueprints[0].capabilities, [CAP_TESTING, CAP_VALIDATION, CAP_DEBUGGING]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
