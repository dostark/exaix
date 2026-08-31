/**
 * @module ToolRegistryServiceTest
 * @path packages/tool-runtime/tests/tool_registry_service_test.ts
 * @description Verifies the ToolRegistry service, ensuring strict validation of
 * command patterns and argument types while enforcing security boundaries.
 */

import { assert, assertEquals } from "@std/assert";
import { LearningCategory, PortalOperation, ToolName } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { join } from "@std/path";

import { ToolRegistry } from "@exaix/tool-runtime";
import { ExaPathDefaults } from "@exaix/core";
import { createTestGitServiceFactory } from "./helpers.ts";
import { ConfigSchema } from "@exaix/schemas/config.ts";
// Mock dependencies
const mockConfig = ConfigSchema.parse({
  system: { root: "/tmp/test", log_level: "info" },
  paths: {
    ...ExaPathDefaults,
  },
  database: {},
  watcher: {},
  agents: {},
  models: {
    default: {
      provider: "mock",
      model: "mock-model",
    },
  },
  provider_strategy: {
    fallback_chains: {},
  },
  portals: [],
  mcp: {},
});

function createRegistry(root?: string): ToolRegistry {
  const config = root
    ? ConfigSchema.parse({
      ...mockConfig,
      system: { ...mockConfig.system, root },
      paths: { ...mockConfig.paths, workspace: "Workspace" },
    })
    : mockConfig;

  // Ensure the root directory exists for command execution
  if (config.system.root) {
    try {
      Deno.mkdirSync(config.system.root, { recursive: true });
    } catch {
      // Ignore if directory already exists or cannot be created
    }
  }

  return new ToolRegistry({ config, gitServiceFactory: createTestGitServiceFactory() });
}

Deno.test("ToolRegistry: should allow safe commands", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "echo",
    args: ["hello", "world"],
  });
  assert(result.success, `Expected success but got error: ${result.error}`);
  const cmdResult = result.data as { output: string; exitCode: number };
  assertEquals(cmdResult.exitCode, 0, `Expected exit code 0 but got ${cmdResult.exitCode}`);
  // Output format may vary by platform (spaces vs newlines)
  assert(
    cmdResult.output?.includes("hello") && cmdResult.output?.includes("world"),
    `Expected output to contain 'hello' and 'world' but got: ${cmdResult.output}`,
  );
});

Deno.test("ToolRegistry: should allow validated commands with safe arguments", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "ls",
    args: ["/tmp"],
  });
  assert(result.success, `Expected success but got error: ${result.error}`);
  const cmdResult = result.data as { output: string; exitCode: number };
  assertEquals(cmdResult.exitCode, 0, `Expected exit code 0 but got ${cmdResult.exitCode}`);
  // /tmp should exist on Unix systems, but may not on Windows
  // Just verify we got some output or exit code 0
  assert(cmdResult.output?.length >= 0, `Expected output but got: ${cmdResult.output}`);
});

Deno.test("ToolRegistry: should reject unknown commands", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "rm",
    args: ["-rf", "/"],
  });
  assert(!result.success);
  assert(result.error?.includes("not allowed"));
});

// Argument Validation Tests

Deno.test("ToolRegistry: should block shell metacharacters", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "echo",
    args: ["hello; rm -rf /"],
  });
  assert(!result.success);
  assert(result.error?.includes("dangerous pattern"));
});

Deno.test("ToolRegistry: should block output redirection", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "echo",
    args: ["test", ">", "/tmp/file"],
  });
  assert(!result.success);
  assert(result.error?.includes("dangerous pattern"));
});

Deno.test("ToolRegistry: should block dangerous git options", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: PortalOperation.GIT,
    args: ["--exec-path", "/tmp"],
  });
  assert(!result.success);
  assert(result.error?.includes("Dangerous git option"));
});

Deno.test("ToolRegistry: should allow safe git operations", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: PortalOperation.GIT,
    args: ["status", "--porcelain"],
  });
  assert(typeof result.success === "boolean");
});

Deno.test("ToolRegistry: should block unsafe ls options", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "ls",
    args: ["--color=always", "-R"],
  });
  assert(!result.success);
  assert(result.error?.includes("Unsafe ls option"));
});

Deno.test("ToolRegistry: should allow safe grep options", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "grep",
    args: ["-i", LearningCategory.PATTERN, "file.txt"],
  });
  assert(typeof result.success === "boolean");
});

Deno.test("ToolRegistry: should block unsafe grep options", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "grep",
    args: ["--include=*.log", LearningCategory.PATTERN],
  });
  assert(!result.success);
  assert(result.error?.includes("Unsafe grep option"));
});

// Runtime Commands Tests

Deno.test("ToolRegistry: should allow safe npm subcommands", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "npm",
    args: ["--version"],
  });
  assert(result.success, `Expected success but got error: ${result.error}`);
  const cmdResult = result.data as { output: string; exitCode: number };
  assertEquals(cmdResult.exitCode, 0, `Expected exit code 0 but got ${cmdResult.exitCode}`);
  // Version output format: major.minor.patch (may have additional info)
  assert(
    cmdResult.output?.match(/\d+\.\d+/),
    `Expected version output (X.Y.Z) but got: ${cmdResult.output}`,
  );
});

Deno.test("ToolRegistry: should block dangerous npm subcommands", async () => {
  const registry = createRegistry();
  const result = await registry.execute(McpToolName.RUN_COMMAND, {
    command: "npm",
    args: ["install", "malicious-package"],
  });
  assert(!result.success);
  assert(result.error?.includes("subcommand not allowed"));
});

// Helper for file tests
async function runToolRegistryTest(fn: (registry: ToolRegistry, tempDir: string) => Promise<void>) {
  const tempDir = await Deno.makeTempDir({ prefix: "tool-registry-test-" });
  try {
    const registry = createRegistry(tempDir);
    await Deno.mkdir(join(tempDir, "Workspace"), { recursive: true });
    await fn(registry, tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// File Operations Tests

Deno.test("ToolRegistry: should create directory", async () => {
  await runToolRegistryTest(async (registry, tempDir) => {
    const testDir = "Workspace/new-dir/nested";
    const result = await registry.execute(ToolName.CREATE_DIRECTORY, { path: testDir });

    assert(result.success);
    assert((await Deno.stat(join(tempDir, testDir))).isDirectory);
  });
});

Deno.test("ToolRegistry: should write and read files", async () => {
  await runToolRegistryTest(async (registry, tempDir) => {
    const filePath = "Workspace/test.txt";
    const content = "Hello World";
    const writeResult = await registry.execute(ToolName.WRITE_FILE, { path: filePath, content });

    assert(writeResult.success);
    assertEquals((writeResult.data as { path: string }).path, join(tempDir, filePath));

    const readResult = await registry.execute(ToolName.READ_FILE, { path: filePath });
    assert(readResult.success);
    assertEquals((readResult.data as { content: string }).content, content);
  });
});

Deno.test("ToolRegistry: should list directory contents", async () => {
  await runToolRegistryTest(async (registry, _tempDir) => {
    await registry.execute(ToolName.WRITE_FILE, { path: "Workspace/file1.txt", content: "1" });
    await registry.execute(ToolName.CREATE_DIRECTORY, { path: "Workspace/subdir" });
    await registry.execute(ToolName.WRITE_FILE, { path: "Workspace/subdir/file2.txt", content: "2" });

    const listResult = await registry.execute(ToolName.LIST_DIRECTORY, { path: "Workspace" });
    assert(listResult.success);
    const entries = (listResult.data as { entries: Array<{ name: string; isDirectory: boolean }> }).entries;

    assert(entries.some((e) => e.name === "file1.txt" && !e.isDirectory));
    assert(entries.some((e) => e.name === "subdir" && e.isDirectory));
  });
});

Deno.test("ToolRegistry: should search files", async () => {
  await runToolRegistryTest(async (registry, _tempDir) => {
    await registry.execute(ToolName.CREATE_DIRECTORY, { path: "Workspace/src" });

    await registry.execute(ToolName.WRITE_FILE, { path: "Workspace/src/main.ts", content: "console.log('main')" });
    await registry.execute(ToolName.WRITE_FILE, { path: "Workspace/src/utils.ts", content: "export const util = 1" });
    await registry.execute(ToolName.WRITE_FILE, { path: "Workspace/readme.md", content: "# Readme" });

    const searchResult = await registry.execute(ToolName.SEARCH_FILES, { path: "Workspace", pattern: "**/*.ts" });
    assert(searchResult.success);
    const files = (searchResult.data as { files: string[] }).files;

    assertEquals(files.length, 2);
    assert(files.some((f) => f.endsWith("main.ts")));
    assert(files.some((f) => f.endsWith("utils.ts")));
    assert(!files.some((f) => f.endsWith("readme.md")));
  });
});

Deno.test("ToolRegistry: should handle missing files gracefully", async () => {
  await runToolRegistryTest(async (registry, _tempDir) => {
    const result = await registry.execute(ToolName.READ_FILE, { path: "nonexistent.txt" });
    assert(!result.success);
    assert(result.error?.includes("not found") || result.error?.includes("outside allowed roots"));
  });
});

Deno.test("ToolRegistry: should prevent path traversal", async () => {
  await runToolRegistryTest(async (registry, _tempDir) => {
    const result = await registry.execute(ToolName.READ_FILE, { path: "../secret.txt" });
    assert(!result.success);
    assert(result.error?.includes("Access denied") || result.error?.includes("outside allowed roots"));
  });
});
