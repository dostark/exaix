/**
 * @module BabelParserContractTest
 * @path tests/scripts/babel_parser_contract_test.ts
 * @description Phase 165 (P1): locks the @babel/parser dependency to the 7.29.x line tip
 * (>= 7.29.8, major 7) and smokes the exact parse() call shape used by
 * scripts/measure_complexity.ts so a bump can never silently change AST behavior.
 */

import * as BabelParser from "@babel/parser";

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

function readParserPin(): string {
  const denoJson = JSON.parse(
    Deno.readTextFileSync(new URL("../../deno.json", import.meta.url)),
  );
  return denoJson.imports["@babel/parser"] as string;
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function versionFromPin(pin: string): number[] {
  const at = pin.lastIndexOf("@");
  return pin.slice(at + 1).split(".").map((p) => parseInt(p, 10));
}

Deno.test("P1: @babel/parser pin is on the 7.x line at >= 7.29.8", () => {
  const pin = readParserPin();
  const v = versionFromPin(pin);
  if (v.length !== 3 || Number.isNaN(v[0])) {
    throw new Error(`unexpected @babel/parser pin shape: ${pin}`);
  }
  if (v[0] !== 7) {
    throw new Error(
      `@babel/parser resolved to major ${v[0]} (${pin}) — the 7.x line is the supported line; ` +
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
