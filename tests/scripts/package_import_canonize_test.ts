/**
 * @module PackageImportCanonizeTest
 * @path tests/scripts/package_import_canonize_test.ts
 * @description Verifies canonical package import rewriting and dry-run behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

interface CanonizeWorkspace {
  tempRoot: string;
  importerPath: string;
  packageDir: string;
}

function scriptPath(): string {
  return new URL("../../scripts/package_import_canonize.ts", import.meta.url).pathname;
}

async function createCanonizeWorkspace(options: { rootBarrel?: boolean } = {}): Promise<CanonizeWorkspace> {
  const tempRoot = await Deno.makeTempDir();
  const packageDir = join(tempRoot, options.rootBarrel ? "packages/testing/src" : "packages/testing/src/helpers");
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
  await Deno.writeTextFile(
    join(tempRoot, "packages/testing/mod.ts"),
    options.rootBarrel ? 'export * from "./src/db.ts";\n' : "export {}\n",
  );
  await Deno.writeTextFile(join(packageDir, "db.ts"), "export function createLoggingTestDb() {}\n");

  return {
    tempRoot,
    importerPath: join(importerDir, "markdown.ts"),
    packageDir,
  };
}

async function runCanonize(
  tempRoot: string,
  ...extraArgs: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      scriptPath(),
      ...extraArgs,
    ],
    cwd: tempRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("package_import_canonize dry-run reports canonical subfolder barrel without creating it", async () => {
  const { tempRoot, importerPath, packageDir } = await createCanonizeWorkspace();
  const original = 'import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";\n';
  await Deno.writeTextFile(importerPath, original);

  const { code, stdout, stderr } = await runCanonize(tempRoot);

  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, 'from "@exaix/testing/helpers";');
  assertEquals(await Deno.readTextFile(importerPath), original);
  assert(!(await fileExists(join(packageDir, "mod.ts"))));
});

Deno.test("package_import_canonize --edit rewrites imports and creates missing subfolder barrel", async () => {
  const { tempRoot, importerPath, packageDir } = await createCanonizeWorkspace();
  await Deno.writeTextFile(
    importerPath,
    'import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";\n',
  );

  const { code, stderr } = await runCanonize(tempRoot, "--edit");

  assertEquals(code, 0, stderr);
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
  const { tempRoot, importerPath } = await createCanonizeWorkspace({ rootBarrel: true });
  await Deno.writeTextFile(
    importerPath,
    'import { createLoggingTestDb } from "@exaix/testing/db.ts";\n',
  );

  const { code, stderr } = await runCanonize(tempRoot, "--edit");

  assertEquals(code, 0, stderr);
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
