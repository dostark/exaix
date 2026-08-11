/**
 * @module TypeScriptApiSurfaceTest
 * @path tests/scripts/typescript_api_surface_test.ts
 * @description Phase 165 (P4): freezes the legacy TypeScript compiler-API surface consumed by
 * the five gate scripts. (a) a functional createSourceFile + forEachChild walk proves the API
 * still behaves; (b) an allowlist guard scans the consumers for ts.<ident> usages and fails on
 * any identifier outside the recorded 51-token surface, so API expansion is a reviewed event
 * (see exaix-dev-docs/dev/TypeScript7_Migration.md for the migration paths).
 */

import ts from "typescript";

const CONSUMER_FILES = [
  "scripts/check_optional_params.ts",
  "scripts/check_code_style.ts",
  "scripts/check_magic_values.ts",
  "scripts/check_unused_exports.ts",
  "tests/scripts/check_optional_params_bare_optional_test.ts",
] as const;

const TS_API_ALLOWLIST = [
  "ExportDeclaration",
  "FunctionBody",
  "Modifier",
  "NamedExports",
  "Node",
  "NumericLiteral",
  "ParameterDeclaration",
  "ScriptTarget",
  "SourceFile",
  "StringLiteral",
  "SyntaxKind",
  "createSourceFile",
  "forEachChild",
  "isArrayLiteralExpression",
  "isArrowFunction",
  "isBlock",
  "isCallExpression",
  "isClassDeclaration",
  "isConstructorDeclaration",
  "isDecorator",
  "isElementAccessExpression",
  "isEnumDeclaration",
  "isEnumMember",
  "isExportAssignment",
  "isExportDeclaration",
  "isFunctionDeclaration",
  "isFunctionExpression",
  "isIdentifier",
  "isImportDeclaration",
  "isIndexedAccessTypeNode",
  "isInterfaceDeclaration",
  "isJsxAttribute",
  "isLiteralTypeNode",
  "isMethodDeclaration",
  "isModuleDeclaration",
  "isNamedExports",
  "isNamedImports",
  "isNamespaceImport",
  "isNewExpression",
  "isNumericLiteral",
  "isParameter",
  "isPropertyAccessExpression",
  "isPropertyAssignment",
  "isShorthandPropertyAssignment",
  "isStringLiteral",
  "isTemplateLiteralToken",
  "isTypeAliasDeclaration",
  "isTypeReferenceNode",
  "isUnionTypeNode",
  "isVariableDeclaration",
  "isVariableStatement",
] as const;

const allowlist = new Set<string>(TS_API_ALLOWLIST);

function walkKinds(node: ts.Node, kinds: string[]): void {
  kinds.push(ts.SyntaxKind[node.kind]);
  ts.forEachChild(node, (child) => walkKinds(child, kinds));
}

Deno.test("P4: createSourceFile + forEachChild walk works on the legacy API", () => {
  const source = ts.createSourceFile(
    "sample.ts",
    "function alpha(x: number): number {\n  if (x > 0) return x;\n  return x;\n}",
    ts.ScriptTarget.Latest,
    true,
  );
  const kinds: string[] = [];
  walkKinds(source, kinds);
  for (const expected of ["SourceFile", "FunctionDeclaration", "IfStatement", "Identifier"]) {
    if (!kinds.includes(expected)) {
      throw new Error(`expected ${expected} in walk, got kinds: ${kinds.join(",")}`);
    }
  }
  if (kinds.length < 10) {
    throw new Error(`walk produced unexpectedly few nodes: ${kinds.length}`);
  }
});

Deno.test("P4: gate scripts use only the recorded ts.<ident> API surface", () => {
  const root = new URL("../..", import.meta.url);
  const pattern = /(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const violations: string[] = [];

  for (const rel of CONSUMER_FILES) {
    const content = Deno.readTextFileSync(new URL(rel, root));
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].trimStart();
      if (stripped.startsWith("//") || stripped.startsWith("*")) continue;
      pattern.lastIndex = 0;
      for (const match of lines[i].matchAll(pattern)) {
        const ident = match[1];
        if (!allowlist.has(ident)) {
          violations.push(`${rel}:${i + 1} — ts.${ident}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `ts.<ident> usages outside the recorded API surface (${allowlist.size} identifiers):\n` +
        violations.join("\n") +
        `\nRecorded surface lives in tests/scripts/typescript_api_surface_test.ts; expanding it is a ` +
        `reviewed event — see exaix-dev-docs/dev/TypeScript7_Migration.md.`,
    );
  }
});
