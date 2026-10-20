/**
 * @module ImportRulesCorpus
 * @path packages/lint-policy/tests/fixtures/port/import_rules_corpus.ts
 * @description Named source cases for the six import and placement rules, with the paths they pretend to live at.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/import_rules_parity_test.ts]
 */

export interface IPortCase {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const PROD = "packages/x/src/a.ts";
const ENTRY = "packages/x/mod.ts";
const DISPATCH = "apps/daemon/main.ts";

export const IMPORT_RULES_CORPUS: readonly IPortCase[] = [
  // dynamic imports
  { name: "top-level await import", path: PROD, text: 'export const m = await import("./a.ts");\n' },
  {
    name: "import returned from a function",
    path: PROD,
    text: 'export function load() {\n  return import("./a.ts");\n}\n',
  },
  {
    name: "import inside an if block",
    path: PROD,
    text:
      'export async function load(flag: boolean): Promise<void> {\n  if (flag) {\n    await import("./a.ts");\n  }\n}\n',
  },
  { name: "typeof import type", path: PROD, text: 'export type T = typeof import("./a.ts");\n' },
  {
    name: "import call in an indented string",
    path: PROD,
    text: 'export const text = "import(x)";\nexport function f(): string {\n  const s = "import(y)";\n  return s;\n}\n',
  },
  {
    name: "import call in an indented comment",
    path: PROD,
    text: 'export function f(): number {\n  // import("./a.ts") is described here\n  return 1;\n}\n',
  },
  { name: "one-line arrow import", path: PROD, text: 'export const load = () => import("./a.ts");\n' },
  {
    name: "import in an arrow inside an object",
    path: PROD,
    text: 'export const loaders = {\n  a: () => import("./a.ts"),\n};\n',
  },
  {
    name: "indented await import in a top-level array",
    path: PROD,
    text: 'export const x = [\n  await import("./a.ts"),\n];\n',
  },
  {
    name: "allowed team import in a dispatch entry",
    path: DISPATCH,
    text: 'export async function boot(): Promise<void> {\n  await import("@exaix-team/x/mod.ts");\n}\n',
  },
  {
    name: "other specifier in a dispatch entry",
    path: DISPATCH,
    text: 'export async function boot(): Promise<void> {\n  await import("./other.ts");\n}\n',
  },
  {
    name: "team specifier outside a dispatch entry",
    path: PROD,
    text: 'export async function boot(): Promise<void> {\n  await import("@exaix-team/x/mod.ts");\n}\n',
  },
  {
    name: "computed specifier in a dispatch entry",
    path: DISPATCH,
    text: "export async function boot(path: string): Promise<void> {\n  await import(path);\n}\n",
  },
  {
    name: "style-exclude comment above a dynamic import",
    path: PROD,
    text: '// style-exclude:PLUGINS - loads a plugin on demand\nexport const m = await import("./a.ts");\n',
  },
  {
    name: "deno-lint-ignore comment above a dynamic import",
    path: PROD,
    text:
      '// deno-lint-ignore exaix/dynamic-import -- loads a plugin on demand\nexport const m = await import("./a.ts");\n',
  },
  // inline type imports
  { name: "import type in a parameter", path: PROD, text: 'export function f(x: import("./a.ts").IFoo): void {}\n' },
  { name: "typeof import with a member", path: PROD, text: 'export type Q = typeof import("./a.ts").value;\n' },
  { name: "import type without a member", path: PROD, text: 'export type N = import("./a.ts");\n' },
  { name: "import type in a type argument", path: PROD, text: 'export type L = Promise<import("./a.ts").IFoo>;\n' },
  {
    name: "import type in a comment",
    path: PROD,
    text: '// the type is import("./a.ts").IFoo here\nexport const a = 1;\n',
  },
  // re-exports
  { name: "named export from a module", path: PROD, text: 'export { Foo } from "./foo.ts";\n' },
  { name: "star export from a module", path: PROD, text: 'export * from "./foo.ts";\n' },
  { name: "type export from a module", path: PROD, text: 'export type { IFoo } from "./foo.ts";\n' },
  {
    name: "string that contains the word from",
    path: PROD,
    text: "export const message = \"moved from 'a' to 'b'\";\n",
  },
  {
    name: "export of an imported name, next line",
    path: PROD,
    text: 'import { Foo } from "./foo.ts";\nexport { Foo };\n',
  },
  {
    name: "export of an imported name, later",
    path: PROD,
    text: 'import { Foo } from "./foo.ts";\nexport const x = 1;\nexport { Foo };\n',
  },
  {
    name: "aliased export of an imported name",
    path: PROD,
    text: 'import { Foo } from "./foo.ts";\nexport { Foo as Bar };\n',
  },
  {
    name: "type export of an imported type",
    path: PROD,
    text: 'import type { IFoo } from "./foo.ts";\nexport type { IFoo };\n',
  },
  { name: "export of a local name", path: PROD, text: "const a = 1;\nexport { a };\n" },
  { name: "entrypoint exports a same-directory module", path: ENTRY, text: 'export { Foo } from "./foo.ts";\n' },
  { name: "entrypoint exports a parent-directory module", path: ENTRY, text: 'export { Foo } from "../foo.ts";\n' },
  {
    name: "entrypoint exports an imported name",
    path: ENTRY,
    text: 'import { Foo } from "./foo.ts";\nexport { Foo };\n',
  },
  {
    name: "index entrypoint exports a same-directory module",
    path: "packages/x/index.ts",
    text: 'export { Foo } from "./foo.ts";\n',
  },
  {
    name: "multi-line export list of imported names",
    path: PROD,
    text: 'import { Foo, Bar } from "./foo.ts";\nexport {\n  Foo,\n  Bar,\n};\n',
  },
  { name: "export of an imported default", path: PROD, text: 'import foo from "./foo.ts";\nexport { foo };\n' },
  { name: "export of an imported namespace", path: PROD, text: 'import * as ns from "./foo.ts";\nexport { ns };\n' },
  // import placement
  {
    name: "imports then types then code",
    path: PROD,
    text: 'import { a } from "./a.ts";\nexport interface IThing {\n  readonly a: number;\n}\nexport const b = a;\n',
  },
  {
    name: "type before an import",
    path: PROD,
    text: 'export interface IThing {\n  readonly a: number;\n}\nimport { b } from "./b.ts";\nexport const c = b;\n',
  },
  {
    name: "import after a constant",
    path: PROD,
    text: 'export const first = 1;\nimport { a } from "./a.ts";\nexport const b = a;\n',
  },
  { name: "imports only", path: PROD, text: 'import { a } from "./a.ts";\nexport const b = a;\n' },
  {
    name: "declare before an import",
    path: PROD,
    text: 'declare const g: number;\nimport { a } from "./a.ts";\nexport const b = a + g;\n',
  },
  {
    name: "enum before an import",
    path: PROD,
    text: 'enum E {\n  A,\n}\nimport { a } from "./a.ts";\nexport const b = a + E.A;\n',
  },
  { name: "side-effect import after a constant", path: PROD, text: 'export const x = 1;\nimport "./side.ts";\n' },
  {
    name: "type import after a constant",
    path: PROD,
    text: 'export const x = 1;\nimport type { IFoo } from "./foo.ts";\nexport type T = IFoo;\n',
  },
  {
    name: "import after a function with parameters",
    path: PROD,
    text: 'export function f(a: number): number {\n  return a;\n}\nimport { b } from "./b.ts";\nexport const c = b;\n',
  },
  {
    name: "import after header comments and a shebang",
    path: "scripts/tool.ts",
    text:
      '#!/usr/bin/env -S deno run -A\n/**\n * @module Tool\n */\nimport { a } from "./a.ts";\nexport const b = a;\n',
  },
  {
    name: "multi-line import then type",
    path: PROD,
    text:
      'import {\n  a,\n  b,\n} from "./a.ts";\nexport interface IThing {\n  readonly a: number;\n}\nexport const c = a + b;\n',
  },
  {
    name: "export from counts as an import before a type",
    path: ENTRY,
    text: 'export { a } from "./a.ts";\nexport interface IThing {\n  readonly a: number;\n}\n',
  },
  // exported interface placement
  {
    name: "interface before code",
    path: PROD,
    text: "export interface IFoo {\n  readonly a: string;\n}\nexport function f(): number {\n  return 1;\n}\n",
  },
  {
    name: "interface after a function",
    path: PROD,
    text: "export function f(): number {\n  return 1;\n}\nexport interface IFoo {\n  readonly a: string;\n}\n",
  },
  {
    name: "interface after a constant",
    path: PROD,
    text: "export const first = 1;\nexport interface IFoo {\n  readonly a: string;\n}\n",
  },
  {
    name: "local interface after a constant",
    path: PROD,
    text: "export const first = 1;\ninterface ILocal {\n  readonly a: string;\n}\n",
  },
  {
    name: "two interfaces after a constant",
    path: PROD,
    text:
      "export const first = 1;\nexport interface IOne {\n  readonly a: string;\n}\nexport interface ITwo {\n  readonly b: string;\n}\n",
  },
  {
    name: "interface after a function with parameters",
    path: PROD,
    text: "export function f(a: number): number {\n  return a;\n}\nexport interface IFoo {\n  readonly a: string;\n}\n",
  },
];
