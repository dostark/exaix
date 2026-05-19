#!/usr/bin/env -S deno run -A
/**
 * @module MeasureComplexity
 * @path scripts/measure_complexity.ts
 * @description Analyzes code complexity across the src/ tree using AST-based or heuristic analysis.
 *
 * Usage:
 *   deno run --allow-run --allow-read scripts/measure_complexity.ts [options]
 *
 * Options:
 *   --threshold <num>   Numeric threshold for flagging files/functions (default 10)
 *   --topFiles <n>      How many top files to display (default 5)
 *   --topFns <n>        How many top functions per file to display (default 5)
 *   --json              Print full results as JSON
 *   --fail              Exit with code 1 if any breaches are found (useful for CI)
 *
 * Example:
 *   # Human-readable output with custom threshold
 *   deno run --allow-run --allow-read scripts/measure_complexity.ts --threshold 15 --topFiles 10
 */
import { walk } from "@std/fs";
import { parse } from "@std/flags";
import type { JSONObject } from "@exaix/core/types";
// Import all parser candidates at the top-level (see CODE_STYLE.md for rationale)
// Only use local or npm imports that are available and versioned
import * as BabelParser1 from "@babel/parser";

const parserCandidates = [
  BabelParser1,
];

type ParserOptions = JSONObject;
type BabelParseResult = object | null;
type BabelParseFn = (code: string, opts?: ParserOptions) => BabelParseResult;
type AstFieldValue = string | number | boolean | null | undefined | AstFieldValue[] | { [key: string]: AstFieldValue };

interface IAstNamedNode {
  name?: string;
}

interface IAstLoc {
  start?: { line?: number };
}

interface IAstNode {
  type?: string;
  loc?: IAstLoc;
  alternate?: IAstNode;
  test?: AstFieldValue;
  operator?: string;
  id?: IAstNamedNode | null;
  key?: IAstNamedNode | null;
}

function extractParse(mod: object | null): BabelParseFn | undefined {
  if (typeof mod === "object" && mod !== null) {
    if ("parse" in mod && typeof (mod as { parse?: AstFieldValue }).parse === "function") {
      return (mod as { parse: BabelParseFn }).parse;
    }
    if ("default" in mod && typeof (mod as { default?: AstFieldValue }).default === "function") {
      return (mod as { default: BabelParseFn }).default;
    }
    if (
      "default" in mod &&
      typeof (mod as { default?: AstFieldValue }).default === "object" &&
      (mod as { default: { parse?: AstFieldValue } }).default &&
      typeof (mod as { default: { parse?: AstFieldValue } }).default.parse === "function"
    ) {
      return (mod as { default: { parse: BabelParseFn } }).default.parse;
    }
  }
  return undefined;
}

const babelParse = parserCandidates.map(extractParse).find((fn) => typeof fn === "function");
const babelParseError = babelParse ? undefined : new Error(
  "Could not load a JS parser from local/npm or CDN; please ensure network access or install a local parser (e.g. npm:@babel/parser).",
);

export function getBabelParse(): BabelParseFn {
  if (babelParse) return babelParse;
  throw babelParseError ?? new Error("Babel parser not loaded");
}

/**
 * Script to measure code complexity
 *
 * Usage:
 * deno run --allow-run --allow-read scripts/measure_complexity.ts [--threshold <num>]
 */

const flags = parse(Deno.args, {
  string: ["threshold", "topFiles", "topFns"],
  boolean: ["json", "fail"],
  default: { threshold: "10", topFiles: "5", topFns: "5", json: false, fail: false },
});

const THRESHOLD = parseFloat(flags.threshold);
const TOP_FILES = parseInt(String(flags.topFiles || "5"), 10) || 5;
const TOP_FNS = parseInt(String(flags.topFns || "5"), 10) || 5;
const OUTPUT_JSON = !!flags.json;
const SHOULD_FAIL = !!flags.fail;

// AST-based cyclomatic complexity per-function using Babel parser.
// Cyclomatic complexity heuristic:
// - Start at 1 per function
// - +1 for each: IfStatement, For/While/DoWhile/ForIn/ForOf, SwitchCase (with test), CatchClause,
//   ConditionalExpression (ternary), LogicalExpression (||, &&)
// We parse TypeScript/JS with @babel/parser and walk the AST.

type Node = IAstNode;
type NodeValue = string | number | boolean | null | object;
interface NodeRecord {
  [key: string]: NodeValue;
}

export function computeFileComplexityMetrics(
  fnComplexities: number[],
  topLevelComplexity: number,
): {
  fileComplexity: number;
  fileComplexitySum: number;
  maxFnComplexity: number;
  topLevelComplexity: number;
} {
  const maxFnComplexity = fnComplexities.length > 0 ? Math.max(...fnComplexities) : 0;
  const fileComplexity = Math.max(maxFnComplexity, topLevelComplexity);
  const fileComplexitySum = fnComplexities.reduce((sum, c) => sum + c, 0) + topLevelComplexity;
  return { fileComplexity, fileComplexitySum, maxFnComplexity, topLevelComplexity };
}

export function traverse(node: Node, cb: (n: Node, parent?: Node) => void, parent?: Node): void {
  if (!node || typeof node !== "object") return;
  cb(node, parent);

  const nodeRecord = node as NodeRecord;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "loc" || key === "range") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === "object" && typeof (c as IAstNode).type === "string") {
          traverse(c as IAstNode, cb, node);
        }
      }
    } else if (child && typeof child === "object" && typeof (child as IAstNode).type === "string") {
      traverse(child as IAstNode, cb, node);
    }
  }
}

// New traversal helper that provides the full ancestor chain to the callback.
export function traverseWithAncestors(
  node: Node,
  cb: (n: Node, ancestors: Node[]) => void,
  ancestors: Node[] = [],
): void {
  if (!node || typeof node !== "object") return;
  cb(node, ancestors);

  const nodeRecord = node as NodeRecord;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "loc" || key === "range") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === "object" && typeof (c as IAstNode).type === "string") {
          traverseWithAncestors(c as IAstNode, cb, [...ancestors, node]);
        }
      }
    } else if (child && typeof child === "object" && typeof (child as IAstNode).type === "string") {
      traverseWithAncestors(child as IAstNode, cb, [...ancestors, node]);
    }
  }
}

export function complexityForNode(node: Node): number {
  let complexity = 1;

  traverse(node, (n) => {
    if (!n || typeof n.type !== "string") return;

    switch (n.type) {
      case "IfStatement":
        complexity += 1;
        if (n.alternate && n.alternate.type === "IfStatement") {
          // else if counts as an additional decision (already covered by inner IfStatement)
        }
        break;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        complexity += 1;
        break;
      case "SwitchCase":
        // each `case` (with a test) increases complexity
        if (n.test) complexity += 1;
        break;
      case "CatchClause":
        complexity += 1;
        break;
      case "ConditionalExpression":
        // ternary
        complexity += 1;
        break;
      case "LogicalExpression":
        if (n.operator === "||" || n.operator === "&&") complexity += 1;
        break;
      default:
        break;
    }
  });

  return complexity;
}

export function calculateComplexityFromText(content: string): number {
  let complexity = 1;
  const tokens: RegExp[] = [
    /\bif\b/g,
    /\belse\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?/g,
    /\|\|/g,
    /\&\&/g,
  ];
  for (const t of tokens) {
    const m = content.match(t);
    if (m) complexity += m.length;
  }
  return complexity;
}

async function runComplexityCheck() {
  if (!OUTPUT_JSON) console.log(`🧠 Running AST-based complexity analysis (Threshold: ${THRESHOLD})...`);

  let totalFiles = 0;
  let totalFunctions = 0;
  const fileSummaries: Array<
    {
      path: string;
      fileComplexity: number;
      fileComplexitySum: number;
      functions: Array<{ name: string; complexity: number; line?: number }>;
    }
  > = [];

  let babelParse: BabelParseFn | null = null;
  try {
    babelParse = await getBabelParse();
  } catch (_e) {
    console.warn("⚠️  Could not load AST parser; falling back to heuristic per-function analysis.");
  }

  for await (const entry of walk("src", { includeDirs: false, exts: [".ts", ".tsx", ".js", ".jsx"] })) {
    const content = await Deno.readTextFile(entry.path);
    let ast: Node | null = null;

    try {
      if (babelParse) {
        ast = babelParse(content, {
          sourceType: "module",
          plugins: [
            "typescript",
            "jsx",
            "decorators-legacy",
            "classProperties",
            "classPrivateMethods",
            "privateIn",
          ],
          errorRecovery: true,
        }) as Node;
      }
    } catch (_e) {
      console.error(`Failed to parse ${entry.path}: ${_e}`);
      // continue to fallback below
    }

    const functions: Array<{ node?: Node; name: string; line?: number; text?: string }> = [];

    if (ast) {
      traverse(ast, (n: Node) => {
        if (!n || typeof n.type !== "string") return;
        switch (n.type) {
          case "FunctionDeclaration":
            functions.push({ node: n, name: n.id?.name || "<anonymous>", line: n.loc?.start?.line });
            break;
          case "FunctionExpression":
            functions.push({ node: n, name: n.id?.name || "<anonymous>", line: n.loc?.start?.line });
            break;
          case "ArrowFunctionExpression":
            functions.push({ node: n, name: "<arrow>", line: n.loc?.start?.line });
            break;
          case "ClassMethod":
          case "ClassPrivateMethod":
            functions.push({ node: n, name: n.key?.name || "<method>", line: n.loc?.start?.line });
            break;
          case "ObjectMethod":
            functions.push({ node: n, name: n.key?.name || "<method>", line: n.loc?.start?.line });
            break;
          default:
            break;
        }
      });
    } else {
      // Fallback: naive regex to find function-like blocks and capture text
      const fnRegexes = [
        /function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g,
        /([A-Za-z0-9_$]+)\s*=\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\}/g,
        /([A-Za-z0-9_$]+)\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g,
      ];

      for (const rx of fnRegexes) {
        let m: RegExpExecArray | null;
        while ((m = rx.exec(content))) {
          functions.push({ name: m[1] || "<anonymous>", text: m[2], line: undefined });
        }
      }
    }

    const fnResults: Array<{ name: string; complexity: number; line?: number }> = [];

    for (const fn of functions) {
      let c = 0;
      if (fn.node) {
        c = complexityForNode(fn.node);
      } else if (fn.text) {
        c = calculateComplexityFromText(fn.text);
      } else {
        c = 1;
      }
      fnResults.push({ name: fn.name, complexity: c, line: fn.line });
    }

    // Also compute top-level (module) complexity by traversing AST but skipping function bodies
    let topLevelComplexity = 0;
    if (ast) {
      traverseWithAncestors(ast, (n: Node, ancestors: Node[]) => {
        if (!n || typeof n.type !== "string") return;
        // If any ancestor is a function-like node, skip counting this node for top-level
        if (
          ancestors.some((a) =>
            typeof a.type === "string" &&
            [
              "FunctionDeclaration",
              "FunctionExpression",
              "ArrowFunctionExpression",
              "ClassMethod",
              "ObjectMethod",
              "ClassPrivateMethod",
            ].includes(a.type)
          )
        ) return;
        switch (n.type) {
          case "IfStatement":
          case "ForStatement":
          case "ForInStatement":
          case "ForOfStatement":
          case "WhileStatement":
          case "DoWhileStatement":
          case "CatchClause":
          case "ConditionalExpression":
            topLevelComplexity += 1;
            break;
          case "LogicalExpression":
            if (n.operator === "||" || n.operator === "&&") topLevelComplexity += 1;
            break;
          case "SwitchCase":
            if (n.test) topLevelComplexity += 1;
            break;
          default:
            break;
        }
      });
    } else {
      topLevelComplexity = calculateComplexityFromText(content);
    }

    const { fileComplexity, fileComplexitySum } = computeFileComplexityMetrics(
      fnResults.map((f) => f.complexity),
      topLevelComplexity,
    );

    fileSummaries.push({
      path: entry.path,
      fileComplexity,
      fileComplexitySum,
      functions: fnResults.sort((a, b) => b.complexity - a.complexity),
    });

    totalFiles += 1;
    totalFunctions += fnResults.length;
  }

  // Aggregate and report
  const totalComplexity = fileSummaries.reduce((s, f) => s + f.fileComplexity, 0);
  const avgFileComplexity = totalFiles ? totalComplexity / totalFiles : 0;

  if (!OUTPUT_JSON) console.log("----------------------------------------");
  if (!OUTPUT_JSON) console.log(`📊 Analysis of ${totalFiles} files, ${totalFunctions} functions`);
  if (!OUTPUT_JSON) console.log(`📈 Average File Complexity: ${avgFileComplexity.toFixed(2)}`);

  // Top files
  const topFiles = fileSummaries.sort((a, b) => b.fileComplexity - a.fileComplexity).slice(0, TOP_FILES);
  if (!OUTPUT_JSON) console.log(`🏔️  Top ${TOP_FILES} files by complexity:`);
  for (const f of topFiles) {
    if (!OUTPUT_JSON) console.log(`  - ${f.path}: ${f.fileComplexity}`);
    const topFns = f.functions.slice(0, TOP_FNS);
    for (const fn of topFns) {
      if (!OUTPUT_JSON) console.log(`      • ${fn.name} (line ${fn.line ?? "?"}): ${fn.complexity}`);
    }
  }

  // Flag files/functions above threshold
  if (!OUTPUT_JSON) console.log("\n⚠️  Items exceeding threshold:");
  const exceeding: {
    files: Array<{ path: string; complexity: number }>;
    functions: Array<{ path: string; name: string; complexity: number; line?: number }>;
  } = { files: [], functions: [] };
  for (const f of fileSummaries) {
    if (f.fileComplexity > THRESHOLD) {
      if (!OUTPUT_JSON) console.log(`  - File ${f.path}: ${f.fileComplexity}`);
      exceeding.files.push({ path: f.path, complexity: f.fileComplexity });
    }
    for (const fn of f.functions) {
      if (fn.complexity > THRESHOLD) {
        if (!OUTPUT_JSON) {
          console.log(`    • Function ${fn.name} in ${f.path} (line ${fn.line ?? "?"}): ${fn.complexity}`);
        }
        exceeding.functions.push({ path: f.path, name: fn.name, complexity: fn.complexity, line: fn.line });
      }
    }
  }

  if (!OUTPUT_JSON) {
    if (avgFileComplexity > 50) {
      console.log(`\n⚠️  Average file complexity seems high.`);
    } else {
      console.log(`\n✅ Complexity matches expectations.`);
    }
  }

  const result = {
    meta: { totalFiles, totalFunctions, avgFileComplexity, threshold: THRESHOLD, topFiles: TOP_FILES, topFns: TOP_FNS },
    topFiles,
    fileSummaries,
    exceeding,
  };

  if (OUTPUT_JSON) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Handle exit behavior for CI/CD
  if (SHOULD_FAIL && (exceeding.files.length > 0 || exceeding.functions.length > 0)) {
    if (!OUTPUT_JSON) {
      console.error(
        `\n❌ Complexity check failed: ${exceeding.files.length} file(s) and ${exceeding.functions.length} function(s) exceed threshold.`,
      );
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await runComplexityCheck();
}
