/**
 * @module GoPortCoreL0InventoryTest
 * @path tests/scripts/go_port_core_l0_inventory_test.ts
 * @description Exercises the frozen export list of packages/core Layer 0 directories that the Go inventory covers.
 * @architectural-layer Test
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { listCoreL0Exports, writeCoreL0Exports } from "../../scripts/go_port/core_l0_exports.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const EXPORTS_FILE = join(ROOT, "exaix-go", "port", "inventory", "core-l0_exports.json");
const REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

async function writeFile(path: string, body: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, body);
}

async function fakeCoreSnapshot(dir: string): Promise<string> {
  const root = join(dir, "snapshot");
  const core = join(root, "packages", "core", "src");
  await writeFile(
    join(core, "types", "sample.ts"),
    `export const MAX_ITEMS = 10;
export enum SampleMode { A = "a", B = "b" }
export interface IDataRecord { id: string; }
export interface IServiceContract { run(): Promise<void>; }
export type SampleAlias = string | number;
`,
  );
  await writeFile(
    join(core, "func", "helper.ts"),
    `export function formatLabel(x: string): string { return x; }
export class PureHelper {}
const internalOnly = 1;
`,
  );
  await writeFile(
    join(core, "types", "mod.ts"),
    `export * from "./sample.ts";\n`,
  );
  await writeFile(
    join(core, "config", "ignored_l1.ts"),
    `export const LAYER1_ONLY = true;\n`,
  );
  return root;
}

Deno.test("go-port-core-l0-exports: lists every exported declaration across the 15 L0 directories once, skips barrels and L1 dirs", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeCoreSnapshot(dir);
    assertEquals(await listCoreL0Exports(root), [
      { module: "packages/core/src/func/helper.ts", symbol: "PureHelper" },
      { module: "packages/core/src/func/helper.ts", symbol: "formatLabel" },
      { module: "packages/core/src/types/sample.ts", symbol: "IDataRecord" },
      { module: "packages/core/src/types/sample.ts", symbol: "IServiceContract" },
      { module: "packages/core/src/types/sample.ts", symbol: "MAX_ITEMS" },
      { module: "packages/core/src/types/sample.ts", symbol: "SampleAlias" },
      { module: "packages/core/src/types/sample.ts", symbol: "SampleMode" },
    ]);
  });
});

Deno.test("go-port-core-l0-exports: written file is deterministic and sorted", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeCoreSnapshot(dir);
    const target = join(dir, "out", "core-l0_exports.json");
    await writeCoreL0Exports(root, target);
    const first = await Deno.readTextFile(target);
    await writeCoreL0Exports(root, target);
    assertEquals(await Deno.readTextFile(target), first);
    assertEquals(JSON.parse(first).exports.length, 7);
  });
});

async function referenceUnchanged(): Promise<boolean> {
  const result = await new Deno.Command("git", {
    cwd: ROOT,
    args: ["diff", "--quiet", REFERENCE, "HEAD", "--", "packages/core/src"],
    env: { LD_LIBRARY_PATH: "" },
  }).output();
  return result.success;
}

Deno.test({
  name: "go-port-core-l0-inventory: every export of the 15 directories at a956e0c8a is listed once",
  ignore: !(await referenceUnchanged()),
  fn: async () => {
    const live = await listCoreL0Exports(ROOT);
    const committed = JSON.parse(await Deno.readTextFile(EXPORTS_FILE)).exports;
    assertEquals(committed, live);
    const identities = new Set(live.map((item) => `${item.module}#${item.symbol}`));
    assert(identities.size === live.length, "the export list repeats a symbol");
  },
});
