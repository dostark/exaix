/**
 * @module BoundaryRulesCorpus
 * @path packages/lint-policy/tests/fixtures/port/boundary_rules_corpus.ts
 * @description Named source cases for the import boundary rules of the TUI, the CLI, and the packages, with the paths they pretend to live at.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/boundary_parity_test.ts]
 */

export interface IBoundaryCase {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const TUI = "apps/tui/src/views/a.ts";
const TUI_ROOT = "apps/tui/src/a.ts";
const TUI_TEST = "apps/tui/tests/a_test.ts";
const TUI_TEST_NESTED = "apps/tui/tests/sub/a_test.ts";
const CLI_COMMAND = "apps/exactl/src/commands/a.ts";
const CLI_HELPER = "apps/exactl/src/helpers/a.ts";
const CORE = "packages/core/src/a.ts";
const PACKAGE = "packages/x/src/a.ts";
const ENTRY = "packages/x/mod.ts";

function importing(specifier: string): string {
  return `import { a } from "${specifier}";\nexport const b = a;\n`;
}

export const BOUNDARY_RULES_CORPUS: readonly IBoundaryCase[] = [
  { name: "tui imports the cli", path: TUI, text: importing("../../cli/x.ts") },
  { name: "tui imports the retired services folder", path: TUI, text: importing("../services/x.ts") },
  { name: "tui imports the permitted adapters", path: TUI, text: importing("../services/adapters/x.ts") },
  {
    name: "tui imports the permitted service factory",
    path: TUI,
    text: importing("../services/tui_service_factory.ts"),
  },
  { name: "tui imports the retired config folder", path: TUI, text: importing("../config/x.ts") },
  { name: "tui helpers within the source root", path: TUI, text: importing("../helpers/x.ts") },
  { name: "tui helpers above the source root", path: TUI, text: importing("../../helpers/x.ts") },
  { name: "tui helpers from the source root", path: TUI_ROOT, text: importing("../helpers/x.ts") },
  { name: "tui test imports helpers above its root", path: TUI_TEST, text: importing("../helpers/x.ts") },
  { name: "tui test imports helpers within its root", path: TUI_TEST_NESTED, text: importing("../helpers/x.ts") },
  {
    name: "tui type import of the cli",
    path: TUI,
    text: 'import type { A } from "../../cli/x.ts";\nexport type B = A;\n',
  },
  {
    name: "tui import of the cli over lines",
    path: TUI,
    text: 'import {\n  a,\n  b,\n} from "../../cli/x.ts";\nexport const c = [a, b];\n',
  },
  { name: "tui re-export of the cli", path: TUI, text: 'export { a } from "../../cli/x.ts";\n' },
  {
    name: "tui import text in a comment",
    path: TUI,
    text: '// import { a } from "../../cli/x.ts";\nexport const b = 1;\n',
  },
  { name: "core imports the tui helpers", path: CORE, text: importing("../../../apps/tui/src/helpers/x.ts") },
  { name: "tui test imports its own helpers", path: TUI_TEST, text: importing("../../apps/tui/src/helpers/x.ts") },
  {
    name: "tui package test imports tui helpers",
    path: "packages/tui/tests/a_test.ts",
    text: importing("../../../apps/tui/src/helpers/x.ts"),
  },
  { name: "cli command imports the retired services folder", path: CLI_COMMAND, text: importing("../services/x.ts") },
  {
    name: "cli command imports the permitted adapters",
    path: CLI_COMMAND,
    text: importing("../services/adapters/x.ts"),
  },
  {
    name: "cli command imports the retired config service",
    path: CLI_COMMAND,
    text: importing("../config/service.ts"),
  },
  {
    name: "cli command imports the retired config service without extension",
    path: CLI_COMMAND,
    text: importing("../config/service"),
  },
  { name: "cli command imports another config module", path: CLI_COMMAND, text: importing("../config/other.ts") },
  { name: "cli helper imports the retired services folder", path: CLI_HELPER, text: importing("../services/x.ts") },
  {
    name: "cli handler imports the retired services folder",
    path: "apps/exactl/src/handlers/a.ts",
    text: importing("../services/x.ts"),
  },
  { name: "core imports the cli helpers", path: CORE, text: importing("../../../apps/exactl/src/helpers/x.ts") },
  { name: "cli file imports its own helpers", path: "apps/exactl/src/a.ts", text: importing("../src/helpers/x.ts") },
  { name: "package imports a retired root path", path: PACKAGE, text: importing("../../../src/services/core/db.ts") },
  {
    name: "package imports a retired root path by bare path",
    path: PACKAGE,
    text: importing("src/services/core/db.ts"),
  },
  { name: "package imports another root path", path: PACKAGE, text: importing("../../../src/services/other.ts") },
  {
    name: "app imports a retired root path",
    path: "apps/daemon/src/a.ts",
    text: importing("../../../src/services/core/db.ts"),
  },
  { name: "package imports from tests", path: PACKAGE, text: importing("../../../tests/helpers/x.ts") },
  { name: "app imports from tests", path: "apps/daemon/src/a.ts", text: importing("../../../tests/x.ts") },
  {
    name: "team package imports from tests",
    path: "exaix-team/packages/x/src/a.ts",
    text: importing("../../../../tests/x.ts"),
  },
  {
    name: "package test imports from tests",
    path: "packages/x/tests/a_test.ts",
    text: importing("../../../tests/x.ts"),
  },
  {
    name: "testing package imports from tests",
    path: "packages/testing/src/a.ts",
    text: importing("../../../tests/x.ts"),
  },
  {
    name: "testing folder imports from tests",
    path: "packages/x/src/testing/a.ts",
    text: importing("../../../../tests/x.ts"),
  },
  { name: "package imports an alias", path: PACKAGE, text: importing("@exaix/core/types") },
  { name: "package imports a url", path: PACKAGE, text: importing("https://example.com/tests/x.ts") },
  { name: "package imports tests by bare path", path: PACKAGE, text: importing("tests/x.ts") },
  { name: "entrypoint re-exports a retired src path", path: ENTRY, text: "export { Foo } from '../src/foo.ts';\n" },
  { name: "entrypoint re-exports a bare src path", path: ENTRY, text: 'export { Foo } from "src/foo.ts";\n' },
  { name: "entrypoint re-exports a sibling", path: ENTRY, text: 'export { Foo } from "./foo.ts";\n' },
  {
    name: "index entrypoint re-exports a retired src path",
    path: "packages/x/index.ts",
    text: "export * from '../src/foo.ts';\n",
  },
  {
    name: "non-entrypoint re-exports a retired src path",
    path: PACKAGE,
    text: "export { Foo } from '../src/foo.ts';\n",
  },
  { name: "core imports a retired tui helpers path", path: CORE, text: importing("../../tui/helpers/x.ts") },
  { name: "tui test imports a retired tui helpers path", path: TUI_TEST, text: importing("../../tui/helpers/x.ts") },
  {
    name: "scenario tui test imports a retired tui helpers path",
    path: "tests/tui/a_test.ts",
    text: importing("../../tui/helpers/x.ts"),
  },
  {
    name: "tui package test imports a retired tui helpers path",
    path: "packages/tui/tests/a_test.ts",
    text: importing("../../tui/helpers/x.ts"),
  },
  {
    name: "quality gate module imports scenario tests",
    path: "packages/quality-gate/src/foo.ts",
    text: importing("../../../tests/scenario_framework/runner/history_sqlite.ts"),
  },
  {
    name: "exactl command imports scenario tests",
    path: "apps/exactl/src/commands/eval_commands.ts",
    text: importing("../../../../tests/scenario_framework/runner/history_sqlite.ts"),
  },
  {
    name: "team module imports root tests",
    path: "exaix-team/voting/src/bar.ts",
    text: importing("../../../tests/helpers/x.ts"),
  },
  {
    name: "package test imports root tests helpers",
    path: "packages/quality-gate/tests/foo_test.ts",
    text: importing("../../../tests/helpers/x.ts"),
  },
  {
    name: "app test imports root tests fixtures",
    path: "apps/exactl/tests/eval_commands_test.ts",
    text: importing("../../../tests/fixtures/y.ts"),
  },
  {
    name: "exactl command imports a package alias",
    path: "apps/exactl/src/commands/eval_commands.ts",
    text: importing("@exaix/eval-history"),
  },
  {
    name: "package module imports a core module",
    path: "packages/quality-gate/src/foo.ts",
    text: importing("../../core/mod.ts"),
  },
  {
    name: "testing package bridges to tests",
    path: "packages/testing/mod.ts",
    text: importing("../../tests/integration/helpers/test_environment.ts"),
  },
  {
    name: "testing shim bridges to tests",
    path: "packages/git/testing/mod.ts",
    text: importing("../../../tests/fixtures/x.ts"),
  },
  { name: "script imports root tests", path: "scripts/foo.ts", text: importing("../tests/helpers/x.ts") },
  {
    name: "root test imports a sibling",
    path: "tests/scenario_framework/runner/main.ts",
    text: importing("./history_sqlite.ts"),
  },
];
