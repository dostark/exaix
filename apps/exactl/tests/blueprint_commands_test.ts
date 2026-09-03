/**
 * @module BlueprintCommandsTest
 * @path apps/exactl/tests/blueprint_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI commands for agent blueprint management, including template-based
 * generation, schema validation, and storage within the Blueprints directory.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { BlueprintCommands } from "../src/commands/blueprint_commands.ts";
import { BlueprintStatus } from "@exaix/core";
import type { ICommandContext } from "@exaix/cli/base.ts";
import { TestEnvironment } from "../../../tests/integration/helpers/test_environment.ts";
import { TEST_MODEL_ANTHROPIC } from "@exaix/testing";
import {
  TEST_BLUEPRINT_ERROR_MISSING_FRONTMATTER,
  TEST_BLUEPRINT_MISSING_AGENT_ID,
  TEST_BLUEPRINT_NO_FRONTMATTER_CONTENT,
  TEST_BLUEPRINT_NO_FRONTMATTER_ID,
  TEST_BLUEPRINT_YAML_AGENT_ID,
  TEST_BLUEPRINT_YAML_CAPABILITY_ONE,
  TEST_BLUEPRINT_YAML_CAPABILITY_TWO,
  TEST_BLUEPRINT_YAML_CREATED,
  TEST_BLUEPRINT_YAML_CREATED_BY,
  TEST_BLUEPRINT_YAML_MODEL,
  TEST_BLUEPRINT_YAML_NAME,
  TEST_BLUEPRINT_YAML_VERSION,
} from "@exaix/testing";

// Test Setup

let testEnv: TestEnvironment;
let commands: BlueprintCommands;
let context: ICommandContext;

async function setupTest() {
  testEnv = await TestEnvironment.create();
  context = testEnv.getContext();
  commands = new BlueprintCommands(context);
}

async function teardownTest() {
  await testEnv.cleanup();
}

// Test Suite: Blueprint Create Command

Deno.test("[blueprint] create - generates valid blueprint file", async () => {
  await setupTest();
  try {
    const agentRole = `test-agent-${Date.now()}`;
    const result = await commands.create(agentRole, {
      name: "Test Agent",
      model: "ollama:codellama:13b",
    });

    // Verify result structure
    assertExists(result);
    assertEquals(result.agent_role, agentRole);
    assertEquals(result.name, "Test Agent");
    assertEquals(result.model, "ollama:codellama:13b");

    // Verify file exists
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      `${agentRole}.md`,
    );
    assertEquals(await exists(blueprintPath), true);

    // Verify file content (YAML frontmatter; the writer emits `---` blocks).
    const content = await Deno.readTextFile(blueprintPath);
    assertStringIncludes(content, "---");
    assertStringIncludes(content, `agent_role: ${agentRole}`);
    assertStringIncludes(content, "name: Test Agent");
    assertStringIncludes(content, "model: 'ollama:codellama:13b'");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - validates against schema", async () => {
  await setupTest();
  try {
    const result = await commands.create("valid-agent", {
      name: "Valid Agent",
      model: `anthropic:${TEST_MODEL_ANTHROPIC}`,
    });

    // Verify all required fields present
    assertExists(result.agent_role);
    assertExists(result.name);
    assertExists(result.model);
    assertExists(result.created);
    assertExists(result.created_by);
    assertExists(result.version);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - clones an existing agent role with --from", async () => {
  await setupTest();
  try {
    // Seed a prototype agent role, then clone it via --from.
    await commands.create("proto-agent", {
      name: "Proto Agent",
      model: "anthropic:claude-sonnet",
      capabilities: "code_generation,review",
    });

    const result = await commands.create("cloned-agent", {
      name: "Cloned Agent",
      from: "proto-agent",
    });

    // The prototype's model and capabilities are inherited.
    assertEquals(result.model, "anthropic:claude-sonnet");
    assertExists(result.capabilities);
    assertEquals(result.capabilities?.includes("code_generation"), true);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - --from with explicit overrides wins", async () => {
  await setupTest();
  try {
    await commands.create("proto2", {
      name: "Proto2",
      model: "anthropic:claude-sonnet",
      capabilities: "a,b",
    });

    const result = await commands.create("cloned2", {
      name: "Cloned2",
      from: "proto2",
      model: "openai:gpt-4o", // explicit override beats the prototype
    });

    assertEquals(result.model, "openai:gpt-4o");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - --from a missing agent role errors", async () => {
  await setupTest();
  try {
    let threw = false;
    try {
      await commands.create("orphan", { name: "Orphan", from: "does-not-exist" });
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "cloning a non-existent agent role must throw");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - loads system prompt from file", async () => {
  await setupTest();
  try {
    // Create temporary prompt file
    const promptFile = join(testEnv.tempDir, "test-prompt.txt");
    await Deno.writeTextFile(promptFile, "Custom system prompt with <thought> and <content> tags.");

    const _result = await commands.create("custom-agent", {
      name: "Custom Agent",
      model: "ollama:llama3.2",
      systemPromptFile: promptFile,
    });

    // Verify prompt loaded
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "custom-agent.md",
    );
    const content = await Deno.readTextFile(blueprintPath);
    assertStringIncludes(content, "Custom system prompt");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - rejects reserved agent_role names", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.create("system", {
          name: "System Agent",
          model: "ollama:llama3.2",
        });
      },
      Error,
      "reserved",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - rejects duplicate agent_role", async () => {
  await setupTest();
  try {
    // Create first blueprint
    await commands.create("duplicate-test", {
      name: "First Agent",
      model: "ollama:llama3.2",
    });

    // Attempt to create duplicate
    await assertRejects(
      async () => {
        await commands.create("duplicate-test", {
          name: "Second Agent",
          model: "ollama:llama3.2",
        });
      },
      Error,
      "already exists",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - rejects invalid agent_role format", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.create("Invalid_Agent", {
          name: "Invalid Agent",
          model: "ollama:llama3.2",
        });
      },
      Error,
      "lowercase alphanumeric",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - logs to IActivity Journal", async () => {
  await setupTest();
  try {
    await commands.create("journal-test", {
      name: "Journal Test Agent",
      model: "ollama:llama3.2",
    });

    // Flush pending database writes
    await testEnv.db.waitForFlush();

    // Verify activity logged
    const activities = testEnv.db.getActivitiesByActionType("blueprint.created");

    assertEquals(activities.length >= 1, true);
    // The target field should contain the agent_role
    const activity = activities.find((a) => a.target === "journal-test");
    assertExists(activity);
  } finally {
    await teardownTest();
  }
});

// Test Suite: Blueprint List Command

Deno.test("[blueprint] list - shows all blueprints", async () => {
  await setupTest();
  try {
    // Create test blueprints
    await commands.create("agent-1", { name: "Agent 1", model: "ollama:llama3.2" });
    await commands.create("agent-2", { name: "Agent 2", model: "ollama:llama3.2" });
    await commands.create("agent-3", { name: "Agent 3", model: "ollama:llama3.2" });

    const blueprints = await commands.list();

    assertEquals(blueprints.length >= 3, true);
    assertEquals(blueprints.some((b) => b.agent_role === "agent-1"), true);
    assertEquals(blueprints.some((b) => b.agent_role === "agent-2"), true);
    assertEquals(blueprints.some((b) => b.agent_role === "agent-3"), true);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - returns metadata", async () => {
  await setupTest();
  try {
    await commands.create("meta-test", {
      name: "Meta Test Agent",
      model: "anthropic:claude-sonnet",
    });

    const blueprints = await commands.list();
    const blueprint = blueprints.find((b) => b.agent_role === "meta-test");

    assertExists(blueprint);
    if (!blueprint) throw new Error("Blueprint not found");
    assertEquals(blueprint.agent_role, "meta-test");
    assertEquals(blueprint.name, "Meta Test Agent");
    assertEquals(blueprint.model, "anthropic:claude-sonnet");
    assertExists(blueprint.created);
    assertExists(blueprint.created_by);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - parses YAML inline arrays with invalid JSON", async () => {
  await setupTest();
  try {
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      `${TEST_BLUEPRINT_YAML_AGENT_ID}.md`,
    );
    const yamlContent = `---
agent_role: "${TEST_BLUEPRINT_YAML_AGENT_ID}"
name: "${TEST_BLUEPRINT_YAML_NAME}"
model: "${TEST_BLUEPRINT_YAML_MODEL}"
capabilities: [${TEST_BLUEPRINT_YAML_CAPABILITY_ONE}, ${TEST_BLUEPRINT_YAML_CAPABILITY_TWO}]
created: "${TEST_BLUEPRINT_YAML_CREATED}"
created_by: "${TEST_BLUEPRINT_YAML_CREATED_BY}"
version: "${TEST_BLUEPRINT_YAML_VERSION}"
---

Inline YAML array test
`;
    await Deno.writeTextFile(blueprintPath, yamlContent);

    const blueprints = await commands.list();
    const blueprint = blueprints.find((b) => b.agent_role === TEST_BLUEPRINT_YAML_AGENT_ID);

    assertExists(blueprint);
    if (!blueprint) throw new Error("Blueprint not found");
    assertEquals(Array.isArray(blueprint.capabilities), true);
    assertEquals(blueprint.capabilities?.length, 0);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - skips YAML frontmatter missing agent_role", async () => {
  await setupTest();
  try {
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      `${TEST_BLUEPRINT_MISSING_AGENT_ID}.md`,
    );
    const yamlContent = `---
name: "Missing Agent Id"
model: "${TEST_BLUEPRINT_YAML_MODEL}"
created: "${TEST_BLUEPRINT_YAML_CREATED}"
created_by: "${TEST_BLUEPRINT_YAML_CREATED_BY}"
version: "${TEST_BLUEPRINT_YAML_VERSION}"
---

Missing agent_role
`;
    await Deno.writeTextFile(blueprintPath, yamlContent);

    const blueprints = await commands.list();
    assertEquals(blueprints.length, 0);
  } finally {
    await teardownTest();
  }
});

// Test Suite: Blueprint Show Command

Deno.test("[blueprint] show - displays full blueprint", async () => {
  await setupTest();
  try {
    await commands.create("show-test", {
      name: "Show Test Agent",
      model: "ollama:llama3.2",
    });

    const details = await commands.show("show-test");

    assertExists(details);
    assertEquals(details.agent_role, "show-test");
    assertExists(details.content);
    assertStringIncludes(details.content, "---");
    assertStringIncludes(details.content, "agent_role: show-test");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] show - rejects non-existent blueprint", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.show("non-existent");
      },
      Error,
      "not found",
    );
  } finally {
    await teardownTest();
  }
});

// Test Suite: Blueprint Validate Command

Deno.test("[blueprint] validate - accepts valid blueprint", async () => {
  await setupTest();
  try {
    await commands.create("valid-blueprint", {
      name: "Valid Blueprint",
      model: "ollama:llama3.2",
    });

    const result = await commands.validate("valid-blueprint");

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] validate - detects missing required fields", async () => {
  await setupTest();
  try {
    // Manually create invalid blueprint
    const blueprintPath = join(testEnv.config.system.root, testEnv.config.paths.blueprints, "Agents", "invalid.md");
    await Deno.writeTextFile(
      blueprintPath,
      `+++
name = "Invalid"
+++

Content without agent_role
`,
    );

    const result = await commands.validate("invalid");

    assertEquals(result.valid, false);
    assertEquals(result.errors.length > 0, true);
    assertStringIncludes(result.errors.join(" "), "agent_role");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] validate - checks system prompt format", async () => {
  await setupTest();
  try {
    // Create blueprint with missing output format tags
    const blueprintPath = join(testEnv.config.system.root, testEnv.config.paths.blueprints, "Agents", "no-tags.md");
    await Deno.writeTextFile(
      blueprintPath,
      `+++
agent_role = "no-tags"
name = "No Tags"
model = "ollama:llama3.2"
created = "2025-12-02T10:00:00Z"
created_by = "test"
version = "1.0.0"
+++

System prompt without thought and content tags.
`,
    );

    const result = await commands.validate("no-tags");

    assertEquals(result.valid, false);
    assertEquals(
      result.errors.some((e: string) => e.includes("<thought>") || e.includes("<content>")),
      true,
    );
  } finally {
    await teardownTest();
  }
});

// Test Suite: Blueprint Remove Command

Deno.test("[blueprint] remove - deletes blueprint file", async () => {
  await setupTest();
  try {
    await commands.create("remove-test", {
      name: "Remove Test",
      model: "ollama:llama3.2",
    });

    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "remove-test.md",
    );
    assertEquals(await exists(blueprintPath), true);

    await commands.remove("remove-test", { force: true });

    assertEquals(await exists(blueprintPath), false);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] remove - logs to IActivity Journal", async () => {
  await setupTest();
  try {
    await commands.create("remove-journal", {
      name: "Remove Journal Test",
      model: "ollama:llama3.2",
    });

    await commands.remove("remove-journal", { force: true });

    // Flush pending database writes
    await testEnv.db.waitForFlush();

    const activities = testEnv.db.getActivitiesByActionType("blueprint.removed");

    // The target field should contain the agent_role
    const activity = activities.find((a) => a.target === "remove-journal");
    assertExists(activity);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] remove - rejects non-existent blueprint", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.remove("non-existent", { force: true });
      },
      Error,
      "not found",
    );
  } finally {
    await teardownTest();
  }
});

// Test Suite: Edit Command

Deno.test("[blueprint] edit - validates after editing", async () => {
  await setupTest();
  try {
    // Create a blueprint first
    await commands.create("edit-test", {
      name: "Edit Test",
      model: "ollama:llama3.2",
    });

    // Mock EDITOR environment variable to use 'true' command (exits successfully)
    const originalEditor = Deno.env.get("EDITOR");
    Deno.env.set("EDITOR", "true");

    try {
      // Edit should succeed and validate
      await commands.edit("edit-test");

      // Verify activity logged
      await testEnv.db.waitForFlush();
      const activities = testEnv.db.getActivitiesByActionType("blueprint.edited");
      const activity = activities.find((a) => a.target === "edit-test");
      assertExists(activity);
    } finally {
      // Restore original EDITOR
      if (originalEditor) {
        Deno.env.set("EDITOR", originalEditor);
      } else {
        Deno.env.delete("EDITOR");
      }
    }
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] edit - rejects non-existent blueprint", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.edit("non-existent");
      },
      Error,
      "not found",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] edit - allows save when only warnings exist", async () => {
  await setupTest();
  try {
    // Create a blueprint with valid frontmatter and required tags
    // but short body (< 50 chars) to trigger warnings only
    await commands.create("warn-test", {
      name: "Warn Test",
      model: "ollama:llama3.2",
    });

    // Overwrite with short valid content: has tags, but < 50 chars → warning
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "warn-test.md",
    );
    const shortContent = `+++
agent_role = "warn-test"
name = "Warn Test"
model = "ollama:llama3.2"
version = "1.0.0"
created = "2026-05-27T00:00:00Z"
created_by = "test"
+++

<thought></thought><content></content>`;
    await Deno.writeTextFile(blueprintPath, shortContent);

    const originalEditor = Deno.env.get("EDITOR");
    Deno.env.set("EDITOR", "true");

    try {
      // Should NOT throw — warnings should not block save
      await commands.edit("warn-test");

      // Verify activity logged
      await testEnv.db.waitForFlush();
      const activities = testEnv.db.getActivitiesByActionType("blueprint.edited");
      const activity = activities.find((a) => a.target === "warn-test");
      assertExists(activity);
    } finally {
      if (originalEditor) {
        Deno.env.set("EDITOR", originalEditor);
      } else {
        Deno.env.delete("EDITOR");
      }
    }
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] edit - blocks save when validation errors exist", async () => {
  await setupTest();
  try {
    // Create a blueprint with valid content
    await commands.create("error-test", {
      name: "Error Test",
      model: "ollama:llama3.2",
    });

    // Overwrite with content missing required tags → error, no save
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "error-test.md",
    );
    const errorContent = `+++
agent_role = "error-test"
name = "Error Test"
model = "ollama:llama3.2"
version = "1.0.0"
+++

No thought or content tags here at all.`;
    await Deno.writeTextFile(blueprintPath, errorContent);

    const originalEditor = Deno.env.get("EDITOR");
    Deno.env.set("EDITOR", "true");

    try {
      await assertRejects(
        async () => {
          await commands.edit("error-test");
        },
        Error,
        "validation",
      );
    } finally {
      if (originalEditor) {
        Deno.env.set("EDITOR", originalEditor);
      } else {
        Deno.env.delete("EDITOR");
      }
    }
  } finally {
    await teardownTest();
  }
});

// Additional edge case tests for improved coverage

Deno.test("[blueprint] create - rejects when system prompt file not found", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.create("test-agent", {
          name: "Test Agent",
          model: "ollama:llama3.2",
          systemPromptFile: "/nonexistent/file.txt",
        });
      },
      Error,
      "System prompt file not found",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - rejects system prompt without required tags", async () => {
  await setupTest();
  try {
    const promptFile = join(testEnv.tempDir, "invalid-prompt.txt");
    await Deno.writeTextFile(promptFile, "System prompt without required tags");

    await assertRejects(
      async () => {
        await commands.create("test-agent", {
          name: "Test Agent",
          model: "ollama:llama3.2",
          systemPromptFile: promptFile,
        });
      },
      Error,
      "must include output format instructions",
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] validate - warns on provider mismatch", async () => {
  await setupTest();
  try {
    // Create blueprint with anthropic model
    await commands.create("mismatch-test", {
      name: "Mismatch Test",
      model: "anthropic:claude-sonnet",
    });

    // Validation should succeed but may have warnings
    const result = await commands.validate("mismatch-test");
    assertEquals(result.valid, true);
    // Warnings depend on config.ai.provider setting
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] create - handles empty description gracefully", async () => {
  await setupTest();
  try {
    const result = await commands.create("no-desc", {
      name: "No Description",
      model: "ollama:llama3.2",
      description: "",
    });

    assertExists(result.path);
    assertEquals(result.agent_role, "no-desc");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - returns empty array when no blueprints", async () => {
  await setupTest();
  try {
    const results = await commands.list();
    assertEquals(results, []);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] validate - reports missing frontmatter", async () => {
  await setupTest();
  try {
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      `${TEST_BLUEPRINT_NO_FRONTMATTER_ID}.md`,
    );
    await Deno.writeTextFile(blueprintPath, TEST_BLUEPRINT_NO_FRONTMATTER_CONTENT);

    const result = await commands.validate(TEST_BLUEPRINT_NO_FRONTMATTER_ID);
    assertEquals(result.valid, false);
    assertStringIncludes(result.errors.join("\n"), TEST_BLUEPRINT_ERROR_MISSING_FRONTMATTER);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] show - throws on blueprint with invalid frontmatter", async () => {
  await setupTest();
  try {
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "bad-format.md",
    );
    await Deno.writeTextFile(
      blueprintPath,
      `Not a valid blueprint format\nNo frontmatter`,
    );

    await assertRejects(
      async () => {
        await commands.show("bad-format");
      },
      Error,
      "Invalid blueprint format",
    );
  } finally {
    await teardownTest();
  }
});

// Test Suite: Blueprint Status Lifecycle & Filters

Deno.test("[blueprint] list - includes status defaulting to active", async () => {
  await setupTest();
  try {
    await commands.create("active-default", { name: "Active Default", model: "ollama:llama3.2" });

    const [blueprint] = await commands.list();
    assertEquals(blueprint.status, BlueprintStatus.ACTIVE);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] deprecate - sets status to deprecated", async () => {
  await setupTest();
  try {
    await commands.create("to-deprecate", { name: "To Deprecate", model: "ollama:llama3.2" });

    await commands.deprecate("to-deprecate");

    const detail = await commands.show("to-deprecate");
    assertEquals(detail.status, BlueprintStatus.DEPRECATED);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] deprecate - logs blueprint.deprecated activity", async () => {
  await setupTest();
  try {
    await commands.create("journal-deprecate", { name: "Journal Deprecate", model: "ollama:llama3.2" });

    await commands.deprecate("journal-deprecate");

    await testEnv.db.waitForFlush();

    const activities = testEnv.db.getActivitiesByActionType("blueprint.deprecated");
    assertEquals(activities.length >= 1, true);
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] deprecate - rejects unknown blueprint", async () => {
  await setupTest();
  try {
    await assertRejects(
      async () => {
        await commands.deprecate("does-not-exist");
      },
      Error,
    );
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - filters by status", async () => {
  await setupTest();
  try {
    await commands.create("stays-active", { name: "Stays Active", model: "ollama:llama3.2" });
    await commands.create("gets-deprecated", { name: "Gets Deprecated", model: "ollama:llama3.2" });
    await commands.deprecate("gets-deprecated");

    const deprecated = await commands.list({ status: BlueprintStatus.DEPRECATED });
    assertEquals(deprecated.length, 1);
    assertEquals(deprecated[0].agent_role, "gets-deprecated");

    const active = await commands.list({ status: BlueprintStatus.ACTIVE });
    assertEquals(active.length, 1);
    assertEquals(active[0].agent_role, "stays-active");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] list - filters by capability", async () => {
  await setupTest();
  try {
    await commands.create("can-push", {
      name: "Can Push",
      model: "ollama:llama3.2",
      capabilities: "git_push,testing",
    });
    await commands.create("read-only", {
      name: "Read Only",
      model: "ollama:llama3.2",
      capabilities: "general",
    });

    const pushers = await commands.list({ capability: "git_push" });
    assertEquals(pushers.length, 1);
    assertEquals(pushers[0].agent_role, "can-push");
  } finally {
    await teardownTest();
  }
});

Deno.test("[blueprint] deprecate - writes the `deprecated` flag that routing consumes", async () => {
  await setupTest();
  try {
    await commands.create("routing-deprecate", { name: "Routing Deprecate", model: "ollama:llama3.2" });

    await commands.deprecate("routing-deprecate");

    // The capability matcher reads frontmatter.deprecated; deprecate must set it
    // (not a separate status label) for deprecation to have a runtime effect.
    const blueprintPath = join(
      testEnv.config.system.root,
      testEnv.config.paths.blueprints,
      "Agents",
      "routing-deprecate.md",
    );
    const raw = await Deno.readTextFile(blueprintPath);
    assertEquals(/deprecated\s*[:=]\s*true/.test(raw), true);
  } finally {
    await teardownTest();
  }
});
