#!/usr/bin/env -S deno run -A
/**
 * @module PackageDependencyGraph
 * @path scripts/package_dependency_graph.ts
 * @description Builds a package-level dependency graph from `deno info --json`.
 *
 * Usage:
 *   deno run -A scripts/package_dependency_graph.ts
 *   deno run -A scripts/package_dependency_graph.ts --entrypoint src/main.ts --format dot
 */

import { parse } from "@std/flags";
import { dirname, fromFileUrl, join, normalize, relative } from "@std/path";

const ROOT = Deno.cwd();
const DEFAULT_ENTRYPOINT = "src/main.ts";
const DEFAULT_FORMAT = "text" as const;

export interface DenoInfoDependency {
  specifier: string;
  code?: {
    specifier: string;
  };
}

export interface DenoInfoModule {
  specifier: string;
  local?: string;
  dependencies?: DenoInfoDependency[];
}

export interface DenoInfoJson {
  version: number;
  roots: string[];
  modules: DenoInfoModule[];
}

export interface PackageInfo {
  root: string;
  name: string;
  modules: string[];
  outgoing: string[];
  incoming: string[];
}

export interface CandidateReport {
  targetPackage: string;
  targetRoot: string;
  directSrcModules: string[];
  transitiveSrcModules: string[];
  allSrcModules: string[];
}

export interface PackageGraph {
  packages: PackageInfo[];
  edges: Array<{ from: string; to: string }>;
  externalPackages: string[];
  candidateReport?: CandidateReport;
}

export interface PackageGraphOptions {
  importAliases?: Record<string, string>;
}

export async function main() {
  const args = parse(Deno.args, {
    string: ["entrypoint", "format", "candidatePackage"],
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
  const format = String(args.format || DEFAULT_FORMAT) as "text" | "json" | "dot";
  const candidatePackage = typeof args.candidatePackage === "string"
    ? String(args.candidatePackage)
    : typeof args["candidate-package"] === "string"
    ? String(args["candidate-package"])
    : undefined;

  const info = await runDenoInfo(entrypoint);
  const packageDiscovery = await discoverPackageRoots();
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
  --entrypoint <path>  Entry point to analyze (default: src/main.ts)
  --format <text|json|dot>  Output format (default: text)
  --candidate-package <package>  Report src modules that should move into this package
  --help               Show this help message
`);
}

export async function runDenoInfo(entrypoint: string): Promise<DenoInfoJson> {
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
  return JSON.parse(raw) as DenoInfoJson;
}

export interface PackageDiscovery {
  roots: string[];
  importAliases: Record<string, string>;
}

export async function discoverPackageRoots(): Promise<PackageDiscovery> {
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
      const normalizedValue = normalize(value.replace(/\/+$/, ""));
      importAliases[key] = normalizedValue;
    }
  }

  return {
    roots: Array.from(roots).sort((a, b) => a.length - b.length),
    importAliases,
  };
}

export function buildPackageGraph(
  info: DenoInfoJson,
  packageRoots: string[],
  options: PackageGraphOptions = {},
): PackageGraph {
  const localModuleToPackage = new Map<string, string>();
  const packageInfo = new Map<string, PackageInfo>();

  for (const root of packageRoots) {
    packageInfo.set(root, {
      root,
      name: root === "src" ? "@exaix" : root,
      modules: [],
      outgoing: [],
      incoming: [],
    });
  }

  const localModules = info.modules
    .map((module) => ({ module, path: toRepoPath(module.specifier) }))
    .filter((entry): entry is { module: DenoInfoModule; path: string } => entry.path !== undefined);

  for (const { path } of localModules) {
    const pkg = selectPackageRoot(path, packageRoots);
    localModuleToPackage.set(path, pkg);
    const info = packageInfo.get(pkg)!;
    info.modules.push(path);
  }

  const edges = new Set<string>();
  const externalPackages = new Set<string>();

  for (const { module, path } of localModules) {
    const sourcePackage = localModuleToPackage.get(path)!;
    for (const dep of module.dependencies ?? []) {
      const depSpecifier = dep.code?.specifier || dep.specifier;
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

export function selectPackageRoot(path: string, packageRoots: string[]): string {
  let match = "src";
  for (const root of packageRoots) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (root.length > match.length) {
        match = root;
      }
    }
  }
  return match;
}

export function findCandidateSrcModules(
  info: DenoInfoJson,
  packageRoots: string[],
  targetPackage: string,
  options: PackageGraphOptions = {},
): CandidateReport | undefined {
  const targetRoot = targetPackage === "@exaix" ? "src" : packageRoots.find((root) => root === targetPackage);
  if (!targetRoot) {
    return undefined;
  }

  const localModules = info.modules
    .map((module) => ({ module, path: toRepoPath(module.specifier) }))
    .filter((entry): entry is { module: DenoInfoModule; path: string } => entry.path !== undefined);

  const pathToPackage = new Map<string, string>();
  const pathToModule = new Map<string, DenoInfoModule>();
  const reverseDeps = new Map<string, Set<string>>();

  for (const { module, path } of localModules) {
    const pkg = selectPackageRoot(path, packageRoots);
    pathToPackage.set(path, pkg);
    pathToModule.set(path, module);
  }

  for (const { module, path } of localModules) {
    for (const dep of module.dependencies ?? []) {
      const depSpecifier = dep.code?.specifier || dep.specifier;
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
      const depSpecifier = dep.code?.specifier || dep.specifier;
      let depPath = toRepoPath(depSpecifier, path);
      if (!depPath && options.importAliases) {
        depPath = resolveAliasPath(depSpecifier, options.importAliases);
      }
      if (!depPath) {
        depPath = toRepoPath(depSpecifier);
      }
      if (!depPath) continue;

      const depPackage = pathToPackage.get(depPath) ?? selectPackageRoot(depPath, packageRoots);
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
      return normalize(join(mappedPath, "mod.ts"));
    }
    if (specifier.startsWith(`${alias}/`)) {
      const remainder = specifier.slice(alias.length + 1);
      return normalize(join(mappedPath, remainder));
    }
  }
  return undefined;
}

export function renderTextReport(entrypoint: string, graph: PackageGraph): string {
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
    lines.push(`Candidate src modules for '${graph.candidateReport.targetPackage}':`);
    lines.push(
      `- direct imports by ${graph.candidateReport.targetPackage}: ${graph.candidateReport.directSrcModules.length}`,
    );
    for (const module of graph.candidateReport.directSrcModules) {
      lines.push(`  - ${module}`);
    }
    lines.push(`- transitive src dependencies: ${graph.candidateReport.transitiveSrcModules.length}`);
    for (const module of graph.candidateReport.transitiveSrcModules) {
      lines.push(`  - ${module}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderDot(graph: PackageGraph): string {
  const lines = ["digraph PackageGraph {", "  rankdir=LR;", "  node [shape=box, style=filled, fillcolor=lightgray];"];
  for (const pkg of graph.packages) {
    lines.push(`  "${pkg.name}";`);
  }
  for (const edge of graph.edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`);
  }
  lines.push("}");
  return lines.join("\n");
}

if (import.meta.main) {
  await main();
}
