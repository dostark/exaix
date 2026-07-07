/**
 * @module ConfiguringEndToEndTest
 * @path tests/configuring/config_cli_test.ts
 * @description End-to-end integration tests for the config CLI commands.
 *   Verifies the full stack: CLI invocation → ConfigCommands → DirectConfigAdapter → Config DB.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { ConfigOutputFormat, ConfigValueType } from "@exaix/core/types";
import { configurable, createConfigAdapter, insertOverride } from "@exaix/core/config";
import {
  createMockConfig,
  createStubConfig,
  createStubContext,
  createTestConfigDb,
  writeTestConfigFile,
} from "@exaix/testing";
import { withCliProcessMutex } from "../helpers/cli_process_mutex.ts";
import { ConfigCommands } from "../../apps/exactl/src/commands/config_commands.ts";

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

function setupTest(): {
  commands: ConfigCommands;
  dir: string;
  cleanup: () => void;
} {
  const dir = Deno.makeTempDirSync({ prefix: "config-e2e-" });
  createTestConfigDb(dir);
  const mockConfig = createMockConfig(dir);
  const configService = createStubConfig(mockConfig);
  const context = createStubContext({ config: configService });
  const commands = new ConfigCommands(context);
  return { commands, dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

async function runExactl(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
  const exactlPath = join(repoRoot, "apps", "exactl", "main.ts");
  const configPath = join(cwd, "exa.config.toml");

  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {
    PATH: parentEnv.PATH ?? "",
    HOME: parentEnv.HOME ?? "",
    TMPDIR: parentEnv.TMPDIR ?? "/tmp",
    TERM: parentEnv.TERM ?? "xterm",
  };
  env.EXA_CONFIG_PATH = configPath;
  env.EXA_LLM_PROVIDER = "mock";

  const { code, stdout, stderr } = await withCliProcessMutex(async () => {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", exactlPath, ...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
      env,
    });
    return await command.output();
  });

  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("[configuring] end-to-end: set then get returns same value", async () => {
  const { commands, cleanup } = setupTest();
  try {
    await commands.set("cli_test.timeout_ms", "60000");
    const value = await commands.get("cli_test.timeout_ms");
    assertEquals(value, 60000);
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: unset resets to default", async () => {
  const { commands, cleanup } = setupTest();
  try {
    await commands.set("cli_test.greeting", "hi");
    assertEquals(await commands.get("cli_test.greeting"), "hi");
    await commands.unset("cli_test.greeting");
    assertEquals(await commands.get("cli_test.greeting"), "hello");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: validate returns OK for valid config", async () => {
  const { commands, cleanup } = setupTest();
  try {
    const report = await commands.validate();
    assertEquals(report.valid, true);
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: show --json outputs valid JSON", async () => {
  const { commands, cleanup } = setupTest();
  try {
    const output = await commands.show(ConfigOutputFormat.JSON);
    const parsed = JSON.parse(output);
    assertEquals(typeof parsed, "object");
    assertEquals(parsed.cli_test?.greeting, "hello");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: value persists across DB reconnect", async () => {
  const { commands, dir, cleanup } = setupTest();
  try {
    const dbPath = join(dir, ".exa", "config.db");
    await commands.set("cli_test.greeting", "hey");

    const reopened = createConfigAdapter(dbPath);
    const value = reopened.get("cli_test.greeting");
    assertEquals(value, "hey");
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: invalid value rejected with error", async () => {
  const { commands, cleanup } = setupTest();
  try {
    await assertRejects(
      () => commands.set("cli_test.timeout_ms", "not_a_number"),
      Error,
    );
  } finally {
    cleanup();
  }
});

Deno.test("[configuring] end-to-end: unknown key rejected", async () => {
  const { commands, cleanup } = setupTest();
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

Deno.test("[configuring] end-to-end: CLI subprocess get with pre-populated DB", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const dir = Deno.makeTempDirSync({ prefix: "config-e2e-subproc-" });
  try {
    await writeTestConfigFile(dir);
    createTestConfigDb(dir);
    const dbPath = join(dir, ".exa", "config.db");
    const db = new Database(dbPath);
    insertOverride(db, "cli_test.greeting", "hey", "test", "hot");
    db.close();

    const result = await runExactl(["config", "get", "cli_test.greeting"], dir);
    assertEquals(result.code, 0, `CLI exited with code ${result.code}: ${result.stderr}`);
    assertStringIncludes(result.stdout, "hey");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
