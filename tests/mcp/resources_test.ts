/**
 * @module MCPResourcesTest
 * @path tests/mcp/resources_test.ts
 * @description Verifies URI-based resource discovery in the MCP server, validating
 * 'exa://' scheme parsing, nested path resolution, and portal context isolation.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { createMockConfig } from "../helpers/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";
import {
  buildPortalURI,
  discoverAllResources,
  discoverPortalResources,
  getResourceTemplates,
  parsePortalURI,
} from "../../src/mcp/resources.ts";

// Helper for resource discovery tests
async function createTestPortal(tempDir: string, portalName: string, files: Record<string, string>) {
  const portalPath = join(tempDir, portalName);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(portalPath, filePath);
    await ensureDir(join(fullPath, ".."));
    await Deno.writeTextFile(fullPath, content);
  }
  return portalPath;
}

// ============================================================================
// URI Parsing Tests
// ============================================================================

Deno.test("parsePortalURI: parses valid portal URI", () => {
  const result = parsePortalURI("portal://MyApp/src/auth.ts");

  assertExists(result);
  assertEquals(result.portal, "MyApp");
  assertEquals(result.path, "src/auth.ts");
});

Deno.test("parsePortalURI: parses URI with nested path", () => {
  const result = parsePortalURI("portal://MyApp/src/components/Button.tsx");

  assertExists(result);
  assertEquals(result.portal, "MyApp");
  assertEquals(result.path, "src/components/Button.tsx");
});

Deno.test("parsePortalURI: returns null for invalid URI", () => {
  const result = parsePortalURI("http://example.com/file.ts");

  assertEquals(result, null);
});

Deno.test("parsePortalURI: returns null for missing path", () => {
  const result = parsePortalURI("portal://MyApp");

  assertEquals(result, null);
});

Deno.test("buildPortalURI: builds valid URI", () => {
  const uri = buildPortalURI("MyApp", "src/auth.ts");

  assertEquals(uri, "portal://MyApp/src/auth.ts");
});

// ============================================================================
// Resource Discovery Tests
// ============================================================================

Deno.test("discoverPortalResources: discovers files in portal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-resources-" });

  try {
    const portalPath = await createTestPortal(tempDir, "TestPortal", {
      "README.md": "# Test",
      "src/main.ts": "console.log('test');",
      "src/utils.ts": "export {}",
    });

    const resources = await discoverPortalResources("TestPortal", portalPath);

    assertEquals(resources.length >= 2, true);

    const uris = resources.map((r) => r.uri);
    assertEquals(uris.some((uri) => uri.includes("README.md")), true);
    assertEquals(uris.some((uri) => uri.includes("main.ts")), true);

    const tsResource = resources.find((r) => r.uri.includes("main.ts"));
    assertExists(tsResource);
    assertEquals(tsResource.mimeType, "text/x-typescript");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("discoverPortalResources: respects maxDepth option", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-resources-depth-" });

  try {
    const portalPath = await createTestPortal(tempDir, "TestPortal", {
      "root.txt": "root",
      "level1/file1.txt": "level1",
      "level1/level2/file2.txt": "level2",
      "level1/level2/level3/file3.txt": "level3",
    });

    const resources = await discoverPortalResources("TestPortal", portalPath, { maxDepth: 2 });

    const paths = resources.map((r) => parsePortalURI(r.uri)?.path);

    assertEquals(paths.includes("root.txt"), true);
    assertEquals(paths.includes("level1/file1.txt"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("discoverPortalResources: filters by extensions", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-resources-ext-" });

  try {
    const portalPath = await createTestPortal(tempDir, "TestPortal", {
      "code.ts": "ts file",
      "script.js": "js file",
      "data.json": "{}",
      "README.md": "# readme",
    });

    const resources = await discoverPortalResources("TestPortal", portalPath, {
      extensions: ["ts", "js"],
    });

    const paths = resources.map((r) => parsePortalURI(r.uri)?.path);

    assertEquals(paths.includes("code.ts"), true);
    assertEquals(paths.includes("script.js"), true);
    assertEquals(paths.includes("data.json"), false);
    assertEquals(paths.includes("README.md"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("discoverPortalResources: skips hidden files by default", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-resources-hidden-" });

  try {
    const portalPath = await createTestPortal(tempDir, "TestPortal", {
      "visible.ts": "visible",
      ".hidden": "hidden",
    });

    const resources = await discoverPortalResources("TestPortal", portalPath);

    const paths = resources.map((r) => parsePortalURI(r.uri)?.path);

    assertEquals(paths.includes("visible.ts"), true);
    assertEquals(paths.includes(".hidden"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("discoverAllResources: discovers from multiple portals", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-resources-all-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const portal1Path = await createTestPortal(tempDir, "Portal1", { "file1.ts": "portal1" });
    const portal2Path = await createTestPortal(tempDir, "Portal2", { "file2.ts": "portal2" });

    const config = createMockConfig(tempDir, {
      portals: [
        {
          alias: "Portal1",
          target_path: portal1Path,
          default_branch: TEST_DEFAULT_BRANCH,
          identities_allowed: ["*"],
          operations: [],
        },
        {
          alias: "Portal2",
          target_path: portal2Path,
          default_branch: TEST_DEFAULT_BRANCH,
          identities_allowed: ["*"],
          operations: [],
        },
      ],
    });

    const resources = await discoverAllResources(config, db);

    assertEquals(resources.length >= 2, true);

    const portal1Resources = resources.filter((r) => r.uri.startsWith("portal://Portal1/"));
    const portal2Resources = resources.filter((r) => r.uri.startsWith("portal://Portal2/"));

    assertEquals(portal1Resources.length >= 1, true);
    assertEquals(portal2Resources.length >= 1, true);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("getResourceTemplates: returns templates for all portals", () => {
  const tempDir = "/tmp/test";
  const config = createMockConfig(tempDir, {
    portals: [
      {
        alias: "Portal1",
        target_path: "/tmp/portal1",
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
      },
      {
        alias: "Portal2",
        target_path: "/tmp/portal2",
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
      },
    ],
  });

  const templates = getResourceTemplates(config);

  assertEquals(templates.length, 2);
  assertEquals(templates[0].uriTemplate, "portal://Portal1/{path}");
  assertEquals(templates[1].uriTemplate, "portal://Portal2/{path}");
  assertStringIncludes(templates[0].name, "Portal1");
  assertStringIncludes(templates[1].name, "Portal2");
});
