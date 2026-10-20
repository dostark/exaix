/**
 * @module PortMigrationHelper
 * @path packages/lint-policy/tests/helpers/port_migration.ts
 * @description Rewrites style-exclude comments to deno-lint-ignore comments and finds leftovers of a ported rule.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [packages/lint-policy/catalog.json, packages/lint-policy/port_tables.json]
 */

import { fromFileUrl } from "@std/path";

const EXCLUDE_PATTERN = /^(\s*)\/\/\s*style-exclude:([A-Z0-9_]+)\s*-\s*(.+)$/;
const HISTORY_PREFIX = "exaix-dev-docs/planning/";
const TEXT_EXTENSIONS = [".ts", ".tsx", ".json", ".md", ".yml", ".yaml", ".sh", ".toml", ".jsonc", ""];
const BARE_ID_BOUNDARY_BEFORE = String.raw`(?<=[\[\`"'])`;
const BARE_ID_BOUNDARY_AFTER = String.raw`(?=[\]\`"'])`;
const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

/** Rewrites each `// style-exclude:CODE - reason` of the given codes to `// deno-lint-ignore <id> -- reason`. */
export function migrateStyleExclude(text: string, codes: readonly string[], pluginRuleId: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = line.match(EXCLUDE_PATTERN);
      if (!match || !codes.includes(match[2])) return line;
      return `${match[1]}// deno-lint-ignore ${pluginRuleId} -- ${match[3]}`;
    })
    .join("\n");
}

/** The `path:line` of every style-exclude comment that carries one of the codes. */
export function findStyleExcludeSites(files: ReadonlyMap<string, string>, codes: readonly string[]): string[] {
  const sites: string[] = [];
  for (const [path, text] of files) {
    text.split("\n").forEach((line, index) => {
      const match = line.match(EXCLUDE_PATTERN);
      if (match && codes.includes(match[2])) sites.push(`${path}:${index + 1}`);
    });
  }
  return sites;
}

/** The `path:line` of every mention of the bare rule id inside brackets, backticks, or quotes, once per mention. */
export function findBareIdReferences(files: ReadonlyMap<string, string>, bareId: string): string[] {
  const escaped = bareId.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = new RegExp(`${BARE_ID_BOUNDARY_BEFORE}${escaped}${BARE_ID_BOUNDARY_AFTER}`, "g");
  const references: string[] = [];
  for (const [path, text] of files) {
    text.split("\n").forEach((line, index) => {
      for (const _match of line.matchAll(pattern)) references.push(`${path}:${index + 1}`);
    });
  }
  return references;
}

/** Reads the tracked text files of the repository and its submodules, minus planning documents and the exempt prefixes. */
export async function trackedTextFiles(exemptPrefixes: readonly string[]): Promise<Map<string, string>> {
  const listing = await new Deno.Command("git", {
    args: ["ls-files", "-z", "--recurse-submodules"],
    cwd: REPO_ROOT,
    stdout: "piped",
  }).output();
  const paths = new TextDecoder().decode(listing.stdout).split("\0").filter((path) => path.length > 0);
  const files = new Map<string, string>();
  for (const path of paths) {
    const skipped = path.startsWith(HISTORY_PREFIX) || exemptPrefixes.some((prefix) => path.startsWith(prefix));
    if (skipped || !TEXT_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    try {
      files.set(path, await Deno.readTextFile(`${REPO_ROOT}${path}`));
    } catch {
      continue;
    }
  }
  return files;
}
