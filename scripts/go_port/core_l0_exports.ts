#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0Exports
 * @path scripts/go_port/core_l0_exports.ts
 * @description Lists every exported TypeScript declaration across the 15 packages/core Layer 0 directories and writes the frozen export list for the Go inventory.
 * Usage: deno run -A scripts/go_port/core_l0_exports.ts [--snapshot=<dir>] [--target=<file>]
 */
import ts from "typescript";
import { dirname, join, resolve } from "@std/path";
import { argValue } from "./cli_args.ts";
import { loadManifest, verifySnapshot } from "./conformance/generate.ts";
import { assertTargetAllowed, cloneSnapshot } from "./preserve_snapshot.ts";

export interface ICoreL0Export {
  readonly module: string;
  readonly symbol: string;
}

type TCoreL0Kind =
  | "constant"
  | "enum"
  | "data_type"
  | "service_interface"
  | "function"
  | "class";

interface ICoreL0ExportDetail extends ICoreL0Export {
  readonly kind: TCoreL0Kind;
}

const CORE_L0_DIRS: readonly string[] = [
  "authorizer",
  "composer",
  "cost",
  "errors",
  "evaluation",
  "func",
  "notification",
  "observability",
  "parsing",
  "repositories",
  "request",
  "security",
  "status",
  "triggers",
  "types",
];

const DEFAULT_TARGET = join("exaix-go", "port", "inventory", "core-l0_exports.json");
const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", ".."));

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function isServiceInterface(decl: ts.InterfaceDeclaration): boolean {
  for (const member of decl.members) {
    if (ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member)) {
      return true;
    }
    if (ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type)) {
      return true;
    }
  }
  return false;
}

function collectFileExports(modulePath: string, sourceText: string): ICoreL0ExportDetail[] {
  const sf = ts.createSourceFile(modulePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: ICoreL0ExportDetail[] = [];
  const seen = new Set<string>();

  const add = (symbol: string, kind: TCoreL0Kind): void => {
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    found.push({ module: modulePath, symbol, kind });
  };

  for (const stmt of sf.statements) {
    if (!hasExportModifier(stmt)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) add(decl.name.text, "constant");
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt.name.text, "enum");
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt.name.text, isServiceInterface(stmt) ? "service_interface" : "data_type");
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt.name.text, "data_type");
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      add(stmt.name.text, "function");
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      add(stmt.name.text, "class");
    }
  }
  return found;
}

async function collectTsFiles(dir: string, out: string[]): Promise<void> {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      await collectTsFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts") && entry.name !== "mod.ts") {
      out.push(full);
    }
  }
}

async function listCoreL0ExportDetails(root: string): Promise<ICoreL0ExportDetail[]> {
  const base = join(root, "packages", "core", "src");
  const files: string[] = [];
  for (const sub of CORE_L0_DIRS) {
    await collectTsFiles(join(base, sub), files);
  }
  const results: ICoreL0ExportDetail[] = [];
  const prefix = root.endsWith("/") ? root : `${root}/`;
  for (const file of files) {
    const modulePath = file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const text = await Deno.readTextFile(file);
    results.push(...collectFileExports(modulePath, text));
  }
  results.sort((a, b) =>
    a.module < b.module ? -1 : a.module > b.module ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0
  );
  return results;
}

export async function listCoreL0Exports(root: string): Promise<ICoreL0Export[]> {
  const details = await listCoreL0ExportDetails(root);
  return details.map(({ module, symbol }) => ({ module, symbol }));
}

export async function writeCoreL0Exports(root: string, target: string): Promise<void> {
  const exports = await listCoreL0Exports(root);
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
    snapshot = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-248-core-l0-exports", crypto.randomUUID());
    await assertTargetAllowed(REPO_ROOT, snapshot);
    await Deno.mkdir(dirname(snapshot), { recursive: true });
    await cloneSnapshot(manifest, snapshot, REPO_ROOT);
    owned = true;
  }
  try {
    const errors = await verifySnapshot(snapshot, manifest);
    if (errors.length > 0) throw new Error(errors.join("; "));
    await writeCoreL0Exports(snapshot, target);
    console.log(`✅ ${target}`);
    return 0;
  } finally {
    if (owned) await Deno.remove(snapshot, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
