/**
 * @module BlueprintManagementIntegrationTest
 * @path tests/integration/blueprint_management_test.ts
 * @description Verifies the full lifecycle of agent blueprints, ensuring correct
 * command-driven creation, listing, and discovery within project boundaries.
 */

import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { BlueprintCommands } from "../../apps/exactl/src/commands/blueprint_commands.ts";
import { readFixtureTextSync } from "@exaix/testing";
import type { IBlueprintMetadata } from "@exaix/schemas/blueprint.ts";

Deno.test("Integration: Blueprint Management - Full Lifecycle", async (t) => {
  const env = await TestEnvironment.create();
  const blueprintCommands = new BlueprintCommands(env.getContext());

  try {
    let customPromptPath: string;
    const testAgentId = "integration-test-agent";
    const coderAgentId = "integration-coder";
    const customAgentId = "custom-prompt-agent";

    // ========================================================================
    // Test 1: Create Blueprint from Scratch
    // ========================================================================
    await t.step("Test 1: Create blueprint with valid YAML frontmatter", async () => {
      const result = await blueprintCommands.create(testAgentId, {
        name: "Integration Test Agent",
        model: "ollama:codellama:13b",
        description: "Test agent for integration testing",
        capabilities: "code_generation,debugging",
      });

      assertExists(result.path, "Blueprint path should be returned");
      assertEquals(result.identity_id, testAgentId);

      // Verify file exists
      const blueprintPath = join(env.tempDir, "Blueprints", "Identities", `${testAgentId}.md`);
      const fileExists = await exists(blueprintPath);
      assertEquals(fileExists, true, "Blueprint file should exist");

      // Verify YAML frontmatter format (TOML→YAML migration completed in Step 2).
      const content = await Deno.readTextFile(blueprintPath);
      assertStringIncludes(content, "---", "Should use YAML delimiters");
      assertStringIncludes(content, `identity_id: ${testAgentId}`);
      assertStringIncludes(content, "name: Integration Test Agent");
      assertStringIncludes(content, "model: 'ollama:codellama:13b'");
      assertStringIncludes(content, "capabilities:");

      // Verify IActivity Journal
      await env.db.waitForFlush();
      const activities = env.db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = 'blueprint.created' AND target LIKE ?",
      ).all(`%${testAgentId}%`);
      assertEquals(activities.length, 1, "Should log blueprint.created activity");
    });

    // ========================================================================
    // Test 2: Create Blueprint by cloning an existing one (--from)
    // ========================================================================
    await t.step("Test 2: --from clones model and capabilities from a prototype identity", async () => {
      // Clone the identity created in Test 1.
      const result = await blueprintCommands.create(coderAgentId, {
        name: "Integration Coder",
        from: testAgentId,
      });

      const blueprintPath = result.path;
      const content = await Deno.readTextFile(blueprintPath);

      // The prototype's model and capabilities are inherited.
      assertStringIncludes(content, "model: 'ollama:codellama:13b'");
      assertStringIncludes(content, "code_generation");
      assertStringIncludes(content, "debugging");
      assertEquals(result.model, "ollama:codellama:13b");
    });

    // ========================================================================
    // Test 3: Create Blueprint with Custom System Prompt from File
    // ========================================================================
    await t.step("Test 3: Custom system prompt loaded from file", async () => {
      customPromptPath = join(env.tempDir, "custom-prompt.txt");
      const customPrompt = readFixtureTextSync(
        import.meta.url,
        "integration",
        "blueprint_management_test",
        "customPrompt.md",
      );

      await Deno.writeTextFile(customPromptPath, customPrompt);

      const result = await blueprintCommands.create(customAgentId, {
        name: "Custom Prompt Agent",
        model: "ollama:codellama:13b",
        systemPromptFile: customPromptPath,
      });

      const content = await Deno.readTextFile(result.path);
      assertStringIncludes(content, "You are a specialized integration testing agent.");
      assertStringIncludes(content, "<thought>");
      assertStringIncludes(content, "<content>");
    });

    // ========================================================================
    // Test 4: Validation Detects Invalid Blueprints
    // ========================================================================
    await t.step("Test 4: Validation detects missing fields", async () => {
      // Create invalid blueprint manually
      const invalidPath = join(env.tempDir, "Blueprints", "Identities", "invalid-test.md");
      const invalidContent = `---
name: Missing identity_id
model: ollama:llama3.2
---

Invalid blueprint without identity_id field
`;
      await Deno.writeTextFile(invalidPath, invalidContent);

      // Validation should return errors
      const result = await blueprintCommands.validate("invalid-test");
      assertEquals(result.valid, false, "Validation should fail");
      assert(result.errors.length > 0, "Should have validation errors");
      assert(
        result.errors.some((e: string) => e.includes("identity_id")),
        "Should report missing identity_id",
      );
    });

    // ========================================================================
    // Test 5: Reserved Names Rejected
    // ========================================================================
    await t.step("Test 5: Reserved identity_id names rejected", async () => {
      await assertRejects(
        async () =>
          await blueprintCommands.create("system", {
            name: "System Agent",
            model: "ollama:llama3.2",
          }),
        Error,
        "reserved",
      );

      await assertRejects(
        async () =>
          await blueprintCommands.create("test", {
            name: "Test Agent",
            model: "ollama:llama3.2",
          }),
        Error,
        "reserved",
      );
    });

    // ========================================================================
    // Test 6: Duplicate Names Rejected
    // ========================================================================
    await t.step("Test 6: Duplicate identity_id rejected", async () => {
      await assertRejects(
        async () =>
          await blueprintCommands.create(testAgentId, {
            name: "Duplicate Agent",
            model: "ollama:llama3.2",
          }),
        Error,
        "already exists",
      );
    });

    // ========================================================================
    // Test 7: Edit Blueprint
    // ========================================================================
    await t.step("Test 7: Edit modifies blueprint and re-validates", async () => {
      const blueprintPath = join(env.tempDir, "Blueprints", "Identities", `${testAgentId}.md`);
      const originalContent = await Deno.readTextFile(blueprintPath);

      // Modify blueprint directly (simulating manual edit) — YAML frontmatter.
      const modifiedContent = originalContent.replace(
        "model: 'ollama:codellama:13b'",
        "model: 'ollama:llama3.2:latest'",
      );
      await Deno.writeTextFile(blueprintPath, modifiedContent);

      // Validate the edit
      const result = await blueprintCommands.validate(testAgentId);
      assertEquals(result.valid, true);

      // Verify change persisted
      const updatedContent = await Deno.readTextFile(blueprintPath);
      assertStringIncludes(updatedContent, "model: 'ollama:llama3.2:latest'");
    });

    // ========================================================================
    // Test 8: Use Blueprint in Request
    // ========================================================================
    await t.step("Test 8: Blueprint referenced in request creation", async () => {
      const { filePath } = await env.createRequest(
        "Test request using custom agent",
        { identityId: testAgentId },
      );

      const content = await Deno.readTextFile(filePath);
      assertStringIncludes(content, `identity_id: ${testAgentId}`);

      // Verify request can be processed (blueprint exists and is valid)
      const blueprintPath = join(env.tempDir, "Blueprints", "Identities", `${testAgentId}.md`);
      const blueprintExists = await exists(blueprintPath);
      assertEquals(blueprintExists, true, "Blueprint should exist for request processing");
    });

    // ========================================================================
    // Test 9: List Blueprints
    // ========================================================================
    await t.step("Test 9: List shows all created blueprints", async () => {
      const blueprints = await blueprintCommands.list();

      assert(blueprints.length >= 3, "Should have at least 3 blueprints");

      const identityIds = blueprints.map((b: IBlueprintMetadata) => b.identity_id);
      assert(identityIds.includes(testAgentId), "Should include test agent");
      assert(identityIds.includes(coderAgentId), "Should include coder agent");
      assert(identityIds.includes(customAgentId), "Should include custom agent");
    });

    // ========================================================================
    // Test 10: Show Blueprint Details
    // ========================================================================
    await t.step("Test 10: Show displays full blueprint content", async () => {
      const result = await blueprintCommands.show(testAgentId);

      assertExists(result.content, "Should return content");

      assertEquals(result.identity_id, testAgentId);
      assertEquals(result.name, "Integration Test Agent");
      assertStringIncludes(result.content, "<thought>");
      assertStringIncludes(result.content, "<content>");
    });

    // ========================================================================
    // Test 11: Remove Blueprints
    // ========================================================================
    await t.step("Test 11: Remove deletes blueprint file", async () => {
      // Remove test blueprints
      await blueprintCommands.remove(customAgentId, { force: true });
      await blueprintCommands.remove(coderAgentId, { force: true });
      await blueprintCommands.remove(testAgentId, { force: true });

      // Verify files deleted
      const testPath = join(env.tempDir, "Blueprints", "Identities", `${testAgentId}.md`);
      const coderPath = join(env.tempDir, "Blueprints", "Identities", `${coderAgentId}.md`);
      const customPath = join(env.tempDir, "Blueprints", "Identities", `${customAgentId}.md`);

      assertEquals(await exists(testPath), false, "Test agent blueprint should be deleted");
      assertEquals(await exists(coderPath), false, "Coder agent blueprint should be deleted");
      assertEquals(await exists(customPath), false, "Custom agent blueprint should be deleted");

      // Verify removal activity logged
      await env.db.waitForFlush();
      const activities = env.db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = 'blueprint.removed'",
      ).all();
      assert(activities.length >= 3, "Should log removal activities");
    });

    // ========================================================================
    // Test 12: IActivity Journal Completeness
    // ========================================================================
    await t.step("Test 12: All operations logged to IActivity Journal", async () => {
      await env.db.waitForFlush();

      const blueprintActivities = env.db.instance.prepare(
        "SELECT action_type, COUNT(*) as count FROM activity WHERE action_type LIKE 'blueprint.%' GROUP BY action_type",
      ).all() as Array<{ action_type: string; count: number }>;

      const activityTypes = new Map(
        blueprintActivities.map((row) => [
          row.action_type,
          row.count,
        ]),
      );

      // Verify expected activity types exist
      assert(activityTypes.has("blueprint.created"), "Should log created events");
      assert(activityTypes.has("blueprint.removed"), "Should log removed events");

      // Verify counts
      assert(
        activityTypes.get("blueprint.created")! >= 3,
        "Should have created at least 3 blueprints",
      );
      assert(
        activityTypes.get("blueprint.removed")! >= 3,
        "Should have removed at least 3 blueprints",
      );
    });
  } finally {
    await env.cleanup();
  }
});
