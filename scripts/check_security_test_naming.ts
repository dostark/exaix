#!/usr/bin/env -S deno run -A
/**
 * @module CheckSecurityTestNaming
 * @path scripts/check_security_test_naming.ts
 * @description Enforces the security-test file convention: every test whose name contains the
 *   `[security]` tag must live in a `*_security_test.ts` file, so `deno task test:security`
 *   selects it with the `tests/**\/*_security_test.ts` glob instead of loading every test module
 *   under `tests/`. A `*_security_test.ts` file must also contain at least one tagged test, so a
 *   misnamed or emptied file fails rather than silently dropping coverage.
 *
 * Usage:
 *   deno run --allow-read scripts/check_security_test_naming.ts
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { Opt, Reason } from "@exaix/core/types";

export interface ISecurityNamingViolation {
  path: string;
  message: string;
}

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const TESTS_ROOT = `${REPO_ROOT}tests`;
const SECURITY_TAG = "[security]";
const SECURITY_SUFFIX = "_security_test.ts";

/** Test-call names whose first string argument (or `name` property) is the test name. */
const TEST_CALLS = new Set(["Deno.test", "Deno.test.only", "Deno.test.ignore", "it", "test"]);

function calleeName(expr: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expr)) {
    const base = calleeName(expr.expression);
    return base === null ? null : `${base}.${expr.name.text}`;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return null;
}

/** The declared test name text, or null when it is not a static string (computed at runtime). */
function staticNameText(node: Opt<ts.Expression, Reason.SensibleDefault>): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  if (ts.isParenthesizedExpression(node)) return staticNameText(node.expression);
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (
        ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "name"
      ) {
        return staticNameText(prop.initializer);
      }
    }
  }
  return null;
}

export function findTestNames(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee !== null && TEST_CALLS.has(callee)) {
        const name = staticNameText(node.arguments[0]);
        if (name !== null) names.push(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

export async function checkSecurityTestNaming(root = TESTS_ROOT): Promise<ISecurityNamingViolation[]> {
  const violations: ISecurityNamingViolation[] = [];
  for await (
    const entry of walk(root, {
      includeDirs: false,
      exts: [".ts"],
    })
  ) {
    if (!entry.name.endsWith("_test.ts")) continue;
    const source = await Deno.readTextFile(entry.path);
    const names = findTestNames(source, entry.name);
    const tagged = names.filter((name) => name.includes(SECURITY_TAG));
    const isSecurityFile = entry.name.endsWith(SECURITY_SUFFIX);
    if (tagged.length > 0 && !isSecurityFile) {
      violations.push({
        path: entry.path,
        message: `${tagged.length} test(s) tagged ${SECURITY_TAG} live outside a ${SECURITY_SUFFIX} file`,
      });
    }
    if (tagged.length === 0 && isSecurityFile) {
      violations.push({
        path: entry.path,
        message: `named ${SECURITY_SUFFIX} but declares no ${SECURITY_TAG} test`,
      });
    }
  }
  return violations.sort((a, b) => a.path.localeCompare(b.path));
}

if (import.meta.main) {
  const violations = await checkSecurityTestNaming();
  if (violations.length > 0) {
    console.error(`❌ Security test naming violations (${violations.length}):`);
    for (const violation of violations) {
      console.error(`  - ${violation.path.replace(REPO_ROOT, "")}: ${violation.message}`);
    }
    console.error(
      `\nMove each tagged test into a sibling ${SECURITY_SUFFIX} file (see .copilot/skills/test-development/SKILL.md).`,
    );
    Deno.exit(1);
  }
  console.log("✅ Security test naming: every [security] test lives in a *_security_test.ts file.");
}
