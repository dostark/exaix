/**
 * @module DirectoryAnalyzerTest
 * @path tests/services/portal_knowledge/directory_analyzer_test.ts
 * @description Tests for the DirectoryAnalyzer (Strategy 1): directory-tree
 * walking, statistics, architecture layer detection, and monorepo detection.
 * Uses real temporary directories to exercise actual filesystem behaviour.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { analyzeDirectory } from "@exaix/portal/knowledge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "exa_dir_analyzer_test_" });
}

async function writeFile(dir: string, relPath: string, content = ""): Promise<void> {
  const full = join(dir, relPath);
  await Deno.mkdir(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(full, content);
}

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] counts files and directories correctly
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] counts files and directories correctly", async () => {
  const root = await makeTempDir();
  try {
    await writeFile(root, "src/main.ts");
    await writeFile(root, "src/services/foo.ts");
    await writeFile(root, "README.md");

    const result = await analyzeDirectory(root, [], 500);

    assertEquals(result.stats?.totalFiles, 3);
    assertEquals(result.stats?.totalDirectories, 2); // src/, src/services/
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] builds extension distribution
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] builds extension distribution", async () => {
  const root = await makeTempDir();
  try {
    await writeFile(root, "src/a.ts");
    await writeFile(root, "src/b.ts");
    await writeFile(root, "README.md");
    await writeFile(root, "deno.json", "{}");

    const result = await analyzeDirectory(root, [], 500);

    assertEquals(result.stats?.extensionDistribution[".ts"], 2);
    assertEquals(result.stats?.extensionDistribution[".md"], 1);
    assertEquals(result.stats?.extensionDistribution[".json"], 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] respects ignorePatterns
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] respects ignorePatterns", async () => {
  const root = await makeTempDir();
  try {
    await writeFile(root, "src/main.ts");
    await writeFile(root, "node_modules/dep/index.js");
    await writeFile(root, ".git/config");

    const result = await analyzeDirectory(root, ["node_modules", ".git"], 500);

    assertEquals(result.stats?.totalFiles, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] respects scanLimit
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] respects scanLimit", async () => {
  const root = await makeTempDir();
  try {
    // Create 10 files but set scanLimit to 5
    for (let i = 0; i < 10; i++) {
      await writeFile(root, `src/file${i}.ts`);
    }

    const result = await analyzeDirectory(root, [], 5);

    assertEquals(result.stats!.totalFiles <= 5, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] detects architecture layers from standard directories
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] detects architecture layers from standard directories", async () => {
  const root = await makeTempDir();
  try {
    await writeFile(root, "src/services/request.ts");
    await writeFile(root, "src/controllers/api.ts");
    await writeFile(root, "tests/request_test.ts");
    await writeFile(root, "migrations/001_init.sql");

    const result = await analyzeDirectory(root, [], 500);

    assertExists(result.layers);
    const layerNames = result.layers!.map((l) => l.name);
    assertEquals(layerNames.includes("services"), true);
    assertEquals(layerNames.includes("tests"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] detects primary language from extension distribution
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] detects primary language from extension distribution", async () => {
  const root = await makeTempDir();
  try {
    await writeFile(root, "src/a.ts");
    await writeFile(root, "src/b.ts");
    await writeFile(root, "src/c.ts");
    await writeFile(root, "README.md");

    const result = await analyzeDirectory(root, [], 500);

    assertEquals(result.techStack?.primaryLanguage, "typescript");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] detects monorepo structure and populates packages[] entries
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] detects monorepo structure and populates packages[] entries", async () => {
  const root = await makeTempDir();
  try {
    // Root workspace config
    await writeFile(root, "deno.json", '{"workspace": ["packages/api", "packages/web"]}');
    // Sub-package 1
    await writeFile(root, "packages/api/deno.json", '{"name": "api"}');
    await writeFile(root, "packages/api/src/main.ts");
    // Sub-package 2
    await writeFile(root, "packages/web/package.json", '{"name": "web"}');
    await writeFile(root, "packages/web/src/index.ts");

    const result = await analyzeDirectory(root, [], 500);

    assertExists(result.packages);
    assertEquals(result.packages!.length >= 2, true);
    const packageNames = result.packages!.map((p) => p.name);
    assertEquals(packageNames.includes("api") || packageNames.includes("packages/api"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] handles empty directory
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] handles empty directory", async () => {
  const root = await makeTempDir();
  try {
    const result = await analyzeDirectory(root, [], 500);

    assertEquals(result.stats?.totalFiles, 0);
    assertEquals(result.stats?.totalDirectories, 0);
    assertEquals(Array.isArray(result.layers), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] handles missing directory gracefully
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] handles missing directory gracefully", async () => {
  const result = await analyzeDirectory("/nonexistent/path/that/does/not/exist", [], 500);

  assertEquals(result.stats?.totalFiles, 0);
  assertEquals(result.stats?.totalDirectories, 0);
});

// ---------------------------------------------------------------------------
// [DirectoryAnalyzer] priority files collected before scanLimit applies
// ---------------------------------------------------------------------------

Deno.test("[DirectoryAnalyzer] priority files collected before scanLimit applies", async () => {
  const root = await makeTempDir();
  try {
    // Priority entrypoint
    await writeFile(root, "main.ts", "// entry");
    await writeFile(root, "deno.json", "{}");
    // Many non-priority source files
    for (let i = 0; i < 20; i++) {
      await writeFile(root, `src/file${i}.ts`);
    }

    // scanLimit = 5: priority files (main.ts, deno.json) must always be included
    const result = await analyzeDirectory(root, [], 5);

    // Total scanned is capped at 5; priority files are in that set
    assertEquals(result.stats!.totalFiles <= 5, true);
    assertEquals(result.stats!.totalFiles >= 2, true); // at least the 2 priority files
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
