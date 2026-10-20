/**
 * @module InterfaceRulesCorpus
 * @path packages/lint-policy/tests/fixtures/port/interface_rules_corpus.ts
 * @description Named source cases for the interface rename rule, with the paths they pretend to live at.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/interface_rules_parity_test.ts]
 */

export interface IInterfaceRulesCase {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const PROD = "packages/x/src/a.ts";
const COMPAT = "packages/core/src/parsing/markdown.ts";

export const INTERFACE_RULES_CORPUS: readonly IInterfaceRulesCase[] = [
  {
    name: "interface renamed to a plain name",
    path: PROD,
    text: 'import { IFoo as Foo } from "./a.ts";\nexport const x = Foo;\n',
  },
  {
    name: "interface imported under its own name",
    path: PROD,
    text: 'import { IFoo } from "./a.ts";\nexport const x: IFoo = { a: 1 };\n',
  },
  {
    name: "type import renamed",
    path: PROD,
    text: 'import type { IFoo as Foo } from "./a.ts";\nexport type T = Foo;\n',
  },
  { name: "plain name renamed", path: PROD, text: 'import { Foo as Bar } from "./a.ts";\nexport const x = Bar;\n' },
  {
    name: "interface renamed to another interface name",
    path: PROD,
    text: 'import { IFoo as IBar } from "./a.ts";\nexport const x = IBar;\n',
  },
  {
    name: "name that starts with I and a lowercase letter",
    path: PROD,
    text: 'import { Iron as Foo } from "./a.ts";\nexport const x = Foo;\n',
  },
  {
    name: "second specifier renamed",
    path: PROD,
    text: 'import { Foo, IBar as Bar } from "./a.ts";\nexport const x = [Foo, Bar];\n',
  },
  {
    name: "renamed specifier on its own line",
    path: PROD,
    text: 'import {\n  IFoo as Foo,\n  Bar,\n} from "./a.ts";\nexport const x = [Foo, Bar];\n',
  },
  { name: "re-export with a rename", path: PROD, text: 'export { IFoo as Foo } from "./a.ts";\n' },
  { name: "default import", path: PROD, text: 'import IFoo from "./a.ts";\nexport const x = IFoo;\n' },
  { name: "namespace import", path: PROD, text: 'import * as IFoo from "./a.ts";\nexport const x = IFoo;\n' },
  {
    name: "import text in a comment",
    path: PROD,
    text: '// import { IFoo as Foo } from "./a.ts";\nexport const x = 1;\n',
  },
  { name: "import text in a string", path: PROD, text: 'export const text = "import { IFoo as Foo } from x";\n' },
  {
    name: "rename in the compatibility file",
    path: COMPAT,
    text: 'import { IFoo as Foo } from "./a.ts";\nexport const x = Foo;\n',
  },
];
