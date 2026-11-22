#!/usr/bin/env -S deno run -A
/**
 * @module GoPortSchemasExports
 * @path scripts/go_port/schemas_exports.ts
 * @description Lists the exported schemas of packages/schemas and writes the frozen export list that the Go inventory covers.
 * Usage: deno run -A scripts/go_port/schemas_exports.ts [--snapshot=<dir>] [--target=<file>]
 */
import { dirname, join, resolve, toFileUrl } from "@std/path";
import { argValue } from "./cli_args.ts";
import { loadManifest, verifySnapshot } from "./conformance/generate.ts";
import { assertTargetAllowed, cloneSnapshot } from "./preserve_snapshot.ts";

export interface ISchemaExport {
  readonly module: string;
  readonly symbol: string;
}

const DEFAULT_TARGET = join("exaix-go", "port", "inventory", "schemas_exports.json");
const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", ".."));

/** Runs inside the verified snapshot. The modules load a native SQLite library, so the run needs env and ffi besides read. A schema is any exported value with `parse` and `safeParse`. */
const ADAPTER = `const root = Deno.args[0];
const base = root + "/packages/schemas/src";
const files = [];
async function collect(dir) {
  const entries = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory) await collect(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts") && entry.name !== "mod.ts") files.push(path);
  }
}
await collect(base);
const isSchema = (value) =>
  typeof value === "object" && value !== null && typeof value.parse === "function" &&
  typeof value.safeParse === "function";
const owners = new Map();
for (const path of files) {
  let loaded;
  try {
    loaded = await import(new URL("file://" + path).href);
  } catch (error) {
    throw new Error(path + ": " + (error instanceof Error ? error.message : String(error)));
  }
  const text = await Deno.readTextFile(path);
  for (const [symbol, value] of Object.entries(loaded)) {
    if (!isSchema(value)) continue;
    const module = path.slice(root.length + 1);
    const defines = new RegExp("export\\\\s+(?:const|let)\\\\s+" + symbol + "\\\\b").test(text);
    const known = owners.get(value);
    if (!known || (defines && !known.defines)) owners.set(value, { module, symbol, defines });
  }
}
const result = [...owners.values()].map(({ module, symbol }) => ({ module, symbol }));
result.sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
console.log(JSON.stringify(result));
`;

export async function listSchemaExports(root: string): Promise<ISchemaExport[]> {
  const temp = await Deno.makeTempDir({ prefix: "schemas-exports-" });
  const adapter = join(temp, "adapter.ts");
  await Deno.writeTextFile(adapter, ADAPTER);
  try {
    const result = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-ffi",
        "--config",
        join(root, "deno.json"),
        "--frozen",
        "--lock",
        join(root, "deno.lock"),
        toFileUrl(adapter).href,
        root,
      ],
      cwd: root,
      env: { LD_LIBRARY_PATH: "", DENO_NO_UPDATE_CHECK: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr).trim() || "schema export listing failed");
    }
    return JSON.parse(new TextDecoder().decode(result.stdout));
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => {});
  }
}

export async function writeSchemaExports(root: string, target: string): Promise<void> {
  const exports = await listSchemaExports(root);
  await Deno.mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify({ exports }, null, 2)}\n`);
  await Deno.rename(temporary, target);
}

async function main(args: readonly string[]): Promise<number> {
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, DEFAULT_TARGET));
  const manifest = await loadManifest();
  const snapshotArg = argValue(args, "snapshot");
  let snapshot = snapshotArg ? resolve(snapshotArg) : undefined;
  let owned = false;
  if (!snapshot) {
    snapshot = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-247-schemas-exports", crypto.randomUUID());
    await assertTargetAllowed(REPO_ROOT, snapshot);
    await Deno.mkdir(dirname(snapshot), { recursive: true });
    await cloneSnapshot(manifest, snapshot, REPO_ROOT);
    owned = true;
  }
  try {
    const errors = await verifySnapshot(snapshot, manifest);
    if (errors.length > 0) throw new Error(errors.join("; "));
    await writeSchemaExports(snapshot, target);
    console.log(`✅ ${target}`);
    return 0;
  } finally {
    if (owned) await Deno.remove(snapshot, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
