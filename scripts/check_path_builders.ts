#!/usr/bin/env -S deno run -A
/**
 * @module CheckPathBuilders
 * @path scripts/check_path_builders.ts
 * @description Reports callers that build an Exaix workspace path by joining a default segment
 *   constant themselves, instead of using a helper from `@exaix/shared`.
 *
 *   Usage: deno run -A scripts/check_path_builders.ts
 * @architectural-layer Script
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/shared/src/paths.ts, CODE_STYLE.md]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const ROOTS = ["packages", "apps", "exaix-team", "tests"];
const PATH_CONSTANT = /^DEFAULT_[A-Z0-9_]*_PATH$/;
const JOIN_CALLS = new Set(["join", "resolve", "normalize", "relative"]);
const EXCLUDE_MARKER = "path-builder-exclude";
/** The helper module and the tables that legitimately compose the defaults. */
const DEFINITION_SITES = [
  "packages/shared/src/paths.ts",
  "packages/shared/src/constants.ts",
];

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly call: string;
  readonly constant: string;
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

/** True when the file declares the defaults table or is a helper definition site. */
function isDefinitionSite(repoPath: string, source: string): boolean {
  return DEFINITION_SITES.includes(repoPath) || /export const ExaPathDefaults\b/.test(source);
}

function scanFile(repoPath: string, text: string): IViolation[] {
  const source = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const violations: IViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && JOIN_CALLS.has(name)) {
        for (const argument of node.arguments) {
          const constant = isPathConstant(argument);
          if (!constant) continue;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
          if (lines[line].includes(EXCLUDE_MARKER)) continue;
          violations.push({ file: repoPath, line: line + 1, call: name, constant });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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
      if (isDefinitionSite(repoPath, text)) continue;
      violations.push(...scanFile(repoPath, text));
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (import.meta.main) {
  const violations = await findPathBuilderViolations();
  if (violations.length === 0) {
    console.log("✅ No workspace path is built by joining a default constant.");
  } else {
    console.error(`❌ ${violations.length} path-builder violation(s) — use the @exaix/shared helpers:\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.call}(..., ${violation.constant}, ...)`);
    }
    console.error(
      `\nBuild the path with the matching helper from @exaix/shared (see CODE_STYLE.md#exaix-path-construction).`,
    );
    Deno.exit(1);
  }
}
