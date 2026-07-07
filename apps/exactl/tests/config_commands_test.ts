/**
 * @module ConfigCommandsTest
 * @path apps/exactl/tests/config_commands_test.ts
 * @description Tests for ConfigCommands CLI class.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertRejects } from "@std/assert";
import { createMockConfig, createStubConfig, createStubContext } from "@exaix/testing";
import { ConfigOutputFormat, ConfigValueType } from "@exaix/core/types";
import { configurable, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";

// RED: will fail until source file exists
import { ConfigCommands } from "../src/commands/config_commands.ts";

// Register test keys for CLI tests
configurable({
  key: "cli_test.greeting",
  default: "hello",
  type: ConfigValueType.STRING,
  description: "CLI test greeting",
  enum: ["hello", "hi", "hey"] as readonly string[],
});
configurable({
  key: "cli_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "CLI test timeout",
  min: 1000,
  max: 120000,
});
configurable({
  key: "cli_test.enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "CLI test enabled",
});

function setupConfigTest(): {
  commands: ConfigCommands;
  dir: string;
  cleanup: () => void;
} {
  const dir = Deno.makeTempDirSync({ prefix: "config-cmd-test-" });
  const dbPath = ensureConfigDb(dir);
  const db = new Database(dbPath);
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
  } finally {
    db.close();
  }

  const mockConfig = createMockConfig(dir);
  const configService = createStubConfig(mockConfig);
  const context = createStubContext({ config: configService });
  const commands = new ConfigCommands(context);
  return { commands, dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

Deno.test("[configuring] ConfigCommands.get returns value", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    const value = await commands.get("cli_test.greeting");
    assertEquals(value, "hello");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.get throws on unknown key", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    await assertRejects(
      () => commands.get("nonexistent.key"),
      Error,
      "not found",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.set parses and validates", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    await commands.set("cli_test.timeout_ms", "60000");
    const value = await commands.get("cli_test.timeout_ms");
    assertEquals(value, 60000);
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.set rejects invalid input", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    await assertRejects(
      () => commands.set("cli_test.timeout_ms", "not_a_number"),
      Error,
    );
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.unset calls adapter.unset", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    await commands.set("cli_test.greeting", "hey");
    assertEquals(await commands.get("cli_test.greeting"), "hey");
    await commands.unset("cli_test.greeting");
    assertEquals(await commands.get("cli_test.greeting"), "hello");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.validate returns report", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    const report = await commands.validate("cli_test.timeout_ms");
    assertEquals(report.valid, true);
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.show human output", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    const output = await commands.show(ConfigOutputFormat.HUMAN);
    assertEquals(typeof output, "string");
    assertEquals(output.length > 0, true);
    assertEquals(output.includes("cli_test"), true);
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands.show json output", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    const output = await commands.show(ConfigOutputFormat.JSON);
    const parsed = JSON.parse(output) as { cli_test?: { greeting?: string } };
    assertEquals(typeof parsed, "object");
    assertEquals(parsed.cli_test?.greeting, "hello");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] ConfigCommands parses string value", async () => {
  const { commands, cleanup } = setupConfigTest();
  try {
    await commands.set("cli_test.greeting", "hi");
    assertEquals(await commands.get("cli_test.greeting"), "hi");
  } finally {
    cleanup();
  }
});
