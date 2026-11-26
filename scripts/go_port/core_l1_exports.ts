#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1Exports
 * @path scripts/go_port/core_l1_exports.ts
 * @description Lists every exported TypeScript declaration across the 8 packages/core Layer 1 groups, resolves re-export and alias edges to declaring identities, and writes the frozen export list for the Go inventory.
 * Usage: deno run -A scripts/go_port/core_l1_exports.ts [--snapshot=<dir>] [--target=<file>]
 */
import ts from "typescript";
import { dirname, join, normalize, resolve } from "@std/path";
import { argValue } from "./cli_args.ts";
import { type ISnapshotManifest, loadManifest, verifySnapshot } from "./conformance/generate.ts";
import { assertTargetAllowed, cloneSnapshot } from "./preserve_snapshot.ts";

export interface ICoreL1Export {
  readonly module: string;
  readonly symbol: string;
}

type TCoreL1Kind =
  | "constant"
  | "enum"
  | "data_type"
  | "service_interface"
  | "function"
  | "class";

interface ICoreL1ExportDetail extends ICoreL1Export {
  readonly kind: TCoreL1Kind;
}

export type TReexportOwner = "core-l1" | "core-l0" | "external";
export type TReexportKind = "barrel_star" | "barrel_named" | "alias";

export interface ICoreL1Reexport {
  readonly from_module: string;
  readonly exported_symbol: string;
  readonly target_module: string;
  readonly target_symbol: string;
  readonly owner: TReexportOwner;
  readonly kind: TReexportKind;
}

export interface ICoreL1Extraction {
  readonly reference: string;
  readonly exports: readonly ICoreL1Export[];
  readonly reexports: readonly ICoreL1Reexport[];
}

export const CORE_L1_REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

const CORE_L1_DIRS: readonly string[] = [
  "blueprint",
  "config",
  "context",
  "execution-memory",
  "fs",
  "helpers",
  "logger",
];

const CORE_L1_ROOT_FILES: readonly string[] = [
  "process_manager.ts",
  "prompt_budget_allocator.ts",
  "version.ts",
];

const CORE_L0_DIRS: ReadonlySet<string> = new Set([
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
]);

const DEFAULT_TARGET = join("exaix-go", "port", "inventory", "core-l1_exports.json");
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

function areaOwnerOf(modulePath: string): TReexportOwner {
  const prefix = "packages/core/src/";
  if (!modulePath.startsWith(prefix)) return "external";
  const rel = modulePath.slice(prefix.length);
  const slash = rel.indexOf("/");
  if (slash === -1) {
    return CORE_L1_ROOT_FILES.includes(rel) ? "core-l1" : "external";
  }
  const topDir = rel.slice(0, slash);
  if (CORE_L1_DIRS.includes(topDir)) return "core-l1";
  if (CORE_L0_DIRS.has(topDir)) return "core-l0";
  return "external";
}

function resolveRelativeModule(fromModule: string, specifier: string): string {
  const joined = normalize(join(dirname(fromModule), specifier));
  return joined.replaceAll("\\", "/");
}

interface IImportBinding {
  readonly specifier: string;
  readonly importedName: string;
}

function collectImportBindings(sf: ts.SourceFile): Map<string, IImportBinding> {
  const bindings = new Map<string, IImportBinding>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const specifier = stmt.moduleSpecifier.text;
    for (const el of clause.namedBindings.elements) {
      const localName = el.name.text;
      const importedName = el.propertyName ? el.propertyName.text : localName;
      bindings.set(localName, { specifier, importedName });
    }
  }
  return bindings;
}

function collectLocalAliasTargets(
  sf: ts.SourceFile,
  imports: ReadonlyMap<string, IImportBinding>,
): Map<string, IImportBinding> {
  const aliases = new Map<string, IImportBinding>();
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isIdentifier(decl.initializer)) {
          const bound = imports.get(decl.initializer.text);
          if (bound) aliases.set(decl.name.text, bound);
        }
      }
    }
  }
  return aliases;
}

function isInstanceTypeOfImport(
  node: ts.TypeAliasDeclaration,
  imports: ReadonlyMap<string, IImportBinding>,
): IImportBinding | undefined {
  if (!ts.isTypeReferenceNode(node.type) || !ts.isIdentifier(node.type.typeName)) return undefined;
  if (node.type.typeName.text !== "InstanceType" || !node.type.typeArguments?.length) return undefined;
  const arg = node.type.typeArguments[0];
  if (!ts.isTypeQueryNode(arg) || !ts.isIdentifier(arg.exprName)) return undefined;
  return imports.get(arg.exprName.text);
}

interface IFileScanResult {
  readonly declarations: readonly ICoreL1ExportDetail[];
  readonly pendingAliases: readonly {
    readonly fromModule: string;
    readonly exportedSymbol: string;
    readonly specifier: string;
    readonly targetSymbol: string;
  }[];
}

function scanSourceFile(modulePath: string, sourceText: string): IFileScanResult {
  const sf = ts.createSourceFile(modulePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = collectImportBindings(sf);
  const localAliases = collectLocalAliasTargets(sf, imports);
  const declarations: ICoreL1ExportDetail[] = [];
  const pendingAliases: {
    fromModule: string;
    exportedSymbol: string;
    specifier: string;
    targetSymbol: string;
  }[] = [];
  const seenDecl = new Set<string>();
  const seenAlias = new Set<string>();

  const addDecl = (symbol: string, kind: TCoreL1Kind): void => {
    if (!symbol || seenDecl.has(symbol)) return;
    seenDecl.add(symbol);
    declarations.push({ module: modulePath, symbol, kind });
  };

  const addAlias = (exportedSymbol: string, binding: IImportBinding): void => {
    const key = `${exportedSymbol}->${binding.specifier}#${binding.importedName}`;
    if (seenAlias.has(key)) return;
    seenAlias.add(key);
    pendingAliases.push({
      fromModule: modulePath,
      exportedSymbol,
      specifier: binding.specifier,
      targetSymbol: binding.importedName,
    });
  };

  for (const stmt of sf.statements) {
    if (
      ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        const localName = el.propertyName ? el.propertyName.text : el.name.text;
        const exportedSymbol = el.name.text;
        const binding = localAliases.get(localName) ?? imports.get(localName);
        if (binding) {
          addAlias(exportedSymbol, binding);
        }
      }
      continue;
    }

    if (!hasExportModifier(stmt)) continue;

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (decl.initializer && ts.isIdentifier(decl.initializer)) {
          const bound = imports.get(decl.initializer.text);
          if (bound) {
            addAlias(decl.name.text, bound);
            continue;
          }
        }
        addDecl(decl.name.text, "constant");
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      addDecl(stmt.name.text, "enum");
    } else if (ts.isInterfaceDeclaration(stmt)) {
      addDecl(stmt.name.text, isServiceInterface(stmt) ? "service_interface" : "data_type");
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      const aliasTarget = isInstanceTypeOfImport(stmt, imports);
      if (aliasTarget) {
        addAlias(stmt.name.text, aliasTarget);
      } else {
        addDecl(stmt.name.text, "data_type");
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addDecl(stmt.name.text, "function");
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      addDecl(stmt.name.text, "class");
    }
  }

  return { declarations, pendingAliases };
}

async function collectTsFiles(dir: string, nonBarrels: string[], barrels: string[]): Promise<void> {
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
      await collectTsFiles(full, nonBarrels, barrels);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts")) {
      if (entry.name === "mod.ts") {
        barrels.push(full);
      } else {
        nonBarrels.push(full);
      }
    }
  }
}

function compareReexports(a: ICoreL1Reexport, b: ICoreL1Reexport): number {
  if (a.from_module !== b.from_module) return a.from_module < b.from_module ? -1 : 1;
  if (a.exported_symbol !== b.exported_symbol) return a.exported_symbol < b.exported_symbol ? -1 : 1;
  if (a.target_module !== b.target_module) return a.target_module < b.target_module ? -1 : 1;
  if (a.target_symbol !== b.target_symbol) return a.target_symbol < b.target_symbol ? -1 : 1;
  return 0;
}

async function listCoreL1ExportDetails(root: string): Promise<{
  readonly details: readonly ICoreL1ExportDetail[];
  readonly reexports: readonly ICoreL1Reexport[];
}> {
  const base = join(root, "packages", "core", "src");
  const nonBarrels: string[] = [];
  const barrels: string[] = [];

  for (const sub of CORE_L1_DIRS) {
    await collectTsFiles(join(base, sub), nonBarrels, barrels);
  }
  for (const rootFile of CORE_L1_ROOT_FILES) {
    const full = join(base, rootFile);
    try {
      await Deno.stat(full);
      nonBarrels.push(full);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  nonBarrels.sort();
  barrels.sort();

  const prefix = root.endsWith("/") ? root : `${root}/`;
  const toModulePath = (file: string): string =>
    (file.startsWith(prefix) ? file.slice(prefix.length) : file).replaceAll("\\", "/");

  const details: ICoreL1ExportDetail[] = [];
  const declByModule = new Map<string, ICoreL1ExportDetail[]>();
  const declBySymbol = new Map<string, ICoreL1ExportDetail[]>();
  const pendingAliases: {
    fromModule: string;
    exportedSymbol: string;
    specifier: string;
    targetSymbol: string;
  }[] = [];

  for (const file of nonBarrels) {
    const modulePath = toModulePath(file);
    const text = await Deno.readTextFile(file);
    const scanned = scanSourceFile(modulePath, text);
    for (const item of scanned.declarations) {
      details.push(item);
      const byMod = declByModule.get(item.module) ?? [];
      byMod.push(item);
      declByModule.set(item.module, byMod);
      const bySym = declBySymbol.get(item.symbol) ?? [];
      bySym.push(item);
      declBySymbol.set(item.symbol, bySym);
    }
    pendingAliases.push(...scanned.pendingAliases);
  }

  const reexports: ICoreL1Reexport[] = [];
  const reexportKeySet = new Set<string>();
  const addReexport = (edge: ICoreL1Reexport): void => {
    const key = `${edge.from_module}#${edge.exported_symbol}->${edge.target_module}#${edge.target_symbol}`;
    if (reexportKeySet.has(key)) return;
    reexportKeySet.add(key);
    reexports.push(edge);
  };

  // Resolve explicit compatibility aliases (e.g., context/prompt_budget_allocator.ts -> prompt_budget_allocator.ts)
  const aliasTargetByModule = new Map<
    string,
    { exportedSymbol: string; targetModule: string; targetSymbol: string }[]
  >();
  for (const pending of pendingAliases) {
    let targetModule = "";
    if (pending.specifier.startsWith(".")) {
      targetModule = resolveRelativeModule(pending.fromModule, pending.specifier);
    } else if (pending.specifier === "@exaix/core") {
      const candidates = declBySymbol.get(pending.targetSymbol) ?? [];
      if (candidates.length === 1) {
        targetModule = candidates[0].module;
      }
    }
    if (!targetModule) {
      throw new Error(
        `Unable to resolve alias ${pending.fromModule}#${pending.exportedSymbol} from ${pending.specifier}#${pending.targetSymbol}`,
      );
    }
    addReexport({
      from_module: pending.fromModule,
      exported_symbol: pending.exportedSymbol,
      target_module: targetModule,
      target_symbol: pending.targetSymbol,
      owner: areaOwnerOf(targetModule),
      kind: "alias",
    });
    const list = aliasTargetByModule.get(pending.fromModule) ?? [];
    list.push({
      exportedSymbol: pending.exportedSymbol,
      targetModule,
      targetSymbol: pending.targetSymbol,
    });
    aliasTargetByModule.set(pending.fromModule, list);
  }

  // Record barrel re-export edges without duplicating declarations or recapturing out-of-area declarations
  for (const file of barrels) {
    const modulePath = toModulePath(file);
    const text = await Deno.readTextFile(file);
    const sf = ts.createSourceFile(modulePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) {
        continue;
      }
      const targetModule = resolveRelativeModule(modulePath, stmt.moduleSpecifier.text);
      const owner = areaOwnerOf(targetModule);
      if (!stmt.exportClause) {
        // export * from "./target.ts"
        for (const decl of declByModule.get(targetModule) ?? []) {
          addReexport({
            from_module: modulePath,
            exported_symbol: decl.symbol,
            target_module: decl.module,
            target_symbol: decl.symbol,
            owner: areaOwnerOf(decl.module),
            kind: "barrel_star",
          });
        }
        for (const aliased of aliasTargetByModule.get(targetModule) ?? []) {
          addReexport({
            from_module: modulePath,
            exported_symbol: aliased.exportedSymbol,
            target_module: aliased.targetModule,
            target_symbol: aliased.targetSymbol,
            owner: areaOwnerOf(aliased.targetModule),
            kind: "barrel_star",
          });
        }
      } else if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const targetSymbol = el.propertyName ? el.propertyName.text : el.name.text;
          const exportedSymbol = el.name.text;
          addReexport({
            from_module: modulePath,
            exported_symbol: exportedSymbol,
            target_module: targetModule,
            target_symbol: targetSymbol,
            owner,
            kind: "barrel_named",
          });
        }
      }
    }
  }

  details.sort((a, b) =>
    a.module < b.module ? -1 : a.module > b.module ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0
  );
  reexports.sort(compareReexports);

  return { details, reexports };
}

export async function listCoreL1Exports(root: string): Promise<ICoreL1Export[]> {
  const { details } = await listCoreL1ExportDetails(root);
  return details.map(({ module, symbol }) => ({ module, symbol }));
}

export async function extractCoreL1Exports(
  root: string,
  reference = CORE_L1_REFERENCE,
): Promise<ICoreL1Extraction> {
  const { details, reexports } = await listCoreL1ExportDetails(root);
  return {
    reference,
    exports: details.map(({ module, symbol }) => ({ module, symbol })),
    reexports,
  };
}

export async function writeCoreL1Exports(
  root: string,
  target: string,
  reference = CORE_L1_REFERENCE,
): Promise<void> {
  const payload = await extractCoreL1Exports(root, reference);
  await Deno.mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  await Deno.rename(temporary, target);
}

export async function writePinnedCoreL1Exports(
  snapshot: string,
  target: string,
  manifest: ISnapshotManifest,
): Promise<void> {
  const errors = await verifySnapshot(snapshot, manifest);
  if (errors.length > 0) {
    throw new Error(`Pinned snapshot verification failed: ${errors.join("; ")}`);
  }
  await writeCoreL1Exports(snapshot, target, manifest.parent);
}

async function main(args: readonly string[]): Promise<number> {
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, DEFAULT_TARGET));
  const manifest = await loadManifest();
  const snapshotArg = argValue(args, "snapshot");
  let snapshot = snapshotArg ? resolve(snapshotArg) : undefined;
  let owned = false;
  if (!snapshot) {
    snapshot = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-249-core-l1-exports", crypto.randomUUID());
    await assertTargetAllowed(REPO_ROOT, snapshot);
    await Deno.mkdir(dirname(snapshot), { recursive: true });
    await cloneSnapshot(manifest, snapshot, REPO_ROOT);
    owned = true;
  }
  try {
    await writePinnedCoreL1Exports(snapshot, target, manifest);
    console.log(`✅ ${target}`);
    return 0;
  } finally {
    if (owned) await Deno.remove(snapshot, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
