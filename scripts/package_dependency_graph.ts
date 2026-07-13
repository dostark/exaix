#!/usr/bin/env -S deno run -A
/**
 * @module PackageDependencyGraph
 * @path scripts/package_dependency_graph.ts
 * @description Builds a package-level dependency graph from `deno info --json` and
 * explains file-level package boundaries.
 *
 * @deprecated The migration from `src/` to `packages/` is complete.
 * This tool is retired and retained only for historical analysis of the old
 * composition layer. See the `packages/` directory for the current structure.
 *
 * Usage:
 *
 *   Default — full package dependency graph from an entrypoint:
 *     deno run --allow-run --allow-read scripts/package_dependency_graph.ts
 *     deno run --allow-run --allow-read scripts/package_dependency_graph.ts \
 *       --entrypoint apps/daemon/main.ts --format dot
 *     deno run --allow-run --allow-read scripts/package_dependency_graph.ts \
 *       --candidate-package @exaix/mcp
 *
 *   --explain-boundary — fan-out analysis for a single file:
 *     deno run --allow-run --allow-read scripts/package_dependency_graph.ts \
 *       --explain-boundary apps/daemon/main.ts
 *
 *     Runs `deno info` on the target file directly, walks its full transitive
 *     dependency graph, and groups every dependency by owning package.
 *     Emits a verdict: EXTRACTABLE when all deps are package-owned or external,
 *     NOT extractable when one or more deps still live in the src/ composition
 *     layer and would need to move first.
 *
 *     Now retired — use this for historical analysis to confirm why a file
 *     intentionally stayed in src/ (its deps spanned root services) or to
 *     verify that a packages/ file had no improper src/ leakage.
 */

import { parse } from "@std/flags";
import { dirname, extname, fromFileUrl, join, normalize, relative } from "@std/path";

type PackageDependencyFormat = "text" | "json" | "dot";

export interface IDenoInfoDependency {
  specifier: string;
  code?: {
    specifier: string;
  };
}

export interface IDenoInfoModule {
  specifier: string;
  local?: string;
  dependencies?: IDenoInfoDependency[];
}

export interface IDenoInfoJson {
  version: number;
  roots: string[];
  modules: IDenoInfoModule[];
}

export interface IPackageInfo {
  root: string;
  name: string;
  modules: string[];
  outgoing: string[];
  incoming: string[];
}

export interface ICandidateReport {
  targetPackage: string;
  targetRoot: string;
  directSrcModules: string[];
  transitiveSrcModules: string[];
  allSrcModules: string[];
}

export interface IPackageGraph {
  packages: IPackageInfo[];
  edges: Array<{ from: string; to: string }>;
  externalPackages: string[];
  candidateReport?: ICandidateReport;
}

export interface IPackageGraphOptions {
  importAliases?: Record<string, string>;
}

export interface IPackageDiscovery {
  roots: string[];
  importAliases: Record<string, string>;
}

export interface IBoundaryGroup {
  /** Display name of the owning package (e.g. "@exaix/mcp", "@exaix (retired src/)"). */
  packageName: string;
  /** Repo-relative paths of modules in this group. */
  modules: string[];
}

export interface IBoundaryReport {
  /** Repo-relative path of the analysed file. */
  targetPath: string;
  /** Dependencies directly imported by the target, grouped by package. */
  directGroups: IBoundaryGroup[];
  /** All transitive dependencies (excluding direct), grouped by package. */
  transitiveGroups: IBoundaryGroup[];
  /** External (jsr:, npm:, https:) specifiers directly imported by the target. */
  externalDirect: string[];
  /**
   * True when every dependency (direct and transitive) is either package-owned
   * or external — no retired src/ composition-layer modules appear in the fan-out.
   */
  extractable: boolean;
  /** Total count of retired src/ modules in the full transitive fan-out. */
  srcDepsCount: number;
}

const ROOT = Deno.cwd();
const DEFAULT_ENTRYPOINT = "apps/daemon/main.ts";
const DEFAULT_FORMAT: PackageDependencyFormat = "text";

export async function main(): Promise<void> {
  const args = parse(Deno.args, {
    string: ["entrypoint", "format", "candidatePackage", "explain-boundary"],
    boolean: ["help"],
    default: {
      entrypoint: DEFAULT_ENTRYPOINT,
      format: DEFAULT_FORMAT,
    },
  });

  if (args.help) {
    printUsage();
    return;
  }

  const entrypoint = String(args.entrypoint || DEFAULT_ENTRYPOINT);
  const format = String(args.format || DEFAULT_FORMAT) as PackageDependencyFormat;
  const candidatePackage = typeof args.candidatePackage === "string"
    ? String(args.candidatePackage)
    : typeof args["candidate-package"] === "string"
    ? String(args["candidate-package"])
    : undefined;
  const explainBoundaryPath = typeof args["explain-boundary"] === "string"
    ? String(args["explain-boundary"])
    : undefined;

  const packageDiscovery = await discoverPackageRoots();

  if (explainBoundaryPath) {
    const report = await explainBoundary(explainBoundaryPath, packageDiscovery.roots, {
      importAliases: packageDiscovery.importAliases,
    });
    console.log(renderBoundaryReport(report));
    return;
  }

  const info = await runDenoInfo(entrypoint);
  const graph = buildPackageGraph(info, packageDiscovery.roots, {
    importAliases: packageDiscovery.importAliases,
  });

  const candidateReport = candidatePackage
    ? findCandidateSrcModules(info, packageDiscovery.roots, candidatePackage, {
      importAliases: packageDiscovery.importAliases,
    })
    : undefined;

  if (candidatePackage && !candidateReport) {
    console.error(`Unknown candidate package: ${candidatePackage}`);
    Deno.exit(1);
  }

  if (candidateReport) {
    graph.candidateReport = candidateReport;
  }

  if (format === "json") {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  if (format === "dot") {
    console.log(renderDot(graph));
    return;
  }

  console.log(renderTextReport(entrypoint, graph));
}

function printUsage() {
  console.log(`Usage: deno run -A scripts/package_dependency_graph.ts [options]

Options:
  --entrypoint <path>         Entry point to analyze (default: apps/daemon/main.ts)
  --format <text|json|dot>    Output format (default: text)
  --candidate-package <pkg>   Report retired src/ modules that should move into this package
  --explain-boundary <path>   Fan-out analysis: show why a file stayed in retired src/ or is
                              extractable; groups all transitive deps by owning package
                              and emits an EXTRACTABLE / NOT extractable verdict
  --help                      Show this help message
`);
}

export async function runDenoInfo(entrypoint: string): Promise<IDenoInfoJson> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr).trim();
    throw new Error(`deno info failed: ${err}`);
  }

  const raw = new TextDecoder().decode(stdout);
  return JSON.parse(raw) as IDenoInfoJson;
}

export async function discoverPackageRoots(): Promise<IPackageDiscovery> {
  const configPath = join(ROOT, "deno.json");
  const configText = await Deno.readTextFile(configPath);
  const config = JSON.parse(configText) as { workspace?: string[]; imports?: Record<string, string> };

  const roots = new Set<string>();
  if (Array.isArray(config.workspace)) {
    for (const workspacePath of config.workspace) {
      if (typeof workspacePath !== "string" || workspacePath.trim() === "") continue;
      roots.add(normalize(workspacePath.replace(/\/+$/, "")));
    }
  }

  if (!roots.has("src")) {
    roots.add("src");
  }

  const importAliases: Record<string, string> = {};
  if (config.imports && typeof config.imports === "object") {
    for (const [key, value] of Object.entries(config.imports)) {
      if (typeof value !== "string") continue;
      const normalizedValue = isRepoRelativeSpecifier(value) ? normalize(value.replace(/\/+$/, "")) : value;
      importAliases[key] = normalizedValue;
    }
  }

  return {
    roots: Array.from(roots).sort((a, b) => a.length - b.length),
    importAliases,
  };
}

export function buildPackageGraph(
  info: IDenoInfoJson,
  packageRoots: string[],
  options: IPackageGraphOptions = {},
): IPackageGraph {
  const localModuleToPackage = new Map<string, string>();
  const packageInfo = new Map<string, IPackageInfo>();
  const packageNames = getPackageNamesByRoot(packageRoots, options.importAliases);

  for (const root of packageRoots) {
    packageInfo.set(root, {
      root,
      name: packageNames.get(root) ?? root,
      modules: [],
      outgoing: [],
      incoming: [],
    });
  }

  const localModules = info.modules
    .map((module) => ({ module, path: toRepoPath(module.specifier) }))
    .filter((entry): entry is { module: IDenoInfoModule; path: string } => entry.path !== undefined);

  for (const { path } of localModules) {
    const pkg = selectPackageRoot(path, packageRoots);
    if (!pkg) {
      continue;
    }
    localModuleToPackage.set(path, pkg);
    const info = packageInfo.get(pkg)!;
    info.modules.push(path);
  }

  const edges = new Set<string>();
  const externalPackages = new Set<string>();

  for (const { module, path } of localModules) {
    const sourcePackage = localModuleToPackage.get(path)!;
    if (!sourcePackage) {
      continue;
    }
    for (const dep of module.dependencies ?? []) {
      const depSpecifier = getRuntimeDependencySpecifier(dep);
      if (!depSpecifier) {
        continue;
      }
      let depPath = toRepoPath(depSpecifier, path);
      if (!depPath && options.importAliases) {
        depPath = resolveAliasPath(depSpecifier, options.importAliases);
      }
      if (!depPath) {
        depPath = toRepoPath(depSpecifier);
      }

      if (!depPath) {
        externalPackages.add(depSpecifier);
        continue;
      }

      const targetPackage = localModuleToPackage.get(depPath) ?? selectPackageRoot(depPath, packageRoots);
      if (!targetPackage) {
        continue;
      }
      if (targetPackage === sourcePackage) continue;

      const sourceInfo = packageInfo.get(sourcePackage)!;
      const targetInfo = packageInfo.get(targetPackage)!;
      const edgeKey = `${sourceInfo.name} -> ${targetInfo.name}`;
      if (!edges.has(edgeKey)) {
        edges.add(edgeKey);
        sourceInfo.outgoing.push(targetInfo.name);
        targetInfo.incoming.push(sourceInfo.name);
      }
    }
  }

  return {
    packages: Array.from(packageInfo.values()).sort((a, b) => a.name.localeCompare(b.name)),
    edges: Array.from(edges).map((entry) => {
      const [from, , to] = entry.split(" ");
      return { from: from!, to: to! };
    }),
    externalPackages: Array.from(externalPackages).sort(),
  };
}

export function selectPackageRoot(path: string, packageRoots: string[]): string | undefined {
  let match: string | undefined;
  for (const root of packageRoots) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (!match || root.length > match.length) {
        match = root;
      }
    }
  }
  return match;
}

export function findCandidateSrcModules(
  info: IDenoInfoJson,
  packageRoots: string[],
  targetPackage: string,
  options: IPackageGraphOptions = {},
): ICandidateReport | undefined {
  const targetRoot = resolveTargetPackageRoot(targetPackage, packageRoots, options.importAliases);
  if (!targetRoot) {
    return undefined;
  }

  const localModules = info.modules
    .map((module) => ({ module, path: toRepoPath(module.specifier) }))
    .filter((entry): entry is { module: IDenoInfoModule; path: string } => entry.path !== undefined);

  const pathToPackage = new Map<string, string>();
  const pathToModule = new Map<string, IDenoInfoModule>();
  const reverseDeps = new Map<string, Set<string>>();

  for (const { module, path } of localModules) {
    const pkg = selectPackageRoot(path, packageRoots);
    if (!pkg) {
      continue;
    }
    pathToPackage.set(path, pkg);
    pathToModule.set(path, module);
  }

  for (const { module, path } of localModules) {
    for (const dep of module.dependencies ?? []) {
      const depSpecifier = getRuntimeDependencySpecifier(dep);
      if (!depSpecifier) {
        continue;
      }
      let depPath = toRepoPath(depSpecifier, path);
      if (!depPath && options.importAliases) {
        depPath = resolveAliasPath(depSpecifier, options.importAliases);
      }
      if (!depPath) {
        depPath = toRepoPath(depSpecifier);
      }
      if (!depPath) continue;

      if (!reverseDeps.has(depPath)) {
        reverseDeps.set(depPath, new Set());
      }
      reverseDeps.get(depPath)!.add(path);
    }
  }

  const srcRoot = "src";
  const directSrcModules = new Set<string>();
  for (const { module, path } of localModules) {
    if (!path.startsWith(`${srcRoot}/`)) continue;

    for (const dep of module.dependencies ?? []) {
      const depSpecifier = getRuntimeDependencySpecifier(dep);
      if (!depSpecifier) {
        continue;
      }
      let depPath = toRepoPath(depSpecifier, path);
      if (!depPath && options.importAliases) {
        depPath = resolveAliasPath(depSpecifier, options.importAliases);
      }
      if (!depPath) {
        depPath = toRepoPath(depSpecifier);
      }
      if (!depPath) continue;

      const depPackage = pathToPackage.get(depPath) ?? selectPackageRoot(depPath, packageRoots);
      if (!depPackage) {
        continue;
      }
      if (depPackage === targetRoot) {
        directSrcModules.add(path);
        break;
      }
    }
  }

  const visited = new Set<string>(directSrcModules);
  const queue = [...directSrcModules];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parent of reverseDeps.get(current) ?? []) {
      if (!parent.startsWith(`${srcRoot}/`)) continue;
      if (!visited.has(parent)) {
        visited.add(parent);
        queue.push(parent);
      }
    }
  }

  const allSrcModules = Array.from(visited).sort();
  const directList = Array.from(directSrcModules).sort();
  const transitiveList = allSrcModules.filter((path) => !directSrcModules.has(path));

  return {
    targetPackage,
    targetRoot,
    directSrcModules: directList,
    transitiveSrcModules: transitiveList,
    allSrcModules,
  };
}

const SRC_ROOT = "src";
const SRC_DISPLAY_NAME = "@exaix (retired src/)";

export function buildBoundaryReport(
  info: IDenoInfoJson,
  targetPath: string,
  packageRoots: string[],
  options: IPackageGraphOptions = {},
): IBoundaryReport {
  const packageNames = getPackageNamesByRoot(packageRoots, options.importAliases);
  const normalizedTarget = normalize(targetPath);

  const pathToModule = new Map<string, IDenoInfoModule>();
  for (const module of info.modules) {
    const path = toRepoPath(module.specifier);
    if (path) pathToModule.set(path, module);
  }

  function resolveDep(specifier: string, fromPath: string): string | undefined {
    let depPath = toRepoPath(specifier, fromPath);
    if (!depPath && options.importAliases) depPath = resolveAliasPath(specifier, options.importAliases);
    if (!depPath) depPath = toRepoPath(specifier);
    return depPath;
  }

  function classifyPath(path: string): string {
    const pkgRoot = selectPackageRoot(path, packageRoots);
    if (!pkgRoot) return SRC_DISPLAY_NAME;
    if (pkgRoot === SRC_ROOT) return SRC_DISPLAY_NAME;
    return packageNames.get(pkgRoot) ?? pkgRoot;
  }

  const targetModule = pathToModule.get(normalizedTarget);
  const directDepPaths: string[] = [];
  const externalDirect: string[] = [];

  for (const dep of targetModule?.dependencies ?? []) {
    const spec = getRuntimeDependencySpecifier(dep);
    if (!spec) continue;
    const depPath = resolveDep(spec, normalizedTarget);
    if (depPath) {
      directDepPaths.push(depPath);
    } else {
      externalDirect.push(spec);
    }
  }

  const visited = new Set<string>([normalizedTarget, ...directDepPaths]);
  const queue = [...directDepPaths];
  const transitiveDepPaths: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const module = pathToModule.get(current);
    if (!module) continue;
    for (const dep of module.dependencies ?? []) {
      const spec = getRuntimeDependencySpecifier(dep);
      if (!spec) continue;
      const depPath = resolveDep(spec, current);
      if (!depPath || visited.has(depPath)) continue;
      visited.add(depPath);
      transitiveDepPaths.push(depPath);
      queue.push(depPath);
    }
  }

  function groupByPackage(paths: string[]): IBoundaryGroup[] {
    const groups = new Map<string, string[]>();
    for (const path of paths) {
      const name = classifyPath(path);
      const list = groups.get(name) ?? [];
      list.push(path);
      groups.set(name, list);
    }
    return Array.from(groups.entries())
      .map(([packageName, modules]) => ({ packageName, modules: modules.sort() }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName));
  }

  const allPaths = [...directDepPaths, ...transitiveDepPaths];
  const srcDepsCount = allPaths.filter(
    (p) => selectPackageRoot(p, packageRoots) === SRC_ROOT,
  ).length;

  return {
    targetPath: normalizedTarget,
    directGroups: groupByPackage(directDepPaths),
    transitiveGroups: groupByPackage(transitiveDepPaths),
    externalDirect,
    extractable: srcDepsCount === 0,
    srcDepsCount,
  };
}

export async function explainBoundary(
  targetPath: string,
  packageRoots: string[],
  options: IPackageGraphOptions = {},
): Promise<IBoundaryReport> {
  const info = await runDenoInfo(targetPath);
  return buildBoundaryReport(info, targetPath, packageRoots, options);
}

function resolveTargetPackageRoot(
  targetPackage: string,
  packageRoots: string[],
  aliasMap: Record<string, string> = {},
): string | undefined {
  if (targetPackage === "@exaix") {
    return "src";
  }

  if (packageRoots.includes(targetPackage)) {
    return targetPackage;
  }

  const aliasPath = resolveAliasPath(targetPackage, aliasMap);
  if (!aliasPath) {
    return undefined;
  }

  return selectPackageRoot(aliasPath, packageRoots);
}

function getPackageNamesByRoot(packageRoots: string[], aliasMap: Record<string, string> = {}): Map<string, string> {
  const packageNames = new Map<string, string>();

  for (const root of packageRoots) {
    if (root === "src") {
      packageNames.set(root, "@exaix");
      continue;
    }

    packageNames.set(root, findCanonicalPackageAlias(root, aliasMap) ?? root);
  }

  return packageNames;
}

function findCanonicalPackageAlias(root: string, aliasMap: Record<string, string>): string | undefined {
  for (const [alias, mappedPath] of Object.entries(aliasMap)) {
    if (alias.endsWith("/")) {
      continue;
    }

    if (!isRepoRelativeSpecifier(mappedPath)) {
      continue;
    }

    const normalizedMappedPath = normalize(mappedPath);
    if (
      normalizedMappedPath === root ||
      normalizedMappedPath === join(root, "mod.ts") ||
      normalizedMappedPath === join(root, "index.ts")
    ) {
      return alias;
    }
  }

  return undefined;
}

export function toRepoPath(specifier: string, baseModulePath?: string): string | undefined {
  if (specifier.startsWith("file://")) {
    try {
      const localPath = fromFileUrl(new URL(specifier));
      const relativePath = relative(ROOT, localPath);
      return relativePath.startsWith("..") ? undefined : normalize(relativePath);
    } catch {
      return undefined;
    }
  }

  if (baseModulePath && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const resolved = normalize(join(dirname(baseModulePath), specifier));
    return resolved.startsWith("..") ? undefined : resolved;
  }

  if (specifier.startsWith("/")) {
    const resolved = normalize(specifier.replace(/^\/+/, ""));
    return resolved.startsWith("..") ? undefined : resolved;
  }

  return undefined;
}

export function resolveAliasPath(specifier: string, aliasMap: Record<string, string>): string | undefined {
  const sortedAliases = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    const mappedPath = aliasMap[alias];
    if (specifier === alias) {
      if (!isRepoRelativeSpecifier(mappedPath)) {
        return undefined;
      }
      return isModuleFileTarget(mappedPath) ? normalize(mappedPath) : normalize(join(mappedPath, "mod.ts"));
    }
    if (specifier.startsWith(`${alias}/`)) {
      if (!isRepoRelativeSpecifier(mappedPath)) {
        return undefined;
      }
      const remainder = specifier.slice(alias.length + 1);
      return normalize(join(mappedPath, remainder));
    }
  }
  return undefined;
}

function getRuntimeDependencySpecifier(dep: IDenoInfoDependency): string | undefined {
  return dep.code?.specifier;
}

function isRepoRelativeSpecifier(specifier: string): boolean {
  return !/^[a-z]+:/i.test(specifier) && !specifier.startsWith("//");
}

function isModuleFileTarget(path: string): boolean {
  return extname(path) !== "";
}

export function renderTextReport(entrypoint: string, graph: IPackageGraph): string {
  const lines = [
    `Package dependency graph for '${entrypoint}':`,
    "",
    "Packages:",
  ];

  for (const pkg of graph.packages) {
    lines.push(`- ${pkg.name}`);
    lines.push(`  modules: ${pkg.modules.length}`);
    if (pkg.outgoing.length > 0) {
      lines.push(`  depends on: ${pkg.outgoing.join(", ")}`);
    }
    if (pkg.incoming.length > 0) {
      lines.push(`  depended on by: ${pkg.incoming.join(", ")}`);
    }
    lines.push("");
  }

  if (graph.edges.length > 0) {
    lines.push("Package edges:");
    for (const edge of graph.edges) {
      lines.push(`- ${edge.from} -> ${edge.to}`);
    }
    lines.push("");
  }

  if (graph.externalPackages.length > 0) {
    lines.push("External dependencies:");
    for (const external of graph.externalPackages) {
      lines.push(`- ${external}`);
    }
    lines.push("");
  }

  if (graph.candidateReport) {
    lines.push(`Candidate retired src modules for '${graph.candidateReport.targetPackage}':`);
    lines.push(
      `- direct imports by ${graph.candidateReport.targetPackage}: ${graph.candidateReport.directSrcModules.length}`,
    );
    for (const module of graph.candidateReport.directSrcModules) {
      lines.push(`  - ${module}`);
    }
    lines.push(`- transitive retired src dependencies: ${graph.candidateReport.transitiveSrcModules.length}`);
    for (const module of graph.candidateReport.transitiveSrcModules) {
      lines.push(`  - ${module}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderDot(graph: IPackageGraph): string {
  const lines = ["digraph IPackageGraph {", "  rankdir=LR;", "  node [shape=box, style=filled, fillcolor=lightgray];"];
  for (const pkg of graph.packages) {
    lines.push(`  "${pkg.name}";`);
  }
  for (const edge of graph.edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function renderBoundaryReport(report: IBoundaryReport): string {
  const lines: string[] = [
    `Boundary analysis for '${report.targetPath}':`,
    "",
  ];

  function renderGroups(groups: IBoundaryGroup[], label: string, extra?: string[]) {
    lines.push(`${label}:`);
    if (groups.length === 0 && (!extra || extra.length === 0)) {
      lines.push("  (none)");
    } else {
      for (const group of groups) {
        lines.push(`  ${group.packageName} (${group.modules.length})`);
        for (const mod of group.modules) {
          lines.push(`    - ${mod}`);
        }
      }
      if (extra && extra.length > 0) {
        const shown = extra.slice(0, 5);
        lines.push(`  external (${extra.length})`);
        for (const spec of shown) lines.push(`    - ${spec}`);
        if (extra.length > 5) lines.push(`    ... and ${extra.length - 5} more`);
      }
    }
    lines.push("");
  }

  renderGroups(report.directGroups, "Direct dependencies", report.externalDirect);
  renderGroups(report.transitiveGroups, "Transitive dependencies");

  if (report.extractable) {
    lines.push("Verdict: EXTRACTABLE — all dependencies are package-owned or external.");
    lines.push("  This file is a candidate for migration into a dedicated package.");
  } else {
    lines.push(
      `Verdict: NOT extractable — ${report.srcDepsCount} retired src/ module(s) kept this file in the composition layer.`,
    );
    const srcGroups = [
      ...report.directGroups.filter((g) => g.packageName === SRC_DISPLAY_NAME),
      ...report.transitiveGroups.filter((g) => g.packageName === SRC_DISPLAY_NAME),
    ];
    if (srcGroups.length > 0) {
      lines.push("  retired src/ blockers:");
      for (const group of srcGroups) {
        for (const mod of group.modules) lines.push(`    - ${mod}`);
      }
    }
  }

  return lines.join("\n");
}

if (import.meta.main) {
  await main();
}
