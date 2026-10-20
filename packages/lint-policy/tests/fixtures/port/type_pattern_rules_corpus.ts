/**
 * @module TypePatternRulesCorpus
 * @path packages/lint-policy/tests/fixtures/port/type_pattern_rules_corpus.ts
 * @description Named source cases for the promise-response, suppression-pragma, and string-union rules, with the paths they pretend to live at.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/type_pattern_rules_parity_test.ts]
 */

export interface IPortCase {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const PROD = "packages/x/src/a.ts";
const TEST = "packages/x/tests/a_test.ts";

export const TYPE_PATTERN_CORPUS: readonly IPortCase[] = [
  // promise-response-alias
  { name: "alias of the weak promise", path: PROD, text: "export type Fetcher = Promise<Response>;\n" },
  {
    name: "alias of a function returning the weak promise",
    path: PROD,
    text: "type Fetcher = () => Promise<Response>;\n",
  },
  {
    name: "alias of a function with parameters returning the weak promise",
    path: PROD,
    text: "type Fetcher = (url: string) => Promise<Response>;\n",
  },
  { name: "alias of another promise", path: PROD, text: "export type Body = Promise<string>;\n" },
  {
    name: "alias comment mentioning the weak promise",
    path: PROD,
    text: "// type Old = Promise<Response>;\nexport const a = 1;\n",
  },
  {
    name: "alias text inside a string",
    path: PROD,
    text: 'export const text = "type Old = Promise<Response>;";\n',
  },
  {
    name: "alias spread over two lines",
    path: PROD,
    text: "export type Fetcher =\n  Promise<Response>;\n",
  },
  // promise-response-return
  {
    name: "function returning the weak promise",
    path: PROD,
    text: 'export function get(): Promise<Response> {\n  return fetch("x");\n}\n',
  },
  {
    name: "arrow returning the weak promise",
    path: PROD,
    text: 'export const load = (): Promise<Response> => fetch("y");\n',
  },
  {
    name: "method returning the weak promise",
    path: PROD,
    text: 'export class Client {\n  send(): Promise<Response> {\n    return fetch("z");\n  }\n}\n',
  },
  {
    name: "interface method returning the weak promise",
    path: PROD,
    text: "export interface IClient {\n  send(): Promise<Response>;\n}\n",
  },
  {
    name: "parameter typed as the weak promise",
    path: PROD,
    text: "export function run(task: Promise<Response>): void {}\n",
  },
  { name: "variable typed as the weak promise", path: PROD, text: "export let pending: Promise<Response>;\n" },
  {
    name: "function type returning the weak promise as a parameter",
    path: PROD,
    text: "export function use(cb: () => Promise<Response>): void {}\n",
  },
  {
    name: "weak promise in a comment",
    path: PROD,
    text: "// get(): Promise<Response> is weak\nexport const a = 1;\n",
  },
  {
    name: "weak promise in a string",
    path: PROD,
    text: 'export const note = "get(): Promise<Response>";\n',
  },
  {
    name: "return type of another promise",
    path: PROD,
    text: 'export function get(): Promise<string> {\n  return Promise.resolve("x");\n}\n',
  },
  {
    name: "weak promise with a space before the colon",
    path: PROD,
    text: 'export function get() : Promise < Response > {\n  return fetch("x");\n}\n',
  },
  {
    name: "return type split over two lines",
    path: PROD,
    text: 'export function get():\n  Promise<Response> {\n  return fetch("x");\n}\n',
  },
  // ts-suppression-pragmas
  {
    name: "expect-error with a description",
    path: PROD,
    text: '// @ts-expect-error: the literal is checked at run time\nexport const a: number = "x";\n',
  },
  {
    name: "ignore with a description",
    path: PROD,
    text: '// @ts-ignore legacy value\nexport const a: number = "x";\n',
  },
  { name: "ignore without a description", path: PROD, text: '// @ts-ignore\nexport const a: number = "x";\n' },
  {
    name: "ignore with an empty description after a colon",
    path: PROD,
    text: '// @ts-expect-error:\nexport const a: number = "x";\n',
  },
  {
    name: "block comment ignore with a description",
    path: PROD,
    text: "/* @ts-ignore legacy value */\nexport const a = 1;\n",
  },
  { name: "block comment ignore without a description", path: PROD, text: "/* @ts-ignore */\nexport const a = 1;\n" },
  { name: "nocheck with a description", path: PROD, text: "// @ts-nocheck generated file\nexport const a = 1;\n" },
  { name: "pragma name in prose", path: PROD, text: "// the @ts-ignore pragma is banned here\nexport const a = 1;\n" },
  { name: "pragma name in a string", path: PROD, text: 'export const text = "@ts-ignore reason";\n' },
  {
    name: "pragma in a test file",
    path: TEST,
    text: '// @ts-expect-error: checks the guard\nexport const a: number = "x";\n',
  },
  // magic-union-type
  {
    name: "parameter with a string union",
    path: PROD,
    text: 'export function mode(value: "fast" | "slow"): string {\n  return value;\n}\n',
  },
  {
    name: "interface member with a string union",
    path: PROD,
    text: 'export interface IOptions {\n  readonly speed: "fast" | "slow";\n}\n',
  },
  {
    name: "cast to a string union",
    path: PROD,
    text: 'export const pick = (input: string) => input as "fast" | "slow";\n',
  },
  { name: "named alias of a string union", path: PROD, text: 'export type Speed = "fast" | "slow";\n' },
  {
    name: "named alias of a string union and undefined",
    path: PROD,
    text: 'export type Mode = "fast" | "slow" | undefined;\n',
  },
  {
    name: "single string literal with undefined",
    path: PROD,
    text: 'export function one(value: "only" | undefined): void {}\n',
  },
  {
    name: "string union with a dash in a value",
    path: PROD,
    text: 'export function m(value: "a-b" | "c-d"): void {}\n',
  },
  {
    name: "string union split over lines",
    path: PROD,
    text: 'export function mode(\n  value: "fast"\n    | "slow",\n): void {}\n',
  },
  {
    name: "string union in a comment",
    path: PROD,
    text: '// mode: "fast" | "slow"\nexport const a = 1;\n',
  },
  {
    name: "string union in a string",
    path: PROD,
    text: 'export const text = \'"fast" | "slow"\';\n',
  },
  {
    name: "string union in a test file",
    path: TEST,
    text: 'export function mode(value: "fast" | "slow"): string {\n  return value;\n}\n',
  },
  {
    name: "alias of an object with a string union member on one line",
    path: PROD,
    text: 'export type Config = { mode: "fast" | "slow" };\n',
  },
  {
    name: "alias of an object with a string union member over lines",
    path: PROD,
    text: 'export type Config = {\n  mode: "fast" | "slow";\n};\n',
  },
  {
    name: "alias of an array of a string union",
    path: PROD,
    text: 'export type Modes = Array<"fast" | "slow">;\n',
  },
  {
    name: "string union of three values in a parameter",
    path: PROD,
    text: 'export function mode(value: "a" | "b" | "c"): void {}\n',
  },
];
