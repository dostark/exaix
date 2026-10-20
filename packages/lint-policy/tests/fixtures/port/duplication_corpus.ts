/**
 * @module DuplicationCorpus
 * @path packages/lint-policy/tests/fixtures/port/duplication_corpus.ts
 * @description Named source sets and options for the duplicate-type and duplicate-constant checks.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/duplication_parity_test.ts]
 */

export interface IDuplicationUnit {
  readonly path: string;
  readonly text: string;
}

export interface IDuplicationAllow {
  readonly name: string;
  readonly files: readonly string[];
  readonly reason: string;
}

export interface IDuplicationCase {
  readonly name: string;
  readonly kind: "type" | "constant";
  readonly units: readonly IDuplicationUnit[];
  readonly allow?: readonly IDuplicationAllow[];
  readonly minProperties?: number;
  readonly namePattern?: string;
}

const A = "packages/a/src/a.ts";
const B = "packages/b/src/b.ts";
const C = "packages/c/src/c.ts";
const TWO_MEMBERS = "export interface IThing { a: string; b: number; }\n";

export const DUPLICATION_CORPUS: readonly IDuplicationCase[] = [
  {
    name: "same interface in two files",
    kind: "type",
    units: [{ path: A, text: TWO_MEMBERS }, { path: B, text: TWO_MEMBERS }],
  },
  {
    name: "same interface in three files, listed out of order",
    kind: "type",
    units: [{ path: C, text: TWO_MEMBERS }, { path: A, text: TWO_MEMBERS }, { path: B, text: TWO_MEMBERS }],
  },
  {
    name: "member order differs",
    kind: "type",
    units: [
      { path: A, text: TWO_MEMBERS },
      { path: B, text: "export interface IThing { b: number; a: string; }\n" },
    ],
  },
  {
    name: "one-member interface under the default",
    kind: "type",
    units: [
      { path: A, text: "export interface IThing { a: string; }\n" },
      { path: B, text: "export interface IThing { a: string; }\n" },
    ],
  },
  {
    name: "one-member interface with minProperties 1",
    kind: "type",
    minProperties: 1,
    units: [
      { path: A, text: "export interface IThing { a: string; }\n" },
      { path: B, text: "export interface IThing { a: string; }\n" },
    ],
  },
  {
    name: "member type differs",
    kind: "type",
    units: [
      { path: A, text: TWO_MEMBERS },
      { path: B, text: "export interface IThing { a: string; b: string; }\n" },
    ],
  },
  {
    name: "object type alias in two files",
    kind: "type",
    units: [
      { path: A, text: "export type TThing = { a: string; b: number };\n" },
      { path: B, text: "export type TThing = { a: string; b: number };\n" },
    ],
  },
  {
    name: "interface with extends against a plain interface",
    kind: "type",
    units: [
      { path: A, text: "export interface IThing extends IBase { a: string; b: number; }\n" },
      { path: B, text: TWO_MEMBERS },
    ],
  },
  {
    name: "allowed pair of interfaces",
    kind: "type",
    allow: [{ name: "IThing", files: [A, B], reason: "Edition boundary." }],
    units: [{ path: A, text: TWO_MEMBERS }, { path: B, text: TWO_MEMBERS }],
  },
  {
    name: "stale allow entry for a type",
    kind: "type",
    allow: [{ name: "IMISSING", files: [A, C], reason: "No longer real." }],
    units: [{ path: A, text: "export interface IOther { a: string; b: number; }\n" }],
  },
  {
    name: "same constant and value in two files",
    kind: "constant",
    units: [{ path: A, text: "export const MAX_RETRIES = 3;\n" }, { path: B, text: "export const MAX_RETRIES = 3;\n" }],
  },
  {
    name: "same constant name with a different value",
    kind: "constant",
    units: [{ path: A, text: "export const MAX_RETRIES = 3;\n" }, { path: B, text: "export const MAX_RETRIES = 4;\n" }],
  },
  {
    name: "same value under a different name",
    kind: "constant",
    units: [{ path: A, text: "export const MAX_RETRIES = 3;\n" }, { path: B, text: "export const MIN_RETRIES = 3;\n" }],
  },
  {
    name: "static array and object constants",
    kind: "constant",
    units: [
      { path: A, text: 'export const LIST = ["a", "b"];\nexport const TABLE = { x: 1, y: "z" };\n' },
      { path: B, text: 'export const LIST = ["a", "b"];\nexport const TABLE = { y: "z", x: 1 };\n' },
    ],
  },
  {
    name: "constant from a call",
    kind: "constant",
    units: [
      { path: A, text: "export const NOW = Date.now();\n" },
      { path: B, text: "export const NOW = Date.now();\n" },
    ],
  },
  {
    name: "lower-case constant under the default and a custom pattern",
    kind: "constant",
    namePattern: "^[a-z]+$",
    units: [{ path: A, text: "export const limit = 3;\n" }, { path: B, text: "export const limit = 3;\n" }],
  },
  {
    name: "allowed pair of constants",
    kind: "constant",
    allow: [{ name: "MAX_RETRIES", files: [A, B], reason: "Package isolation." }],
    units: [{ path: A, text: "export const MAX_RETRIES = 3;\n" }, { path: B, text: "export const MAX_RETRIES = 3;\n" }],
  },
  {
    name: "stale allow entry for a constant",
    kind: "constant",
    allow: [{ name: "MISSING", files: [A, C], reason: "No longer real." }],
    units: [{ path: A, text: "export const OTHER = 1;\n" }],
  },
];
