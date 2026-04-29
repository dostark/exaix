/**
 * @module PackageImportMigrationTest
 * @path tests/scripts/package_import_migration_test.ts
 * @description Unit tests for the package import migration helpers.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join, relative } from "@std/path";
import {
  getBestImportSourceForSymbol,
  getNewImportSource,
  mergeDuplicateImportStatements,
} from "../../scripts/package_import_migration.ts";

Deno.test("package_import_migration maps src subtree imports into packages subtree", async () => {
  const tempRoot = await Deno.makeTempDir();
  const oldRoot = join(tempRoot, "src/shared/interfaces");
  const newRoot = join(tempRoot, "packages/core/src/types");
  await Deno.mkdir(oldRoot, { recursive: true });
  await Deno.mkdir(newRoot, { recursive: true });

  const oldFile = join(oldRoot, "i_database_service.ts");
  const newFile = join(newRoot, "i_database_service.ts");
  await Deno.writeTextFile(oldFile, "export interface IDatabaseService {}\n");
  await Deno.writeTextFile(newFile, "export interface IDatabaseService {}\n");

  const actual = await getNewImportSource(
    "./i_database_service.ts",
    oldRoot,
    {},
    oldRoot,
    newRoot,
  );

  const expected = normalizeImportPath(relative(oldRoot, newFile));
  const expectedImport = expected.startsWith(".") ? expected : `./${expected}`;
  assertEquals(actual, expectedImport);
});

Deno.test("package_import_migration prefers barrel package import when symbol is exported through the barrel", async () => {
  const tempRoot = await Deno.makeTempDir();
  const moduleDir = join(tempRoot, "src/services/request");
  const oldRoot = join(tempRoot, "src/shared/interfaces");
  const newRoot = join(tempRoot, "packages/core/src/types");
  await Deno.mkdir(moduleDir, { recursive: true });
  await Deno.mkdir(oldRoot, { recursive: true });
  await Deno.mkdir(newRoot, { recursive: true });

  await Deno.writeTextFile(join(oldRoot, "i_database_service.ts"), "export interface IDatabaseService {}\n");
  await Deno.writeTextFile(join(newRoot, "i_database_service.ts"), "export interface IDatabaseService {}\n");
  await Deno.writeTextFile(join(newRoot, "mod.ts"), "export * from './i_database_service.ts';\n");

  const imports = {
    "@exaix/core/": join(tempRoot, "packages/core/src"),
  };

  const actual = await getBestImportSourceForSymbol({
    importSource: "../../shared/interfaces/i_database_service.ts",
    moduleDir,
    imports,
    oldPackage: oldRoot,
    newPackage: newRoot,
    symbol: "IDatabaseService",
    cache: new Map(),
  });

  assertEquals(actual, "@exaix/core/types");
});

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, "/");
}

Deno.test("mergeDuplicateImportStatements collapses duplicate package imports", () => {
  const input = `import type { A } from "@exaix/core/types";
import type { B } from "@exaix/core/types";
import type { C } from "@exaix/core/other";
import type { D } from "@exaix/core/types";
`;
  const expected = `import type { A, B, D } from "@exaix/core/types";
import type { C } from "@exaix/core/other";
`;
  assertEquals(mergeDuplicateImportStatements(input), expected);
});

Deno.test("package_import_migration --edit preserves adjacent imports", async () => {
  const tempRoot = await Deno.makeTempDir();
  const sourceDir = join(tempRoot, "src/shared/interfaces");
  const targetDir = join(tempRoot, "packages/core/src/types");
  const testDir = join(tempRoot, "tests");
  await Deno.mkdir(sourceDir, { recursive: true });
  await Deno.mkdir(targetDir, { recursive: true });
  await Deno.mkdir(testDir, { recursive: true });

  await Deno.writeTextFile(
    join(sourceDir, "i_portal_knowledge_service.ts"),
    `export type IPortalKnowledgeConfig = {};
export type IPortalKnowledgeService = {};
`,
  );
  await Deno.writeTextFile(
    join(targetDir, "mod.ts"),
    `export * from './i_portal_knowledge_service.ts';\n`,
  );
  await Deno.writeTextFile(
    join(targetDir, "i_portal_knowledge_service.ts"),
    `export type IPortalKnowledgeConfig = {};
export type IPortalKnowledgeService = {};
`,
  );
  await Deno.writeTextFile(
    join(tempRoot, "import_map.json"),
    JSON.stringify({
      imports: {
        "@std/fs": "jsr:@std/fs@^0.221.0",
        "@std/path": "jsr:@std/path@^0.221.0",
      },
    }),
  );

  const filePath = join(testDir, "file.ts");
  await Deno.writeTextFile(
    filePath,
    `import type { IPortalKnowledgeConfig } from "../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledgeService } from "../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { Other } from "../src/other.ts";
`,
  );

  const scriptPath = new URL("../../scripts/package_import_migration.ts", import.meta.url).pathname;
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--import-map",
      "./import_map.json",
      "--allow-read",
      "--allow-write",
      scriptPath,
      "--edit",
      "./src/shared/interfaces",
      "./packages/core/src/types",
    ],
    cwd: tempRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();

  assertEquals(code, 0, new TextDecoder().decode(stderr));

  const updated = await Deno.readTextFile(filePath);
  assertStringIncludes(
    updated,
    'import type { IPortalKnowledgeConfig, IPortalKnowledgeService } from "../packages/core/src/types/i_portal_knowledge_service.ts";',
  );
  assertStringIncludes(updated, 'import type { Other } from "../src/other.ts";');
  assertEquals(
    updated.split(/\r?\n/).filter(Boolean).length,
    2,
  );
});
