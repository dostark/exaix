#!/usr/bin/env -S deno run -A
/**
 * @module CompareUnusedExports
 * @path scripts/compare_unused_exports.ts
 * @description Compares fallow's dead-export report with the unslop-ts parity report.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [unslop-ts/src/cli/whole_tree.ts]
 *
 * Usage:
 *   deno run -A scripts/compare_unused_exports.ts
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";

const ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const RAISE_SAMPLE = 12;

/** One reported unused name. */
interface IUnusedName {
  readonly name: string;
  readonly path: string;
}

/** Names fallow reports in its JSON output. */
function parseFallow(raw: string): IUnusedName[] {
  // SAFETY: fallow emits this documented JSON shape and every field read below is optional and narrowed.
  const data = JSON.parse(raw) as {
    unused_exports?: Array<{ export_name: string; path: string }>;
    unused_types?: Array<{ export_name: string; path: string }>;
  };
  return [...(data.unused_exports ?? []), ...(data.unused_types ?? [])].map((entry) => ({
    name: entry.export_name,
    path: entry.path,
  }));
}

/** Names the unslop parity report prints. */
function parseUnslop(raw: string): IUnusedName[] {
  const names: IUnusedName[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/\[unwired-export\] ([^:]+):(\d+) – '([^']+)'/);
    if (match) names.push({ name: match[3], path: match[1] });
  }
  return names;
}

/** The three name sets of a comparison. */
interface IComparison {
  readonly shared: string[];
  readonly fallowOnly: IUnusedName[];
  readonly unslopOnly: IUnusedName[];
}

/** Compare two reports by exported name. */
function compare(fallow: readonly IUnusedName[], unslop: readonly IUnusedName[]): IComparison {
  const fallowNames = new Set(fallow.map((entry) => entry.name));
  const unslopNames = new Set(unslop.map((entry) => entry.name));
  return {
    shared: [...unslopNames].filter((name) => fallowNames.has(name)).sort(),
    fallowOnly: fallow.filter((entry) => !unslopNames.has(entry.name)),
    unslopOnly: unslop.filter((entry) => !fallowNames.has(entry.name)),
  };
}

/** Count the importing files of each name, by scope. */
function importerScopes(files: readonly string[]): Map<string, Set<string>> {
  const scopes = new Map<string, Set<string>>();
  const add = (name: string, scope: string): void => {
    const entry = scopes.get(name) ?? new Set<string>();
    entry.add(scope);
    scopes.set(name, entry);
  };
  for (const file of files) {
    const text = Deno.readTextFileSync(join(ROOT, file));
    const scope = file.includes("/tests/") || file.endsWith("_test.ts")
      ? "tests"
      : file.startsWith("scripts/")
      ? "scripts"
      : "production";
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim();
        if (name.length > 0) add(name, scope);
      }
    }
    for (const match of text.matchAll(/import\s+\*\s+as\s+(\w+)\s+from/g)) {
      const namespace = match[1];
      for (const member of text.matchAll(new RegExp(`\\b${namespace}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
        add(member[1], scope);
      }
    }
    for (const match of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s*:\s*/)[0].trim();
        if (name.length > 0) add(name, scope);
      }
    }
  }
  return scopes;
}

function directoryOf(path: string): string {
  return path.split("/").slice(0, 2).join("/");
}

function ranked(entries: readonly IUnusedName[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const dir = directoryOf(entry.path);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function walkTs(dir: string, files: string[]): void {
  for (const item of Deno.readDirSync(dir)) {
    if (item.name === ".git" || item.name === "node_modules" || item.name === "exaix-dev-docs") continue;
    const full = join(dir, item.name);
    if (item.isDirectory) walkTs(full, files);
    else if (item.name.endsWith(".ts")) files.push(relative(ROOT, full));
  }
}

async function output(command: string, args: readonly string[], env: Record<string, string> = {}): Promise<string> {
  const result = await new Deno.Command(command, {
    args: [...args],
    cwd: ROOT,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(result.stdout);
}

async function main(): Promise<void> {
  const fallowRaw = await output("npx", [
    "fallow",
    "dead-code",
    "--unused-exports",
    "--unused-types",
    "--format",
    "json",
  ], {
    FALLOW_SKIP_BINARY_VERIFY: "1",
  });
  const unslopRaw = await output("deno", [
    "run",
    "-A",
    "unslop-ts/src/cli/whole_tree.ts",
    "--descriptor=packages/lint-policy/unslop.project.ts",
    "--rule=unused-exports",
    "--parity",
  ]);
  const fallow = parseFallow(fallowRaw);
  const unslop = parseUnslop(unslopRaw);
  const result = compare(fallow, unslop);
  const files: string[] = [];
  walkTs(ROOT, files);
  const scopes = importerScopes(files);
  const missing: IUnusedName[] = [];
  const imported: IUnusedName[] = [];
  for (const entry of result.fallowOnly) {
    const scope = scopes.get(entry.name);
    if (scope === undefined || scope.size === 0) missing.push(entry);
    else imported.push(entry);
  }
  console.log(`fallow: ${fallow.length} · unslop parity: ${unslop.length} · shared: ${result.shared.length}`);
  console.log(
    `fallow-only: ${result.fallowOnly.length} (imported somewhere: ${imported.length}, no importer: ${missing.length})`,
  );
  console.log(`unslop-only: ${result.unslopOnly.length}`);
  console.log("\nfallow-only without any importer (candidate misses):");
  for (const entry of missing.slice(0, RAISE_SAMPLE)) console.log(`  ${entry.path} ${entry.name}`);
  console.log("\nunslop-only by directory:");
  for (const [dir, count] of ranked(result.unslopOnly).slice(0, 10)) console.log(`  ${dir}: ${count}`);
}

if (import.meta.main) await main();
