#!/usr/bin/env -S deno run -A
/**
 * @module CheckPathBuilders
 * @path scripts/check_path_builders.ts
 * @description Reports a module that owns the Exaix workspace layout instead of the shared
 *   helpers. It covers four shapes: a join of a default constant, a root segment spelled in a
 *   literal, a config entry that restates a default, and a `paths.<key>` assignment that does.
 *
 *   Usage: deno task check:path-builders
 * @architectural-layer Script
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/shared/src/paths.ts, docs/CODE_STYLE.md]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_FLOWS_DIR,
  DEFAULT_MEMORY_EXECUTION_DIR,
  DEFAULT_MEMORY_GLOBAL_DIR,
  DEFAULT_MEMORY_INDEX_DIR,
  DEFAULT_MEMORY_PATH,
  DEFAULT_MEMORY_PENDING_DIR,
  DEFAULT_MEMORY_PROJECTS_DIR,
  DEFAULT_MEMORY_SKILLS_DIR,
  DEFAULT_MEMORY_TASKS_DIR,
  DEFAULT_PLANS_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_WORKSPACE_PATH,
  ExaPathDefaults,
} from "@exaix/shared";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const ROOTS = ["packages", "apps", "exaix-team", "tests"];
const PATH_CONSTANT = /^DEFAULT_[A-Z0-9_]*_PATH$/;
const JOIN_CALLS = new Set(["join", "resolve", "normalize", "relative"]);
const EXCLUDE_MARKER = "path-builder-exclude";
/** The root segments that the helpers own. A literal run must start with one of them. */
const ROOT_SEGMENTS = new Set(["Workspace", ".exa", "Memory", "Portals", "Blueprints"]);
/** Blueprint subdirectories that no memory constant owns, so a literal may name them. */
const BLUEPRINTS_SUBDIRS = new Set(["Skills"]);
/** A path run anchored by a separator or by the end of a template interpolation. */
const RAW_RUN = /[/}]([A-Za-z.][A-Za-z0-9._]*(?:\/[A-Za-z.][A-Za-z0-9._]*)*)/g;
/** The default each `[paths]` key resolves to when a config omits it. */
const PATH_DEFAULTS: Record<string, string> = ExaPathDefaults;
/** The shared constants that a test may interpolate into a config value. */
const PLACEHOLDERS: Record<string, string> = {
  DEFAULT_WORKSPACE_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_ACTIVE_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_PLANS_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_FLOWS_DIR,
  DEFAULT_MEMORY_PROJECTS_DIR,
  DEFAULT_MEMORY_EXECUTION_DIR,
  DEFAULT_MEMORY_INDEX_DIR,
  DEFAULT_MEMORY_SKILLS_DIR,
  DEFAULT_MEMORY_PENDING_DIR,
  DEFAULT_MEMORY_TASKS_DIR,
  DEFAULT_MEMORY_GLOBAL_DIR,
};
const TOML_ENTRY = /^\s*(\w+)\s*=\s*(.+?)\s*$/;
const TOML_PATHS_HEADER = /^\s*\[paths\]\s*$/;
/** A TOML section header, which marks a config document. */
const TOML_DOCUMENT = /^\[(?:system|paths)\]$/;
const TOML_SECTION = /^\s*\[[^\]]+\]\s*$/;
const PATHS_ASSIGNMENT = /\.paths\.(\w+)\s*=\s*"([^"]*)"/;
/** A `paths.<key> ?? "<default>"` fallback, which the schema default already covers. */
const PATHS_FALLBACK = /\.paths\.(\w+)\s*(?:\?\?|\|\|)\s*"([^"]*)"/;
/** The helper module and the tables that legitimately compose the defaults. */
const DEFINITION_SITES = [
  "packages/shared/src/paths.ts",
  "packages/shared/src/constants.ts",
];

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

/** The called name for an identifier or a property access, or null. */
function calleeName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function isPathConstant(node: ts.Expression): string | null {
  return ts.isIdentifier(node) && PATH_CONSTANT.test(node.text) ? node.text : null;
}

/** True when the literal starts a root segment run, such as `/Portals/...` or `}/Memory/...`. */
function rawRunStart(run: string): string | null {
  const segments = run.split("/");
  const first = segments[0];
  if (!ROOT_SEGMENTS.has(first)) return null;
  if (first === "Blueprints" && BLUEPRINTS_SUBDIRS.has(segments[1])) return null;
  return first;
}

/** The literal value of a config entry, or null when it holds an unknown interpolation. */
function entryValue(raw: string): string | null {
  const quoted = raw.match(/^"([^"]*)"$/);
  const value = quoted ? quoted[1] : raw.replace(/^"/, "").replace(/"$/, "");
  if (!value.includes("${")) return value;
  let resolved = value;
  for (const [name, replacement] of Object.entries(PLACEHOLDERS)) {
    resolved = resolved.replaceAll("${" + name + "}", replacement);
  }
  resolved = resolved.replace(
    /\$\{JSON\.stringify\(ExaPathDefaults\.(\w+)\)\}/g,
    (_m, key) => PATH_DEFAULTS[key] ?? _m,
  );
  resolved = resolved.replace(/\$\{ExaPathDefaults\.(\w+)\}/g, (_m, key) => PATH_DEFAULTS[key] ?? _m);
  return resolved.includes("${") ? null : resolved;
}

/** True when a `[paths]` value repeats the default that the schema would apply anyway. */
function restatesDefault(key: string, raw: string): boolean {
  const value = entryValue(raw);
  if (value === null) return false;
  const direct = PATH_DEFAULTS[key];
  if (direct === undefined) return false;
  return direct === value || (value.startsWith("./") && direct === value.slice(2));
}

/** A `[paths]` block inside a string or template literal, which repeats the schema defaults. */
function scanEmbeddedToml(node: ts.Node, raw: string, add: AddFn): void {
  const lines = raw.split(/\\n|\n/);
  let inPaths = false;
  for (const line of lines) {
    if (TOML_SECTION.test(line)) {
      inPaths = TOML_PATHS_HEADER.test(line);
      continue;
    }
    if (!inPaths || line.trim().startsWith("#")) continue;
    const match = TOML_ENTRY.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!restatesDefault(key, value)) continue;
    add(node, `embedded ${key} = ${value} restates the default`);
  }
}

type AddFn = (node: ts.Node, detail: string, lineOffset?: number) => void;

function scanFile(repoPath: string, text: string): IViolation[] {
  const source = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const violations: IViolation[] = [];
  const add: AddFn = (node, detail, lineOffset = 0): void => {
    const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const line = startLine + lineOffset + 1;
    if (lines[line - 1]?.includes(EXCLUDE_MARKER)) return;
    if (line > 1 && lines[line - 2]?.includes(EXCLUDE_MARKER)) return;
    violations.push({ file: repoPath, line, detail });
  };
  const scanRaw = (node: ts.Node, raw: string): void => {
    for (const match of raw.matchAll(RAW_RUN)) {
      // `$WORKSPACE_ROOT` is the run's own anchor, so a token after it is not a new owner.
      if (raw.slice(0, match.index).endsWith("$WORKSPACE_ROOT")) continue;
      const start = rawRunStart(match[1]);
      if (start) add(node, `literal run "/${match[1]}"`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "paths" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (!ts.isIdentifier(property.initializer) || !property.initializer.text.startsWith("DEFAULT_")) continue;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : "?";
        add(property, `paths.${key} re-spells the default table. Spread ExaPathDefaults instead.`);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && JOIN_CALLS.has(name)) {
        for (const argument of node.arguments) {
          const constant = isPathConstant(argument);
          if (constant) add(node, `${name}(..., ${constant}, ...)`);
        }
      }
    } else if (ts.isStringLiteral(node)) {
      const parent = node.parent;
      const isSpecifier = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
        parent.moduleSpecifier === node;
      if (!isSpecifier && !/\s/.test(node.text)) {
        scanRaw(node, node.text);
        scanEmbeddedToml(node, node.getText(source).slice(1, -1), add);
      }
    } else if (ts.isTemplateExpression(node)) {
      scanEmbeddedToml(node, node.getText(source).slice(1, -1), add);
      for (const span of node.templateSpans) {
        const raw = span.literal.getText(source);
        if (!/\s/.test(raw)) scanRaw(span.literal, raw);
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!/\s/.test(node.text)) scanRaw(node, node.text);
      scanEmbeddedToml(node, node.text, add);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (let index = 0; index < lines.length; index++) {
    const match = PATHS_ASSIGNMENT.exec(lines[index]);
    if (match && restatesDefault(match[1], `"${match[2]}"`)) {
      if (!lines[index].includes(EXCLUDE_MARKER)) {
        violations.push({
          file: repoPath,
          line: index + 1,
          detail: `paths.${match[1]} = "${match[2]}" restates the default`,
        });
      }
    }
    const fallback = PATHS_FALLBACK.exec(lines[index]);
    if (fallback && restatesDefault(fallback[1], `"${fallback[2]}"`)) {
      if (!lines[index].includes(EXCLUDE_MARKER)) {
        violations.push({
          file: repoPath,
          line: index + 1,
          detail: `paths.${fallback[1]} ?? "${
            fallback[2]
          }" repeats the default, so the schema default owns it and the fallback is dead`,
        });
      }
    }
  }
  return violations;
}

/** A `[paths]` entry in a shipped config that restates the schema default. */
function scanToml(repoPath: string, text: string): IViolation[] {
  const violations: IViolation[] = [];
  const lines = text.split("\n");
  let inPaths = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (TOML_SECTION.test(line)) {
      inPaths = TOML_PATHS_HEADER.test(line);
      continue;
    }
    if (!inPaths || line.trim().startsWith("#")) continue;
    const match = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!restatesDefault(key, `"${value}"`)) continue;
    violations.push({ file: repoPath, line: index + 1, detail: `${key} = "${value}" restates the default` });
  }
  return violations;
}

/** A scenario step that embeds a config document, which a `content_from` fixture replaces. */
function scanScenarioYaml(repoPath: string, text: string): IViolation[] {
  const violations = scanToml(repoPath, text);
  const lines = text.split("\n");
  const content = /^(\s*)content:\s*\|\s*$/;
  for (let index = 0; index < lines.length; index++) {
    const match = content.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    let cursor = index + 1;
    let holdsConfig = false;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() !== "" && line.length - line.trimStart().length <= indent) break;
      if (TOML_DOCUMENT.test(line.trim())) holdsConfig = true;
      cursor++;
    }
    if (!holdsConfig) continue;
    violations.push({
      file: repoPath,
      line: index + 1,
      detail: "embeds a config document. Name a fixture with content_from instead.",
    });
  }
  return violations;
}

/** Every violation in the repository. */
async function findPathBuilderViolations(): Promise<IViolation[]> {
  const violations: IViolation[] = [];
  for (const root of ROOTS) {
    for await (
      const entry of walk(join(REPO_ROOT, root), {
        includeDirs: false,
        exts: [".ts", ".tsx"],
        skip: [/[/\\]node_modules[/\\]/, /[/\\]\.git[/\\]/, /[/\\]coverage[/\\]/, /[/\\]dist[/\\]/],
      })
    ) {
      const repoPath = relative(REPO_ROOT, entry.path);
      const text = await Deno.readTextFile(entry.path);
      if (DEFINITION_SITES.includes(repoPath) || /export const ExaPathDefaults\b/.test(text)) continue;
      violations.push(...scanFile(repoPath, text));
    }
  }
  for await (
    const entry of walk(join(REPO_ROOT, "configs"), {
      includeDirs: false,
      exts: [".toml"],
      skip: [/[/\\]node_modules[/\\]/],
    })
  ) {
    const repoPath = relative(REPO_ROOT, entry.path);
    violations.push(...scanToml(repoPath, await Deno.readTextFile(entry.path)));
  }
  for await (
    const entry of walk(join(REPO_ROOT, "tests"), {
      includeDirs: false,
      exts: [".yaml", ".yml"],
      skip: [/[/\\]node_modules[/\\]/],
    })
  ) {
    const repoPath = relative(REPO_ROOT, entry.path);
    violations.push(...scanScenarioYaml(repoPath, await Deno.readTextFile(entry.path)));
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (import.meta.main) {
  const violations = await findPathBuilderViolations();
  if (violations.length === 0) {
    console.log("✅ No module builds an Exaix workspace path on its own.");
  } else {
    console.error(`❌ ${violations.length} path-builder violation(s) — use the @exaix/shared helpers:\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.detail}`);
    }
    console.error(
      `\nBuild the path with the matching helper from @exaix/shared (see docs/CODE_STYLE.md#exaix-path-construction).`,
    );
    Deno.exit(1);
  }
}
