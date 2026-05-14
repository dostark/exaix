/**
 * @module PackageImportCanonizeTest
 * @path tests/scripts/package_import_canonize_test.ts
 * @description Verifies canonical package import rewriting and dry-run behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

function scriptPath(): string {
  return new URL("../../scripts/package_import_canonize.ts", import.meta.url).pathname;
}

Deno.test("package_import_canonize dry-run reports canonical subfolder barrel without creating it", async () => {
  const tempRoot = await Deno.makeTempDir();
  const packageDir = join(tempRoot, "packages/testing/src/helpers");
  const importerDir = join(tempRoot, "packages/parsing/src");

  await Deno.mkdir(packageDir, { recursive: true });
  await Deno.mkdir(importerDir, { recursive: true });
  await Deno.writeTextFile(
    join(tempRoot, "deno.json"),
    JSON.stringify({
      imports: {
        "@exaix/testing": "./packages/testing/mod.ts",
        "@exaix/testing/": "./packages/testing/src/",
      },
    }),
  );
  await Deno.writeTextFile(join(tempRoot, "packages/testing/mod.ts"), "export {}\n");
  await Deno.writeTextFile(join(packageDir, "db.ts"), "export function createLoggingTestDb() {}\n");

  const importerPath = join(importerDir, "markdown.ts");
  const original = 'import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";\n';
  await Deno.writeTextFile(importerPath, original);

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      scriptPath(),
    ],
    cwd: tempRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();

  assertEquals(code, 0, new TextDecoder().decode(stderr));
  const output = new TextDecoder().decode(stdout);
  assertStringIncludes(output, 'from "@exaix/testing/helpers";');
  assertEquals(await Deno.readTextFile(importerPath), original);
  assert(!(await fileExists(join(packageDir, "mod.ts"))));
});

Deno.test("package_import_canonize --edit rewrites imports and creates missing subfolder barrel", async () => {
  const tempRoot = await Deno.makeTempDir();
  const packageDir = join(tempRoot, "packages/testing/src/helpers");
  const importerDir = join(tempRoot, "packages/parsing/src");

  await Deno.mkdir(packageDir, { recursive: true });
  await Deno.mkdir(importerDir, { recursive: true });
  await Deno.writeTextFile(
    join(tempRoot, "deno.json"),
    JSON.stringify({
      imports: {
        "@exaix/testing": "./packages/testing/mod.ts",
        "@exaix/testing/": "./packages/testing/src/",
      },
    }),
  );
  await Deno.writeTextFile(join(tempRoot, "packages/testing/mod.ts"), "export {}\n");
  await Deno.writeTextFile(join(packageDir, "db.ts"), "export function createLoggingTestDb() {}\n");

  const importerPath = join(importerDir, "markdown.ts");
  await Deno.writeTextFile(
    importerPath,
    'import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";\n',
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      scriptPath(),
      "--edit",
    ],
    cwd: tempRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();

  assertEquals(code, 0, new TextDecoder().decode(stderr));
  assertStringIncludes(
    await Deno.readTextFile(importerPath),
    'import { createLoggingTestDb } from "@exaix/testing/helpers";',
  );
  assertStringIncludes(
    await Deno.readTextFile(join(packageDir, "mod.ts")),
    'export * from "./db.ts";',
  );
});

Deno.test("package_import_canonize prefers exact package alias for root barrel imports", async () => {
  const tempRoot = await Deno.makeTempDir();
  const packageSrcDir = join(tempRoot, "packages/testing/src");
  const importerDir = join(tempRoot, "packages/parsing/src");

  await Deno.mkdir(packageSrcDir, { recursive: true });
  await Deno.mkdir(importerDir, { recursive: true });
  await Deno.writeTextFile(
    join(tempRoot, "deno.json"),
    JSON.stringify({
      imports: {
        "@exaix/testing": "./packages/testing/mod.ts",
        "@exaix/testing/": "./packages/testing/src/",
      },
    }),
  );
  await Deno.writeTextFile(join(packageSrcDir, "db.ts"), "export function createLoggingTestDb() {}\n");
  await Deno.writeTextFile(join(tempRoot, "packages/testing/mod.ts"), 'export * from "./src/db.ts";\n');

  const importerPath = join(importerDir, "markdown.ts");
  await Deno.writeTextFile(
    importerPath,
    'import { createLoggingTestDb } from "@exaix/testing/db.ts";\n',
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      scriptPath(),
      "--edit",
    ],
    cwd: tempRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();

  assertEquals(code, 0, new TextDecoder().decode(stderr));
  assertStringIncludes(
    await Deno.readTextFile(importerPath),
    'import { createLoggingTestDb } from "@exaix/testing";',
  );
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}
