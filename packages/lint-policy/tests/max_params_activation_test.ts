/**
 * @module MaxParamsActivationTest
 * @path packages/lint-policy/tests/max_params_activation_test.ts
 * @description Proves that the seven-parameter rule runs in default lint: the boundary, the counting contract, every lint root, the authored policy and the repository itself, all through the real Deno CLI.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/helpers/activation_project.ts, packages/lint-policy/tests/activation_policy_test.ts]
 */

import { assertArrayIncludes, assertEquals, assertMatch, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { assertRuleEvidence } from "../../../unslop-ts/src/cli/rule_report.ts";
import { POLICY_CATALOG } from "../src/policy_config.ts";
import { CANARY_PATHS, REPO_ROOT, runPass, withActivationProject } from "./helpers/activation_project.ts";

const RULE = "exaix/max-params";
const HEADER = (path: string): string =>
  `/**\n * @module ParamsCanary\n * @path ${path}\n * @description Checks the parameter limit.\n * Usage: deno run ${path}\n */\n`;
const SHEBANG = "#!/usr/bin/env -S deno run -A\n";

/** The parameter names `a` to `h`, as many as asked for. */
function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(97 + index));
}

/** A module header and, for a script, the shebang that the shebang rule needs. */
function preamble(path: string): string {
  return (path.startsWith("scripts/") ? SHEBANG : "") + HEADER(path);
}

/** The sum of the first `count` parameters, so that no parameter is unused. */
function sumOf(count: number): string {
  return names(count).join(" + ");
}

/** A function with the given number of typed parameters. */
function functionWith(count: number): string {
  const params = names(count).map((name) => `${name}: number`).join(", ");
  return `export function probe(${params}): number {\n  return ${sumOf(count)};\n}\n`;
}

/** A class whose constructor has the given number of plain parameters. */
function constructorWith(count: number): string {
  const params = names(count).map((name) => `${name}: number`).join(", ");
  return `export class Probe {\n  total = 0;\n  constructor(${params}) {\n    this.total = ${sumOf(count)};\n  }\n}\n`;
}

/** Runs one pass with a canary and returns whether the parameter rule fired. */
async function fires(dir: string, path: string, body: string): Promise<boolean> {
  await Deno.mkdir(join(dir, path, ".."), { recursive: true });
  await Deno.writeTextFile(join(dir, path), preamble(path) + body);
  const result = await runPass(dir, path.startsWith("scripts/") ? "scripts" : "main");
  assertRuleEvidence({
    rule: RULE,
    runId: result.runId,
    stderr: result.stderr,
    checkedFiles: [toFileUrl(join(dir, path)).href],
    cwd: dir,
  });
  if (result.code === 0) return false;
  assertStringIncludes(result.stderr, `error[${RULE}]:`);
  assertStringIncludes(result.stderr, "must not exceed 7 parameters");
  return true;
}

Deno.test("max-params-default-boundary: default lint accepts seven and rejects eight parameters of a function and a constructor", async () => {
  await withActivationProject(async (dir) => {
    const path = "packages/core/src/params_canary.ts";
    assertEquals(await fires(dir, path, functionWith(7)), false);
    assertEquals(await fires(dir, path, functionWith(8)), true);
    assertEquals(await fires(dir, path, constructorWith(7)), false);
    assertEquals(await fires(dir, path, constructorWith(8)), true);
  });
});

Deno.test("max-params-counting-contract: methods, arrows, parameter properties, rest and erased this follow the engine contract", async () => {
  const params = (count: number): string => names(count).map((name) => `${name}: number`).join(", ");
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ["method of eight", `export class A {\n  run(${params(8)}): number {\n    return ${sumOf(8)};\n  }\n}\n`, true],
    ["arrow of eight", `export const probe = (${params(8)}): number => ${sumOf(8)};\n`, true],
    [
      "rest counts as one more",
      `export function probe(${params(7)}, ...rest: number[]): number {\n  return ${sumOf(7)} + rest.length;\n}\n`,
      true,
    ],
    [
      "parameter properties count",
      `export class A {\n  constructor(${names(8).map((name) => `readonly ${name}: number`).join(", ")}) {}\n}\n`,
      true,
    ],
    [
      "erased this is free",
      `export function probe(this: void, ${params(7)}): number {\n  return ${sumOf(7)};\n}\n`,
      false,
    ],
    [
      "an options object is one",
      `export interface IOptions {\n  a: number;\n  h: number;\n}\nexport function probe(options: IOptions): number {\n  return options.a + options.h;\n}\n`,
      false,
    ],
    [
      "an interface method signature is not counted",
      `export interface IShape {\n  run(${params(8)}): void;\n}\n`,
      false,
    ],
  ];
  await withActivationProject(async (dir) => {
    for (const [label, source, expected] of cases) {
      assertEquals(await fires(dir, "packages/core/src/params_canary.ts", source), expected, label);
    }
  });
});

Deno.test("max-params-default-roots: an unrecorded package, an app, Team, the enterprise tree, a test and a script are all rejected", async () => {
  await withActivationProject(async (dir) => {
    const paths = [...CANARY_PATHS, "packages/unrecorded/src/params_canary.ts", "apps/daemon/src/params_canary.ts"];
    for (const path of paths) {
      assertEquals(await fires(dir, path, functionWith(8)), true, `${path} accepted eight parameters`);
      assertEquals(await fires(dir, path, functionWith(7)), false, `${path} rejected seven parameters`);
    }
  });
});

Deno.test("max-params-active-policy: the authored policy is an error at seven with no opt-in, ceiling or parked entry", async () => {
  const entry = POLICY_CATALOG.rules[RULE];
  assertEquals(entry.severity, "error");
  assertEquals(entry.options?.max, 7);
  assertEquals(entry.optIn, undefined);
  assertEquals(entry.reason, undefined);
  const ceilings = JSON.parse(await Deno.readTextFile(new URL("packages/lint-policy/rule_ceilings.json", REPO_ROOT)));
  assertEquals(ceilings[RULE], undefined);
  const deno = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
  const scripts: string = deno.tasks.lint.split(" && ")[1];
  assertMatch(scripts, /EXAIX_LINT_RULES=[^ ]*exaix\/max-params/);
  const ports = JSON.parse(
    await Deno.readTextFile(new URL("packages/lint-policy/tests/fixtures/port/port_tables.json", REPO_ROOT)),
  );
  assertArrayIncludes(ports.scope.scriptsRunRules, [RULE]);
  const guide = await Deno.readTextFile(new URL("packages/lint-policy/docs/style_guide.md", REPO_ROOT));
  const parked = guide.slice(guide.indexOf("Parked plugin rules"), guide.indexOf("Script gates"));
  assertNotMatch(parked, /exaix\/max-params/);
  const plugin = guide.slice(guide.indexOf("Plugin gates"), guide.indexOf("Test-scoped plugin gates"));
  assertStringIncludes(plugin, "`exaix/max-params`");
});

Deno.test("max-params-repository-lint: the repository has no eight-parameter signature and deno task lint passes without an override", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "lint"],
    cwd: REPO_ROOT,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  assertEquals(result.code, 0, decoder.decode(result.stderr).slice(-3000));
  assertStringIncludes(decoder.decode(result.stderr), "exaix/max-params");
});
