/**
 * @module KeyFileIdentifierTest
 * @path packages/portal/knowledge/tests/key_file_identifier_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for the KeyFileIdentifier (Strategy 3): heuristic-based
 * identification of significant files by name/path patterns, with role
 * assignment and significance sorting.
 */

import { assertEquals, assertExists } from "@std/assert";
import { identifyKeyFiles } from "@exaix/portal/knowledge";

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] identifies entrypoint files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] identifies entrypoint files", () => {
  const files = ["main.ts", "src/utils.ts", "README.md", "mod.ts", "index.js"];
  const result = identifyKeyFiles(files, 50);

  const roles = result.map((f) => f.role);
  assertEquals(roles.includes("entrypoint"), true);

  const entrypoints = result.filter((f) => f.role === "entrypoint");
  const paths = entrypoints.map((f) => f.path);
  assertEquals(paths.includes("main.ts"), true);
  assertEquals(paths.includes("mod.ts"), true);
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] identifies config files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] identifies config files", () => {
  const files = [
    "package.json",
    "tsconfig.json",
    "deno.json",
    "src/main.ts",
    ".eslintrc.json",
  ];
  const result = identifyKeyFiles(files, 50);

  const configs = result.filter((f) => f.role === "config");
  const paths = configs.map((f) => f.path);
  assertEquals(paths.includes("package.json"), true);
  assertEquals(paths.includes("tsconfig.json"), true);
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] identifies schema/types files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] identifies schema/types files", () => {
  const files = [
    "src/schema.ts",
    "src/types.ts",
    "src/interfaces/user.ts",
    "src/main.ts",
    "@exaix/schemas/portal.ts",
  ];
  const result = identifyKeyFiles(files, 50);

  const schemaTypes = result.filter((f) => f.role === "schema" || f.role === "types");
  assertEquals(schemaTypes.length > 0, true);

  const paths = schemaTypes.map((f) => f.path);
  assertEquals(paths.some((p) => p.includes("schema") || p.includes("types")), true);
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] identifies test helper files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] identifies test helper files", () => {
  const files = [
    "tests/test_helpers.ts",
    "tests/fixtures.ts",
    "src/main.ts",
    "tests/conftest.py",
  ];
  const result = identifyKeyFiles(files, 50);

  const helpers = result.filter((f) => f.role === "test-helper");
  assertEquals(helpers.length > 0, true);
  const paths = helpers.map((f) => f.path);
  assertEquals(
    paths.some((p) => p.includes("test_helper") || p.includes("fixture") || p.includes("conftest")),
    true,
  );
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] identifies routing files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] identifies routing files", () => {
  const files = [
    "src/routes.ts",
    "src/router.ts",
    "src/api/routes/users.ts",
    "src/main.ts",
  ];
  const result = identifyKeyFiles(files, 50);

  const routing = result.filter((f) => f.role === "routing");
  assertEquals(routing.length > 0, true);
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] assigns correct roles
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] assigns correct roles", () => {
  const files = [
    "main.ts",
    "package.json",
    "src/models/user.ts",
    "Dockerfile",
    "Makefile",
  ];
  const result = identifyKeyFiles(files, 50);

  const entrypoint = result.find((f) => f.path === "main.ts");
  const config = result.find((f) => f.path === "package.json");
  const build = result.find((f) => f.path === "Dockerfile" || f.path === "Makefile");

  assertExists(entrypoint);
  assertEquals(entrypoint!.role, "entrypoint");
  assertExists(config);
  assertEquals(config!.role, "config");
  assertExists(build);
  assertEquals(build!.role, "build");
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] sorts by significance (entrypoints first)
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] sorts by significance", () => {
  const files = [
    "src/utils/helper.ts",
    "package.json",
    "main.ts",
    "src/routes.ts",
  ];
  const result = identifyKeyFiles(files, 50);

  // entrypoints and configs must appear before less significant items
  const firstRoles = result.slice(0, 2).map((f) => f.role);
  assertEquals(
    firstRoles.every((r) => r === "entrypoint" || r === "config"),
    true,
  );
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] handles no significant files
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] handles no significant files", () => {
  const files = [
    "src/helper_a.ts",
    "src/helper_b.ts",
    "src/helper_c.ts",
  ];
  const result = identifyKeyFiles(files, 50);

  // Returns array (possibly empty) — no crash
  assertExists(result);
  assertEquals(Array.isArray(result), true);
});

// ---------------------------------------------------------------------------
// [KeyFileIdentifier] respects output cap limit
// ---------------------------------------------------------------------------

Deno.test("[KeyFileIdentifier] respects output cap limit", () => {
  const files = Array.from({ length: 100 }, (_, i) => `pkg${i}.json`);
  files.push("main.ts");

  const limit = 10;
  const result = identifyKeyFiles(files, limit);

  assertEquals(result.length <= limit, true);
});
