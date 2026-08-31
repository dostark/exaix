/**
 * @module TypeScriptApiSurfaceTest
 * @path tests/scripts/typescript_api_surface_test.ts
 * @description Phase 165 (P4): freezes the legacy TypeScript compiler-API surface consumed by
 * the five gate scripts. (a) a functional createSourceFile + forEachChild walk proves the API
 * still behaves; (b) an allowlist guard scans the consumers for ts.<ident> usages and fails on
 * any identifier outside the recorded 51-token surface, so API expansion is a reviewed event
 * (see exaix-dev-docs/dev/TypeScript7_Migration.md for the migration paths).
 * NOTE: the (b) scan is a heuristic tripwire — it matches dotted access on the literal `ts`
 * identifier only; bracket access (ts["x"]), destructuring (const { x } = ts), or alias
 * renames (import tsc from "typescript") bypass it. Genuine coverage is enforced by the (a)
 * functional walk plus code review, not by this scan alone.
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

// Data members of the `ts` namespace are not API surface — reading them
// (e.g. ts.version) must not force an API-allowlist expansion.
const TS_DATA_MEMBERS = ["version"] as const;
const dataMembers = new Set<string>(TS_DATA_MEMBERS);

function walkKinds(node: ts.Node, kinds: string[]): void {
  kinds.push(ts.SyntaxKind[node.kind]);
  ts.forEachChild(node, (child) => walkKinds(child, kinds));
}

// Blanks out comments (line + block), string literals, and template literals while preserving
// newlines, so ts.<ident> scanning never flags tokens inside comments or strings. Returns the
// same line count as the input.
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      if (ch === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
        out += " ";
        i++;
        continue;
      }
      out += " ";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += " ";
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

Deno.test("P4: comment and string ts.<ident> references produce no violations", () => {
  const content = [
    "const x = 1; // ts.version is data, not API",
    'const msg = "ts.createSourceFile should not flag";',
    "const tpl = `ts.${name}`;",
    "/* block start: ts.forEachChild documented in the runbook",
    " * continuation line: ts.Node mentioned in docs",
    " */",
    "const y = 2; /* trailing block: ts.SyntaxKind */",
    "const ok = ts.createSourceFile;",
  ].join("\n");
  const stripped = stripCommentsAndStrings(content);
  const usages = [...stripped.matchAll(/(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1]);
  for (const u of usages) {
    if (!allowlist.has(u) && !dataMembers.has(u)) {
      throw new Error(`comment/string ts.${u} flagged as API usage`);
    }
  }
  if (!usages.includes("createSourceFile")) {
    throw new Error("real ts.createSourceFile usage was stripped by the scanner");
  }
});

Deno.test("P4: a ts.version data reference in a consumer is exempt", () => {
  const line = "const version = ts.version;";
  const stripped = stripCommentsAndStrings(line);
  const usages = [...stripped.matchAll(/(?<![A-Za-z0-9_$])ts\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1]);
  for (const u of usages) {
    if (!allowlist.has(u) && !dataMembers.has(u)) {
      throw new Error(`data member ts.${u} flagged as API usage in: ${line}`);
    }
  }
});

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
    const content = stripCommentsAndStrings(
      Deno.readTextFileSync(new URL(rel, root)),
    );
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      for (const match of lines[i].matchAll(pattern)) {
        const ident = match[1];
        if (!allowlist.has(ident) && !dataMembers.has(ident)) {
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
