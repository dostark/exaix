/**
 * @module PortMigrationHelper
 * @path packages/lint-policy/tests/helpers/port_migration.ts
 * @description Rewrites style-exclude comments to deno-lint-ignore comments and finds leftovers of a ported rule.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [packages/lint-policy/tests/fixtures/catalog_v1.json, packages/lint-policy/tests/fixtures/port/port_tables.json]
 */

import { fromFileUrl } from "@std/path";

const EXCLUDE_PATTERN = /^(\s*)\/\/\s*style-exclude:([A-Z0-9_]+)\s*-\s*(.+)$/;
const HISTORY_PREFIX = "exaix-dev-docs/planning/";
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".wasm", ".zip", ".DAT", ".pkl"];
const BARE_ID_BOUNDARY_BEFORE = String.raw`(?<=[\[\`"'])`;
const BARE_ID_BOUNDARY_AFTER = String.raw`(?=[\]\`"'])`;
const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

const PORT_REFERENCE_EXEMPTIONS = [
  "packages/lint-policy/tests/fixtures/port/port_tables.json",
  // Documentation assertions name generic engine rule IDs, rather than activating catalog rules.
  "packages/lint-policy/tests/code_style_anchor_test.ts",
  "packages/lint-policy/tests/port_migration_test.ts",
  "packages/lint-policy/tests/generic_rules_ported_test.ts",
  "packages/lint-policy/tests/port_split_table_test.ts",
  "packages/lint-policy/tests/port_scope_test.ts",
  "tests/scripts/lint_plugin_integration_test.ts",
  "packages/lint-policy/tests/helpers/port_migration.ts",
  "packages/lint-policy/tests/fixtures/port/",
  "docs/CHANGELOG.md",
  "unslop-ts/",
  // Whole-tree host ids are the version 2 descriptor contract.
  "packages/lint-policy/unslop.project.ts",
  "packages/lint-policy/src/script_rules.ts",
  "packages/lint-policy/tests/policy_config_test.ts",
  "tests/scripts/lint_policy_move_equivalence_test.ts",
];

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

/** Where the inventory gets its tracked paths and file contents. */
export interface ITrackedFileSource {
  list(): Promise<readonly string[]>;
  read(path: string): Promise<string>;
  /** True for a tracked entry that holds no text: a directory link, or a link with a missing target. */
  isNonFile(path: string): Promise<boolean>;
}

/** The tracked files of the repository and its submodules, from git. A failed listing throws. */
export const GIT_FILE_SOURCE: ITrackedFileSource = {
  async list(): Promise<readonly string[]> {
    const listing = await new Deno.Command("git", {
      args: ["ls-files", "-z", "--recurse-submodules"],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!listing.success) {
      const reason = new TextDecoder().decode(listing.stderr).trim();
      throw new Error(`git ls-files failed with exit code ${listing.code}: ${reason}`);
    }
    return new TextDecoder().decode(listing.stdout).split("\0").filter((path) => path.length > 0);
  },
  read: (path) => Deno.readTextFile(`${REPO_ROOT}${path}`),
  async isNonFile(path): Promise<boolean> {
    const full = `${REPO_ROOT}${path}`;
    try {
      return !(await Deno.stat(full)).isFile;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound && (await Deno.lstat(full)).isSymlink) return true;
      throw error;
    }
  },
};

/**
 * Reads the tracked text files, minus planning documents and the exempt prefixes.
 * A non-file entry, a binary extension, a planning document, and an exempt prefix are skipped on purpose.
 * Any other failure to read an included file, and an empty inventory, throw.
 */
export async function trackedTextFiles(
  exemptPrefixes: readonly string[],
  source: ITrackedFileSource = GIT_FILE_SOURCE,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const path of await source.list()) {
    const skipped = path.startsWith(HISTORY_PREFIX) || exemptPrefixes.some((prefix) => path.startsWith(prefix));
    if (skipped || BINARY_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    try {
      if (await source.isNonFile(path)) continue;
      files.set(path, await source.read(path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`the tracked file ${path} could not be read: ${reason}`);
    }
  }
  if (files.size === 0) throw new Error("the tracked file inventory is empty");
  return files;
}

/** Reads active consumer references, excluding fixtures that name the original rule IDs. */
export async function portReferenceFiles(): Promise<Map<string, string>> {
  const files = await trackedTextFiles(PORT_REFERENCE_EXEMPTIONS);
  return new Map([...files].filter(([path]) => !path.endsWith("_parity_test.ts")));
}
