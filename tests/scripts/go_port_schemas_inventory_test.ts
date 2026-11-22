/**
 * @module GoPortSchemasInventoryTest
 * @path tests/scripts/go_port_schemas_inventory_test.ts
 * @description Exercises the frozen export list of packages/schemas that the Go inventory covers.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { listSchemaExports, writeSchemaExports } from "../../scripts/go_port/schemas_exports.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const EXPORTS_FILE = join(ROOT, "exaix-go", "port", "inventory", "schemas_exports.json");
const REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

const SCHEMA_HELPER = `const schema = () => ({
  parse: (value: unknown) => value,
  safeParse: (value: unknown) => ({ success: true, data: value }),
});
`;

async function writeFile(path: string, body: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, body);
}

async function fakeSnapshot(dir: string): Promise<string> {
  const root = join(dir, "snapshot");
  const src = join(root, "packages", "schemas", "src");
  await writeFile(join(root, "deno.json"), "{}\n");
  await writeFile(join(root, "deno.lock"), '{"version":"5"}\n');
  await writeFile(
    join(src, "a.ts"),
    `${SCHEMA_HELPER}export const BetaSchema = schema();
export const AlphaSchema = schema();
export const helper = 1;
export function makeSchema() {
  return schema();
}
`,
  );
  await writeFile(join(src, "execution", "b.ts"), `${SCHEMA_HELPER}export const GammaSchema = schema();\n`);
  await writeFile(join(src, "mod.ts"), 'export { AlphaSchema } from "./a.ts";\n');
  return root;
}

Deno.test("go-port-schemas-exports: lists every exported schema once, in order, and skips barrels", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    assertEquals(await listSchemaExports(root), [
      { module: "packages/schemas/src/a.ts", symbol: "AlphaSchema" },
      { module: "packages/schemas/src/a.ts", symbol: "BetaSchema" },
      { module: "packages/schemas/src/execution/b.ts", symbol: "GammaSchema" },
    ]);
  });
});

Deno.test("go-port-schemas-exports: a module that fails to load aborts the listing", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    await writeFile(join(root, "packages", "schemas", "src", "broken.ts"), "throw new Error('boom');\n");
    await assertRejects(() => listSchemaExports(root), Error, "broken.ts");
  });
});

Deno.test("go-port-schemas-exports: the written file is stable and carries the sorted list", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    const target = join(dir, "out", "schemas_exports.json");
    await writeSchemaExports(root, target);
    const first = await Deno.readTextFile(target);
    await writeSchemaExports(root, target);
    assertEquals(await Deno.readTextFile(target), first);
    assertEquals(JSON.parse(first).exports.length, 3);
  });
});

async function referenceUnchanged(): Promise<boolean> {
  const result = await new Deno.Command("git", {
    cwd: ROOT,
    args: ["diff", "--quiet", REFERENCE, "HEAD", "--", "packages/schemas"],
    env: { LD_LIBRARY_PATH: "" },
  }).output();
  return result.success;
}

Deno.test({
  name: "go-port-schemas-inventory: the inventory lists exactly the exported schemas of the reference",
  ignore: !(await referenceUnchanged()),
  fn: async () => {
    const live = await listSchemaExports(ROOT);
    const committed = JSON.parse(await Deno.readTextFile(EXPORTS_FILE)).exports;
    assertEquals(committed, live);
    const identities = new Set(live.map((item) => `${item.module}#${item.symbol}`));
    assert(identities.size === live.length, "the export list repeats a symbol");
  },
});
