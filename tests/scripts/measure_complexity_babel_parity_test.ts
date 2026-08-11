/**
 * @module MeasureComplexityBabelParityTest
 * @path tests/scripts/measure_complexity_babel_parity_test.ts
 * @description Phase 165 (P2): golden-value parity test for the @babel/parser 7.29.3 -> 7.29.8
 * bump. Parses fixed snippets with the exact options scripts/measure_complexity.ts uses and
 * asserts structural facts + locked cyclomatic values, so a bump can never silently change
 * AST behavior. Golden values are recorded from the 7.29.3 baseline and must not change.
 */

import { complexityForNode, getBabelParse, traverse } from "../../scripts/measure_complexity.ts";

const PARSER_PLUGINS = [
  "typescript",
  "jsx",
  "decorators-legacy",
  "classProperties",
  "classPrivateMethods",
  "privateIn",
] as const;

function parseSnippet(code: string) {
  return getBabelParse()(code, {
    sourceType: "module",
    plugins: [...PARSER_PLUGINS],
    errorRecovery: true,
  });
}

Deno.test("P2: baseline snippet complexity is golden-locked (recorded on 7.29.3)", () => {
  const code = "function alpha(x: number): number {\n" +
    "  if (x > 0) return x;\n" +
    "  for (let i = 0; i < x; i++) {\n" +
    "    if (i % 2 === 0) continue;\n" +
    "  }\n" +
    "  return x && 1 ? x : 0;\n" +
    "}";
  const ast = parseSnippet(code) as { type: string };
  if (ast.type !== "File") throw new Error(`expected File node, got ${ast.type}`);

  const functions: Array<{ name: string; complexity: number }> = [];
  traverse(ast, (n) => {
    if (n.type === "FunctionDeclaration") {
      functions.push({
        name: n.id?.name ?? "<anonymous>",
        complexity: complexityForNode(n),
      });
    }
  });
  if (functions.length !== 1 || functions[0].name !== "alpha") {
    throw new Error(`expected one FunctionDeclaration 'alpha', got ${JSON.stringify(functions)}`);
  }
  if (functions[0].complexity !== 6) {
    throw new Error(
      `cyclomatic complexity drifted from golden value 6 to ${functions[0].complexity} — ` +
        "AST behavior changed across the bump",
    );
  }
});

Deno.test("P2: TSX + decorators + private-field snippet keeps structural shape", () => {
  const code = "function Component({ items }: { items: string[] }) {\n" +
    "  return <div>{items.map((i) => <span key={i}>{i}</span>)}</div>;\n" +
    "}\n" +
    "@sealed\n" +
    "class Service {\n" +
    "  #secret = 1;\n" +
    "  run(): void { if (this.#secret) return; }\n" +
    "}";
  const ast = parseSnippet(code) as {
    type: string;
    program: { body: Array<{ type: string; decorators?: Array<{ type: string }> }> };
  };
  if (ast.type !== "File") throw new Error(`expected File node, got ${ast.type}`);
  if (ast.program.body.length !== 2) {
    throw new Error(`expected 2 top-level statements, got ${ast.program.body.length}`);
  }
  const cls = ast.program.body.find((n) => n.type === "ClassDeclaration");
  if (!cls || !Array.isArray(cls.decorators) || cls.decorators.length !== 1) {
    throw new Error(`expected ClassDeclaration with 1 decorator, got ${JSON.stringify(cls)}`);
  }
});
