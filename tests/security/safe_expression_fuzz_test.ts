/**
 * @module SafeExpressionFuzzTest
 * @path tests/security/safe_expression_fuzz_test.ts
 * @description Differential fuzz for the sandboxed flow-condition evaluator. Generated
 *   expressions from the legitimate grammar must match JS-like semantics. A hostile
 *   corpus must fail with ExpressionError only and must never read a host global.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/safe_expression.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { evaluateExpression, ExpressionError } from "@exaix/flow";

// Named fuzz bounds. The seed keeps a failure reproducible. These are test-only,
// so they are not exposed as user-facing configurable defaults.
const DEFAULT_SAFE_EXPRESSION_FUZZ_ITERATIONS = 500;
const DEFAULT_SAFE_EXPRESSION_FUZZ_SEED = 0x5eed_1;
const DEFAULT_SAFE_EXPRESSION_FUZZ_CHAOS_SEED = 0xc0ffee;
const FUZZ_MAX_DEPTH = 4;
const FUZZ_CHAOS_MAX_LENGTH = 32;

// A named linear congruential generator. Named constants keep the seed reproducible
// without inline magic values in the loop body.
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(LCG_MULTIPLIER, state) + LCG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

type Primitive = number | boolean | string;

interface Scalar {
  readonly source: string;
  readonly value: Primitive;
}

interface ArrayLeaf {
  readonly source: string;
  readonly value: Primitive[];
}

interface BoolExpr {
  readonly source: string;
  readonly expected: boolean;
}

const CONTEXT = {
  results: {
    step1: { success: true, count: 3, duration: 10, tags: ["a", "b"] },
    step2: { success: false, count: 0, duration: 0, tags: [] as string[] },
  },
  steps: [
    { id: "step1", success: true, duration: 10 },
    { id: "step2", success: false, duration: 0 },
  ],
  request: { priority: 2, enabled: true, name: "req" },
  flow: { threshold: 5, mode: "fast" },
};

const SCALAR_LEAVES: readonly Scalar[] = [
  { source: "0", value: 0 },
  { source: "1", value: 1 },
  { source: "2", value: 2 },
  { source: "5", value: 5 },
  { source: "9", value: 9 },
  { source: "true", value: true },
  { source: "false", value: false },
  { source: '"a"', value: "a" },
  { source: '"b"', value: "b" },
  { source: '"req"', value: "req" },
  { source: "results.step1.count", value: 3 },
  { source: "results.step2.count", value: 0 },
  { source: "results.step1.success", value: true },
  { source: "results.step2.success", value: false },
  { source: "results.step1.duration", value: 10 },
  { source: "request.priority", value: 2 },
  { source: "request.enabled", value: true },
  { source: "request.name", value: "req" },
  { source: "flow.threshold", value: 5 },
  { source: "flow.mode", value: "fast" },
  { source: "results.step1.tags.length", value: 2 },
  { source: "results.step2.tags.length", value: 0 },
  { source: "steps.length", value: 2 },
];

const NUMBER_LEAVES: readonly Scalar[] = SCALAR_LEAVES.filter(
  (leaf): leaf is Scalar & { value: number } => typeof leaf.value === "number",
);

const ARRAY_LEAVES: readonly ArrayLeaf[] = [
  { source: "results.step1.tags", value: ["a", "b"] },
  { source: "results.step2.tags", value: [] },
  { source: "[1, 2, 3]", value: [1, 2, 3] },
  { source: '["a", "b"]', value: ["a", "b"] },
  { source: "[]", value: [] },
];

const EQUALITY_OPS = ["===", "!==", "==", "!="] as const;
const RELATIONAL_OPS = ["<", ">", "<=", ">="] as const;
const ALL_COMPARE_OPS = [...EQUALITY_OPS, ...RELATIONAL_OPS] as const;

function compareScalars(op: string, a: Primitive, b: Primitive): boolean {
  switch (op) {
    case "===":
      return a === b;
    case "!==":
      return a !== b;
    case "==":
      return a == b;
    case "!=":
      return a != b;
    case "<":
      return (a as number) < (b as number);
    case ">":
      return (a as number) > (b as number);
    case "<=":
      return (a as number) <= (b as number);
    case ">=":
      return (a as number) >= (b as number);
    default:
      throw new Error(`unexpected comparison operator: ${op}`);
  }
}

function genComparison(rng: () => number): BoolExpr {
  const a = pick(rng, SCALAR_LEAVES);
  const b = pick(rng, SCALAR_LEAVES);
  const numeric = typeof a.value === "number" && typeof b.value === "number";
  const op = pick(rng, numeric ? ALL_COMPARE_OPS : EQUALITY_OPS);
  return { source: `${a.source} ${op} ${b.source}`, expected: compareScalars(op, a.value, b.value) };
}

function genArrayPredicate(rng: () => number): BoolExpr {
  const arr = pick(rng, ARRAY_LEAVES);
  if (rng() < 0.5) {
    const needle = pick(rng, SCALAR_LEAVES);
    return { source: `(${arr.source}).includes(${needle.source})`, expected: arr.value.includes(needle.value) };
  }
  const n = pick(rng, NUMBER_LEAVES);
  const op = pick(rng, RELATIONAL_OPS);
  return {
    source: `(${arr.source}).length ${op} ${n.source}`,
    expected: compareScalars(op, arr.value.length, n.value),
  };
}

function genBool(rng: () => number, depth: number): BoolExpr {
  if (depth <= 0) return rng() < 0.7 ? genComparison(rng) : genArrayPredicate(rng);
  const roll = rng();
  if (roll < 0.4) return genComparison(rng);
  if (roll < 0.55) {
    const a = genBool(rng, depth - 1);
    const b = genBool(rng, depth - 1);
    const op = rng() < 0.5 ? "&&" : "||";
    const expected = op === "&&" ? Boolean(a.expected && b.expected) : Boolean(a.expected || b.expected);
    return { source: `(${a.source}) ${op} (${b.source})`, expected };
  }
  if (roll < 0.7) {
    const a = genBool(rng, depth - 1);
    return { source: `!(${a.source})`, expected: !a.expected };
  }
  if (roll < 0.85) {
    const test = genBool(rng, depth - 1);
    const consequent = genBool(rng, depth - 1);
    const alternate = genBool(rng, depth - 1);
    return {
      source: `(${test.source}) ? (${consequent.source}) : (${alternate.source})`,
      expected: test.expected ? consequent.expected : alternate.expected,
    };
  }
  return genArrayPredicate(rng);
}

Deno.test("security: safe_expression fuzz — legitimate grammar matches JS-like semantics", () => {
  const rng = makeRng(DEFAULT_SAFE_EXPRESSION_FUZZ_SEED);
  for (let i = 0; i < DEFAULT_SAFE_EXPRESSION_FUZZ_ITERATIONS; i++) {
    const generated = genBool(rng, FUZZ_MAX_DEPTH);
    const actual = evaluateExpression(generated.source, CONTEXT);
    assertEquals(typeof actual, "boolean", `"${generated.source}" did not return a boolean`);
    assertEquals(actual, generated.expected, `semantics mismatch for "${generated.source}"`);
  }
});

const HOST_PROBE_KEY = "__exaix_safe_expression_fuzz_probe__";
// Assembled at runtime so the test source holds no literal module-load expression.
const DYNAMIC_IMPORT_PAYLOAD = "imp" + "ort('node:fs')";

const HOSTILE_EXPRESSIONS: readonly string[] = [
  "globalThis",
  `globalThis.${HOST_PROBE_KEY}`,
  HOST_PROBE_KEY,
  "Deno.env.toObject()",
  "Deno.readTextFileSync('/etc/passwd')",
  "fetch('http://127.0.0.1')",
  "process.exit(0)",
  "window",
  "self",
  "require('node:fs')",
  DYNAMIC_IMPORT_PAYLOAD,
  "results.constructor",
  "results['constructor']",
  "results.__proto__",
  "results['__proto__']",
  "results.prototype",
  "[].constructor",
  "results.constructor.constructor('return 1')()",
  "results.map(x => x)",
  "results.filter(x => x)",
  "results.every(x => x)",
  "a = 1",
  "results[0",
  "(1 + 2",
  "results.",
];

Deno.test("security: safe_expression fuzz — hostile corpus fails closed without host access", () => {
  let hostProbeReads = 0;
  Object.defineProperty(globalThis, HOST_PROBE_KEY, {
    configurable: true,
    get() {
      hostProbeReads++;
      return "leaked";
    },
  });
  try {
    for (const source of HOSTILE_EXPRESSIONS) {
      assertThrows(
        () => evaluateExpression(source, CONTEXT),
        ExpressionError,
        undefined,
        `hostile input must be rejected: "${source}"`,
      );
    }
    assertEquals(hostProbeReads, 0, "a hostile input read a host global");
  } finally {
    Reflect.deleteProperty(globalThis, HOST_PROBE_KEY);
  }
});

const FUZZ_ALPHABET = "()[]{}.,?:!<>=&|+*/%\"'abcxyz019 _-";

function randomSoup(rng: () => number, maxLength: number): string {
  const length = Math.floor(rng() * maxLength);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += FUZZ_ALPHABET[Math.floor(rng() * FUZZ_ALPHABET.length)];
  }
  return out;
}

Deno.test("security: safe_expression fuzz — random token soup only throws ExpressionError", () => {
  const rng = makeRng(DEFAULT_SAFE_EXPRESSION_FUZZ_CHAOS_SEED);
  for (let i = 0; i < DEFAULT_SAFE_EXPRESSION_FUZZ_ITERATIONS; i++) {
    const source = randomSoup(rng, FUZZ_CHAOS_MAX_LENGTH);
    try {
      const result = evaluateExpression(source, CONTEXT);
      assertEquals(typeof result, "boolean", `"${source}" returned a non-boolean`);
    } catch (error) {
      assert(error instanceof ExpressionError, `"${source}" threw a non-ExpressionError: ${error}`);
    }
  }
});
