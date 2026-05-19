/**
 * @module ConfigParserTest
 * @path tests/services/portal_knowledge/config_parser_test.ts
 * @description Tests for the ConfigParser (Strategy 2): parsing known config
 * files to extract dependencies, tech stack, and .gitignore patterns.
 * Uses real temporary directories to exercise actual filesystem behaviour.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parseConfigFiles } from "@exaix/portal/knowledge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "exa_config_parser_test_" });
}

async function writeFile(dir: string, relPath: string, content: string): Promise<void> {
  const full = join(dir, relPath);
  const lastSlash = full.lastIndexOf("/");
  if (lastSlash !== -1) {
    await Deno.mkdir(full.substring(0, lastSlash), { recursive: true });
  }
  await Deno.writeTextFile(full, content);
}

async function withConfigTest(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await makeTempDir();
  try {
    for (const [path, content] of Object.entries(files)) {
      await writeFile(root, path, content);
    }
    await fn(root);
  } finally {
    try {
      await Deno.remove(root, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// [ConfigParser] parses package.json dependencies
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] parses package.json dependencies", async () => {
  await withConfigTest(
    {
      "package.json": JSON.stringify({
        name: "my-app",
        dependencies: { "express": "^4.18.0", "zod": "^3.0.0" },
        devDependencies: { "typescript": "^5.0.0" },
        scripts: { "test": "jest", "build": "tsc" },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["package.json"]);

      assertExists(result.dependencies);
      assertEquals(result.dependencies!.length, 1);
      assertEquals(result.dependencies![0].packageManager, "npm");
      assertEquals(result.dependencies![0].configFile, "package.json");
      assertExists(result.dependencies![0].keyDependencies);
      const names = result.dependencies![0].keyDependencies.map((d) => d.name);
      assertEquals(names.includes("express"), true);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] parses deno.json imports and tasks
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] parses deno.json imports and tasks", async () => {
  await withConfigTest(
    {
      "deno.json": JSON.stringify({
        imports: {
          "@std/assert": "jsr:@std/assert@^1.0.0",
          "zod": "npm:zod@^3.0.0",
        },
        tasks: { "test": "deno test --allow-all", "build": "deno compile" },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["deno.json"]);

      assertExists(result.dependencies);
      assertEquals(result.dependencies!.length, 1);
      assertEquals(result.dependencies![0].packageManager, "deno");
      assertEquals(result.dependencies![0].configFile, "deno.json");
      const names = result.dependencies![0].keyDependencies.map((d) => d.name);
      assertEquals(names.includes("zod"), true);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] parses tsconfig.json compiler options
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] parses tsconfig.json compiler options", async () => {
  await withConfigTest(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          paths: { "@/*": ["./src/*"] },
        },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["tsconfig.json"]);

      // tsconfig adds a dependency entry with configFile = tsconfig.json
      assertExists(result.dependencies);
      const tsEntry = result.dependencies!.find((d) => d.configFile === "tsconfig.json");
      assertExists(tsEntry);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] detects test framework from dependencies
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] detects test framework from dependencies", async () => {
  await withConfigTest(
    {
      "package.json": JSON.stringify({
        devDependencies: { "jest": "^29.0.0", "@types/jest": "^29.0.0" },
        scripts: { "test": "jest" },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["package.json"]);
      assertExists(result.techStack);
      assertEquals(result.techStack!.testFramework, "jest");
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] detects web framework from dependencies
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] detects web framework from dependencies", async () => {
  await withConfigTest(
    {
      "package.json": JSON.stringify({
        dependencies: { "express": "^4.18.0" },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["package.json"]);
      assertExists(result.techStack);
      assertEquals(result.techStack!.framework, "express");
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] detects build tool from scripts
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] detects build tool from scripts", async () => {
  await withConfigTest(
    {
      "package.json": JSON.stringify({
        devDependencies: { "vite": "^5.0.0" },
        scripts: { "build": "vite build", "dev": "vite" },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["package.json"]);
      assertExists(result.techStack);
      assertEquals(result.techStack!.buildTool, "vite");
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] reads .gitignore and adds patterns to ignorePatterns
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] reads .gitignore and adds patterns to ignorePatterns", async () => {
  await withConfigTest(
    { ".gitignore": "dist\n*.log\n# comment\n\n  node_modules  " },
    async (root) => {
      const result = await parseConfigFiles(root, [".gitignore"]);
      assertExists(result.ignorePatterns);
      assertEquals(result.ignorePatterns!.includes("dist"), true);
      assertEquals(result.ignorePatterns!.includes("*.log"), true);
      assertEquals(result.ignorePatterns!.includes("node_modules"), true);
      // Comments and empty lines should be excluded
      assertEquals(result.ignorePatterns!.some((p) => p.startsWith("#")), false);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] handles malformed JSON gracefully
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] handles malformed JSON gracefully", async () => {
  await withConfigTest(
    { "package.json": "{ not valid json }}}" },
    async (root) => {
      // Should not throw
      const result = await parseConfigFiles(root, ["package.json"]);

      // Returns partial/empty result without crashing
      assertExists(result);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] returns empty for directory with no config files
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] returns empty for directory with no config files", async () => {
  await withConfigTest(
    {},
    async (root) => {
      const result = await parseConfigFiles(root, []);

      // dependencies may be empty array or undefined — both fine
      assertEquals(!result.dependencies || result.dependencies.length === 0, true);
      // techStack may be undefined or partial
      assertExists(result);
    },
  );
});

// ---------------------------------------------------------------------------
// [ConfigParser] extracts key dependencies with purpose heuristic
// ---------------------------------------------------------------------------

Deno.test("[ConfigParser] extracts key dependencies with purpose heuristic", async () => {
  await withConfigTest(
    {
      "package.json": JSON.stringify({
        dependencies: {
          "express": "^4.18.0",
          "zod": "^3.0.0",
        },
        devDependencies: {
          "jest": "^29.0.0",
        },
      }),
    },
    async (root) => {
      const result = await parseConfigFiles(root, ["package.json"]);

      assertExists(result.dependencies);
      const deps = result.dependencies![0].keyDependencies;
      const express = deps.find((d) => d.name === "express");
      assertExists(express);
      assertExists(express!.purpose);
      assertEquals(typeof express!.purpose, "string");
      assertEquals(express!.purpose!.length > 0, true);
    },
  );
});
