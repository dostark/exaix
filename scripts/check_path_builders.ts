#!/usr/bin/env -S deno run -A
/**
 * @module CheckPathBuilders
 * @path scripts/check_path_builders.ts
 * @description Reports callers that build an Exaix workspace path on their own, either by joining
 *   a default segment constant or by spelling a root segment in a literal, instead of using a
 *   helper from `@exaix/shared`.
 *
 *   Usage: deno task check:path-builders
 * @architectural-layer Script
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/shared/src/paths.ts, CODE_STYLE.md]
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
} from "@exaix/shared";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const ROOTS = ["packages", "apps", "exaix-team", "tests"];
/** The default each `[paths]` key resolves to when a config omits it. */
const PATH_DEFAULTS: Record<string, string> = {
  workspace: DEFAULT_WORKSPACE_PATH,
  runtime: DEFAULT_RUNTIME_PATH,
  memory: DEFAULT_MEMORY_PATH,
  portals: DEFAULT_PORTALS_PATH,
  blueprints: DEFAULT_BLUEPRINTS_PATH,
  active: DEFAULT_ACTIVE_PATH,
  archive: DEFAULT_ARCHIVE_PATH,
  plans: DEFAULT_PLANS_PATH,
  requests: DEFAULT_REQUESTS_PATH,
  rejected: DEFAULT_REJECTED_PATH,
  agents: DEFAULT_AGENTS_PATH,
  flows: DEFAULT_FLOWS_DIR,
  memoryProjects: DEFAULT_MEMORY_PROJECTS_DIR,
  memoryExecution: DEFAULT_MEMORY_EXECUTION_DIR,
  memoryIndex: DEFAULT_MEMORY_INDEX_DIR,
  memorySkills: DEFAULT_MEMORY_SKILLS_DIR,
  memoryPending: DEFAULT_MEMORY_PENDING_DIR,
  memoryTasks: DEFAULT_MEMORY_TASKS_DIR,
  memoryGlobal: DEFAULT_MEMORY_GLOBAL_DIR,
};
const TOML_ENTRY = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/;
const PATH_CONSTANT = /^DEFAULT_[A-Z0-9_]*_PATH$/;
const JOIN_CALLS = new Set(["join", "resolve", "normalize", "relative"]);
const EXCLUDE_MARKER = "path-builder-exclude";
/** The root segments that the helpers own. A literal run must start with one of them. */
const ROOT_SEGMENTS = new Set(["Workspace", ".exa", "Memory", "Portals", "Blueprints"]);
/** A path run anchored by a separator or by the end of a template interpolation. */
const RAW_RUN = /[/}]([A-Za-z.][A-Za-z0-9._]*(?:\/[A-Za-z.][A-Za-z0-9._]*)*)/g;
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

/** Blueprint subdirectories that no memory constant owns, so a literal may name them. */
const BLUEPRINTS_SUBDIRS = new Set(["Skills"]);

/**
 * True when the literal starts a root segment run that the helpers own, such as `/Portals/...`
 * or `}/Memory/...`. Prose, shell commands, and glob patterns are left alone.
 */
function rawRunStart(run: string): string | null {
  const segments = run.split("/");
  const first = segments[0];
  if (!ROOT_SEGMENTS.has(first)) return null;
  if (first === "Blueprints" && BLUEPRINTS_SUBDIRS.has(segments[1])) return null;
  return first;
}

function scanFile(repoPath: string, text: string): IViolation[] {
  const source = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const violations: IViolation[] = [];
  const add = (node: ts.Node, detail: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    if (lines[line].includes(EXCLUDE_MARKER)) return;
    if (line > 0 && lines[line - 1].includes(EXCLUDE_MARKER)) return;
    violations.push({ file: repoPath, line: line + 1, detail });
  };
  const scanRaw = (node: ts.Node, raw: string): void => {
    for (const match of raw.matchAll(RAW_RUN)) {
      const start = rawRunStart(match[1]);
      if (start) add(node, `literal run "/${match[1]}"`);
    }
  };
  const visit = (node: ts.Node): void => {
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
      if (!isSpecifier && !/\s/.test(node.text)) scanRaw(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        const raw = span.literal.getText(source);
        if (!/\s/.test(raw)) scanRaw(span.literal, raw);
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!/\s/.test(node.text)) scanRaw(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** A `[paths]` entry that restates the schema default, so the layout has a second owner. */
function scanToml(repoPath: string, text: string): IViolation[] {
  const violations: IViolation[] = [];
  const lines = text.split("\n");
  let inPaths = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) {
      inPaths = line.trim() === "[paths]";
      continue;
    }
    if (!inPaths || line.trim().startsWith("#")) continue;
    const match = TOML_ENTRY.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (PATH_DEFAULTS[key] !== value) continue;
    violations.push({
      file: repoPath,
      line: index + 1,
      detail: `${key} = "${value}" restates the default`,
    });
  }
  return violations;
}

/** Every violation in the repository. */
export async function findPathBuilderViolations(): Promise<IViolation[]> {
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
      `\nBuild the path with the matching helper from @exaix/shared (see CODE_STYLE.md#exaix-path-construction).`,
    );
    Deno.exit(1);
  }
}
