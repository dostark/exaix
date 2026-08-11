/**
 * @module BabelParserContractTest
 * @path tests/scripts/babel_parser_contract_test.ts
 * @description Phase 165 (P1): locks the @babel/parser dependency to the 7.29.x line tip
 * (>= 7.29.8, major 7) and smokes the exact parse() call shape used by
 * scripts/measure_complexity.ts so a bump can never silently change AST behavior.
 * Version metadata resolves through package.json imports (deterministic, offline,
 * permission-free — no --allow-read needed), mirroring P3's runtime ts.version check.
 */

import * as BabelParser from "@babel/parser";
import babelPkg from "@babel/parser/package.json" with { type: "json" };
import denoJson from "../../deno.json" with { type: "json" };

const PARSER_PLUGINS = [
  "typescript",
  "jsx",
  "decorators-legacy",
  "classProperties",
  "classPrivateMethods",
  "privateIn",
] as const;

function parseWithMeasureComplexityOptions(code: string): object {
  return BabelParser.parse(code, {
    sourceType: "module",
    plugins: [...PARSER_PLUGINS],
    errorRecovery: true,
  });
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function versionFromString(version: string): number[] {
  return version.split(".").map((p) => parseInt(p, 10));
}

Deno.test("P1: resolved @babel/parser is on the 7.x line at >= 7.29.8", () => {
  const v = versionFromString(babelPkg.version);
  if (v.length !== 3 || Number.isNaN(v[0])) {
    throw new Error(`unexpected @babel/parser version shape: ${babelPkg.version}`);
  }
  if (v[0] !== 7) {
    throw new Error(
      `@babel/parser resolved to major ${v[0]} (${babelPkg.version}) — the 7.x line is the supported line; ` +
        `Babel 8 migration is deliberately deferred (phase-165 Out of Scope). Review the pin before proceeding.`,
    );
  }
  if (compareVersions(v, [7, 29, 8]) < 0) {
    throw new Error(
      `@babel/parser resolved at ${babelPkg.version} — expected >= 7.29.8 (phase-165 step 1 bumps 7.29.3 -> 7.29.8).`,
    );
  }
});

Deno.test("P1: deno.json import-map pin matches the supported line", () => {
  const pin = denoJson.imports["@babel/parser"] as string;
  const at = pin.lastIndexOf("@");
  const v = versionFromString(at >= 0 ? pin.slice(at + 1) : "");
  if (v.length !== 3 || Number.isNaN(v[0])) {
    throw new Error(`unexpected @babel/parser pin shape: ${pin}`);
  }
  if (v[0] !== 7) {
    throw new Error(
      `@babel/parser pinned at major ${v[0]} (${pin}) — the 7.x line is the supported line; ` +
        `Babel 8 migration is deliberately deferred (phase-165 Out of Scope). Review the pin before proceeding.`,
    );
  }
  if (compareVersions(v, [7, 29, 8]) < 0) {
    throw new Error(
      `@babel/parser pinned at ${pin} — expected >= 7.29.8 (phase-165 step 1 bumps 7.29.3 -> 7.29.8).`,
    );
  }
});

Deno.test("P1: parse() with measure_complexity options handles TS, TSX, decorators, private fields", () => {
  const tsAst = parseWithMeasureComplexityOptions(
    'type Alias = string;\nconst x: Alias = "a";',
  ) as { type: string; program: { body: Array<{ type: string }> } };
  if (tsAst.type !== "File" || tsAst.program.body.length !== 2) {
    throw new Error(`TS parse failed: ${JSON.stringify(tsAst).slice(0, 200)}`);
  }

  const tsxAst = parseWithMeasureComplexityOptions(
    "function Component({ items }: { items: string[] }) {\n" +
      "  return <div>{items.map((i) => <span key={i}>{i}</span>)}</div>;\n" +
      "}",
  ) as { type: string; program: { body: Array<{ type: string }> } };
  if (tsxAst.type !== "File" || tsxAst.program.body.length !== 1) {
    throw new Error(`TSX parse failed: ${JSON.stringify(tsxAst).slice(0, 200)}`);
  }

  const decoratedAst = parseWithMeasureComplexityOptions(
    "@sealed\nclass Service {\n  #secret = 1;\n  run(): void {}\n}",
  ) as { type: string; program: { body: Array<{ type: string; decorators?: Array<{ type: string }> }> } };
  const cls = decoratedAst.program.body.find((n) => n.type === "ClassDeclaration");
  if (!cls || !Array.isArray(cls.decorators) || cls.decorators.length !== 1) {
    throw new Error(`decorators-legacy parse failed: ${JSON.stringify(decoratedAst).slice(0, 200)}`);
  }
});
