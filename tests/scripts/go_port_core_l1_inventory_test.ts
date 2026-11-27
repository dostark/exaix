/**
 * @module GoPortCoreL1InventoryTest
 * @path tests/scripts/go_port_core_l1_inventory_test.ts
 * @description Exercises the frozen export list of packages/core Layer 1 directories and root files for the Go inventory.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import {
  CORE_L1_REFERENCE,
  extractCoreL1Exports,
  listCoreL1Exports,
  writeCoreL1Exports,
  writePinnedCoreL1Exports,
} from "../../scripts/go_port/core_l1_exports.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const EXPORTS_FILE = join(ROOT, "exaix-go", "port", "inventory", "core-l1_exports.json");
const REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

async function writeFile(path: string, body: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, body);
}

async function fakeCoreL1Snapshot(dir: string): Promise<string> {
  const root = join(dir, "snapshot");
  const core = join(root, "packages", "core", "src");
  await writeFile(
    join(core, "config", "sample_config.ts"),
    `export const DEFAULT_TIMEOUT = 1000;
export interface IConfigLoader { load(): Promise<void>; }
export class SampleConfigService {}
const internalOnly = 1;
`,
  );
  await writeFile(
    join(core, "config", "mod.ts"),
    `export * from "./sample_config.ts";\n`,
  );
  await writeFile(
    join(core, "prompt_budget_allocator.ts"),
    `export interface IAllocationHints { limit?: number; }
export class PromptBudgetAllocator {}
`,
  );
  await writeFile(
    join(core, "context", "prompt_budget_allocator.ts"),
    `import { PromptBudgetAllocator as CorePromptBudgetAllocator } from "@exaix/core";
export type PromptBudgetAllocator = InstanceType<typeof CorePromptBudgetAllocator>;
const PromptBudgetAllocator = CorePromptBudgetAllocator;
export { PromptBudgetAllocator };
`,
  );
  await writeFile(
    join(core, "context", "mod.ts"),
    `export * from "./prompt_budget_allocator.ts";\n`,
  );
  await writeFile(
    join(core, "execution-memory", "execution_memory_store.ts"),
    `export class ExecutionMemoryStore {}\n`,
  );
  await writeFile(
    join(core, "execution-memory", "mod.ts"),
    `export { ExecutionMemoryStore } from "./execution_memory_store.ts";
export type { IExecutionMemoryStore } from "../types/i_execution_memory_store.ts";
`,
  );
  await writeFile(
    join(core, "process_manager.ts"),
    `export class ProcessManager {}\n`,
  );
  await writeFile(
    join(core, "version.ts"),
    `export const BINARY_VERSION = "1.0.13";\n`,
  );
  await writeFile(
    join(core, "types", "i_execution_memory_store.ts"),
    `export interface IExecutionMemoryStore { read(): void; }\n`,
  );
  await writeFile(
    join(core, "func", "ignored_l0.ts"),
    `export const LAYER0_ONLY = true;\n`,
  );
  return root;
}

Deno.test("go-port-core-l1-exports: lists every L1 declaration once, resolves aliases/barrels and records out-of-area owners", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeCoreL1Snapshot(dir);
    const result = await extractCoreL1Exports(root);

    assertEquals(result.exports, [
      { module: "packages/core/src/config/sample_config.ts", symbol: "DEFAULT_TIMEOUT" },
      { module: "packages/core/src/config/sample_config.ts", symbol: "IConfigLoader" },
      { module: "packages/core/src/config/sample_config.ts", symbol: "SampleConfigService" },
      { module: "packages/core/src/execution-memory/execution_memory_store.ts", symbol: "ExecutionMemoryStore" },
      { module: "packages/core/src/process_manager.ts", symbol: "ProcessManager" },
      { module: "packages/core/src/prompt_budget_allocator.ts", symbol: "IAllocationHints" },
      { module: "packages/core/src/prompt_budget_allocator.ts", symbol: "PromptBudgetAllocator" },
      { module: "packages/core/src/version.ts", symbol: "BINARY_VERSION" },
    ]);

    const aliasEdge = result.reexports.find(
      (edge) =>
        edge.from_module === "packages/core/src/context/prompt_budget_allocator.ts" &&
        edge.exported_symbol === "PromptBudgetAllocator",
    );
    assert(aliasEdge !== undefined, "compatibility alias edge must be recorded");
    assertEquals(aliasEdge.target_module, "packages/core/src/prompt_budget_allocator.ts");
    assertEquals(aliasEdge.target_symbol, "PromptBudgetAllocator");
    assertEquals(aliasEdge.owner, "core-l1");

    const outOfAreaEdge = result.reexports.find(
      (edge) =>
        edge.from_module === "packages/core/src/execution-memory/mod.ts" &&
        edge.exported_symbol === "IExecutionMemoryStore",
    );
    assert(outOfAreaEdge !== undefined, "out-of-area re-export edge must be recorded");
    assertEquals(outOfAreaEdge.target_module, "packages/core/src/types/i_execution_memory_store.ts");
    assertEquals(outOfAreaEdge.target_symbol, "IExecutionMemoryStore");
    assertEquals(outOfAreaEdge.owner, "core-l0");
  });
});

Deno.test("go-port-core-l1-exports: written file is deterministic, sorted, and rejects another revision", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeCoreL1Snapshot(dir);
    const target = join(dir, "out", "core-l1_exports.json");
    await writeCoreL1Exports(root, target);
    const first = await Deno.readTextFile(target);
    await writeCoreL1Exports(root, target);
    assertEquals(await Deno.readTextFile(target), first);
    const parsed = JSON.parse(first);
    assertEquals(parsed.reference, CORE_L1_REFERENCE);
    assertEquals(parsed.exports.length, 8);

    const wrongManifest = {
      parent: "0000000000000000000000000000000000000000",
      submodules: {},
      content_hash: "0".repeat(64),
      lockfiles: {},
    };
    await assertRejects(
      () => writePinnedCoreL1Exports(root, target, wrongManifest),
      Error,
    );
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
  name: "go-port-core-l1-inventory: every export of the 8 Layer 1 groups at a956e0c8a is listed once",
  ignore: !(await referenceUnchanged()),
  fn: async () => {
    const live = await listCoreL1Exports(ROOT);
    const full = await extractCoreL1Exports(ROOT);
    const committed = JSON.parse(await Deno.readTextFile(EXPORTS_FILE));
    assertEquals(committed.reference, REFERENCE);
    assertEquals(committed.exports, live);
    assertEquals(committed.reexports, full.reexports);
    const identities = new Set(live.map((item) => `${item.module}#${item.symbol}`));
    assert(identities.size === live.length, "the export list repeats a symbol");
    const allocatorEntries = live.filter((item) => item.symbol === "PromptBudgetAllocator");
    assertEquals(allocatorEntries, [
      { module: "packages/core/src/prompt_budget_allocator.ts", symbol: "PromptBudgetAllocator" },
    ]);
  },
});
