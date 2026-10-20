/**
 * @module MagicLiteralCorpus
 * @path packages/lint-policy/tests/fixtures/port/magic_literal_corpus.ts
 * @description Named source trees and command flags for the magic-literal detector behind check:magic.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/magic_literal_parity_test.ts]
 */

export interface IMagicLiteralCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly args: readonly string[];
}

const SRC = "packages/x/src";
const TESTS = "packages/x/tests";
const PHRASE = '"repeated literal text"';

function uses(literal: string, times: number): string {
  return Array.from({ length: times }, (_, index) => `export const v${index} = [${literal}];`).join("\n") + "\n";
}

const STRUCTURAL = [
  "123e4567-e89b-12d3-a456-426614174000",
  "1.2.3",
  "src/some/path.ts",
  "--some-flag",
  "application/json",
  "a@example.com",
  "model-42",
  "SOME_CONSTANT",
  "abc",
  "string",
]
  .map((value) => uses(JSON.stringify(value), 9))
  .join("");

const POSITIONS = [
  'export const o1 = { "repeated literal text": 1 };',
  'export const o2 = { description: "repeated literal text" };',
  'export const o3 = { required: ["repeated literal text"] };',
  'export const o4 = a["repeated literal text"];',
  'export enum E { A = "repeated literal text" }',
  'export const SOME_NAME = "repeated literal text";',
  'export const o5 = { stdout: "piped", type: "text" };',
]
  .map((line) => `${line}\n`.repeat(9))
  .join("");

const DOMAIN_WORDS = ["pending", "resumed", "fulfilled", "rejected", "amended", "expired", "cancelled", "other"]
  .map((word) => uses(JSON.stringify(word), 9))
  .join("");

export const MAGIC_LITERAL_CORPUS: readonly IMagicLiteralCase[] = [
  { name: "clean tree", files: { [`${SRC}/a.ts`]: "export const a = 1;\n" }, args: [] },
  { name: "local string violation", files: { [`${SRC}/a.ts`]: uses(PHRASE, 4) }, args: [] },
  {
    name: "global string violation",
    files: { [`${SRC}/a.ts`]: uses(PHRASE, 2), [`${SRC}/b.ts`]: uses(PHRASE, 2), [`${SRC}/c.ts`]: uses(PHRASE, 2) },
    args: [],
  },
  { name: "number violation", files: { [`${SRC}/a.ts`]: uses("12345", 5) }, args: [] },
  { name: "number violation with --no-numbers", files: { [`${SRC}/a.ts`]: uses("12345", 5) }, args: ["--no-numbers"] },
  { name: "structural strings", files: { [`${SRC}/a.ts`]: STRUCTURAL }, args: [] },
  { name: "structural positions", files: { [`${SRC}/a.ts`]: POSITIONS }, args: [] },
  { name: "domain status words", files: { [`${SRC}/a.ts`]: DOMAIN_WORDS }, args: [] },
  {
    name: "existing constant candidate",
    files: {
      [`${SRC}/constants.ts`]: `export const NAMES = { first: ${PHRASE} };\n`,
      [`${SRC}/use.ts`]: uses(PHRASE, 4),
    },
    args: [],
  },
  {
    name: "test files skipped by default",
    files: { [`${TESTS}/a_test.ts`]: uses('"mock-value-here"', 9) + uses('"another literal"', 4) },
    args: [],
  },
  {
    name: "test files included",
    files: { [`${TESTS}/a_test.ts`]: uses('"mock-value-here"', 9) + uses('"another literal"', 4) },
    args: ["--include-tests"],
  },
  {
    name: "lowered local threshold flag",
    files: { [`${SRC}/a.ts`]: uses(PHRASE, 2) },
    args: ["--local-string-threshold=1"],
  },
  {
    name: "raised global threshold flag",
    files: { [`${SRC}/a.ts`]: uses(PHRASE, 4), [`${SRC}/b.ts`]: uses(PHRASE, 4) },
    args: ["--global-string-threshold=20", "--local-string-threshold=20"],
  },
  {
    name: "ranked violations",
    files: {
      [`${SRC}/a.ts`]: uses('"first literal text"', 4),
      [`${SRC}/b.ts`]: uses('"second literal text"', 5),
      [`${SRC}/c.ts`]: uses('"third literal text"', 2),
      [`${SRC}/d.ts`]: uses('"third literal text"', 2),
      [`${SRC}/e.ts`]: uses('"third literal text"', 2),
      [`${SRC}/f.ts`]: uses("98765", 5),
    },
    args: [],
  },
  {
    name: "more than ten files",
    files: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`${SRC}/f${index}.ts`, uses(PHRASE, 1)])),
    args: [],
  },
  {
    name: "fixture files skipped",
    files: { [`${TESTS}/fixtures/a.ts`]: uses(PHRASE, 9) },
    args: ["--include-tests"],
  },
];
