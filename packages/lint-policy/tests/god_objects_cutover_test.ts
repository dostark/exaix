/**
 * @module GodObjectsCutoverTest
 * @path packages/lint-policy/tests/god_objects_cutover_test.ts
 * @description Proves the god-class cutover: the Exaix catalog uses the God Class strategy, the task gates per-package ceilings over every linted root including Team, and the compare task lists the classes that only one strategy flags.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/complexity_cutover_test.ts, scripts/god_objects_compare.ts, packages/lint-policy/rule_ceilings.json]
 */

import { assert, assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { POLICY_CATALOG } from "../src/policy_config.ts";
import { GOD, godClassSource } from "../../../unslop-ts/tests/helpers/god_class_fixture.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const ENGINE_MODULE = new URL("../../../unslop-ts/mod.ts", import.meta.url).href;
const REPORTER = join(REPO_ROOT, "unslop-ts/src/cli/rule_report.ts");
const COMPARE = join(REPO_ROOT, "scripts/god_objects_compare.ts");
const RULE = "demo/max-class-size";
const GOD_CLASS = "god-class";
const SMALL_CLASS =
  "export class Small {\n  one(): number {\n    return 1;\n  }\n  two(): number {\n    return 2;\n  }\n}\n";

const DESCRIPTOR = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "demo",
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("plugin.ts", rootUrl),
  packs: [TYPESCRIPT_RULE_PACK],
  scriptRules: {},
  wholeTreeHosts: {},
};
`;

const PLUGIN = `import { createUnslopProject } from "@dostark/unslop-ts/deno";
import { descriptor } from "./unslop.project.ts";
import config from "./unslop.config.json" with { type: "json" };

export default createUnslopProject({ descriptor, config }).plugin;
`;

interface IRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface IOverRow {
  readonly packageName: string;
  readonly count: number;
}

async function runDeno(args: readonly string[], cwd: string): Promise<IRun> {
  const output = await new Deno.Command(Deno.execPath(), { args: [...args], cwd, stdout: "piped", stderr: "piped" })
    .output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

/** The version 2 catalog that selects one strategy and makes the legacy score flag every class. */
function catalog(strategy: string): string {
  const options = { strategy, minClassLines: 1, threshold: 1 };
  return JSON.stringify({
    version: 2,
    plugin: "demo",
    extends: [],
    docsBase: "docs/",
    paths: { test: ["**/*_test.ts"], fixture: ["**/fixtures/**"], ignore: [] },
    rules: { [RULE]: { level: "error", options } },
  });
}

/** Writes an isolated project with a Team workspace member and runs `body` in it. */
async function withGodProject(
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<void>,
  strategy = GOD_CLASS,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "god_objects_" });
  try {
    const members = ["./packages/x", "./exaix-team/packages/y"];
    const config = { imports: { "@dostark/unslop-ts": ENGINE_MODULE }, lint: { plugins: ["./plugin.ts"] } };
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({ ...config, workspace: members }));
    for (const member of members) {
      await Deno.mkdir(join(dir, member), { recursive: true });
      await Deno.writeTextFile(
        join(dir, member, "deno.json"),
        "{}",
      );
    }
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), catalog(strategy));
    await Deno.writeTextFile(join(dir, "plugin.ts"), PLUGIN);
    await Deno.writeTextFile(join(dir, "rule_ceilings.json"), JSON.stringify({ [RULE]: {} }));
    for (const [path, text] of Object.entries(files)) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), text);
    }
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the ceiling reporter on the fixture and returns the exit code and the rows over their ceiling. */
async function gate(dir: string, roots: string): Promise<{ code: number; over: readonly IOverRow[] }> {
  const result = await runDeno([
    "run",
    "-A",
    REPORTER,
    `--rule=${RULE}`,
    `--roots=${roots}`,
    "--descriptor=unslop.project.ts",
    "--ceilings=rule_ceilings.json",
    "--json",
    "--fail",
  ], dir);
  assert(result.stdout.length > 0, result.stderr);
  const report: { ceilings: { over: readonly IOverRow[] } } = JSON.parse(result.stdout);
  return { code: result.code, over: report.ceilings.over };
}

function hub(name: string): string {
  return `import type { Other } from "./other.ts";\n${
    godClassSource(GOD).replace("class Hub", `export class ${name}`)
  }`;
}

Deno.test("god-objects-cutover: the Exaix catalog selects the God Class strategy", () => {
  assertEquals(POLICY_CATALOG.rules["exaix/max-class-size"].options?.strategy, GOD_CLASS);
});

Deno.test("god-objects-cutover: a seeded god class raises its package over the ceiling and the gate exits 1", async () => {
  await withGodProject({ "packages/x/src/hub.ts": hub("Hub") }, async (dir) => {
    const over = await gate(dir, "packages");
    assertEquals(over.code, 1);
    assertEquals(over.over.map((row) => [row.packageName, row.count]), [["packages/x", 1]]);
    await Deno.writeTextFile(join(dir, "rule_ceilings.json"), JSON.stringify({ [RULE]: { "packages/x": 1 } }));
    assertEquals((await gate(dir, "packages")).code, 0);
  });
});

Deno.test("god-objects-cutover: deno task check:god-objects exits 0 on the branch", async () => {
  const result = await runDeno(["task", "check:god-objects"], REPO_ROOT);
  assertEquals(result.code, 0, result.stderr.slice(-2000));
});

Deno.test("god-objects-team-root: a god class in a Team package and one in a tests directory each fail and name their package", async () => {
  const files = {
    "exaix-team/packages/y/src/hub.ts": hub("TeamHub"),
    "tests/hub.ts": hub("TestHub"),
    "packages/x/src/small.ts": SMALL_CLASS,
  };
  await withGodProject(files, async (dir) => {
    const found = await gate(dir, "packages,tests,exaix-team");
    assertEquals(found.code, 1);
    assertEquals(found.over.map((row) => row.packageName).sort(), [".", "exaix-team/packages/y"]);
  });
});

Deno.test("god-objects-compare: the compare task lists the classes that only one strategy flags and leaves the config untouched", async () => {
  await withGodProject({ "packages/x/src/hub.ts": hub("Hub"), "packages/x/src/small.ts": SMALL_CLASS }, async (dir) => {
    const before = await Deno.readTextFile(join(dir, "unslop.config.json"));
    const result = await runDeno([
      "run",
      "-A",
      COMPARE,
      `--rule=${RULE}`,
      "--roots=packages",
      "--descriptor=unslop.project.ts",
      "--ceilings=rule_ceilings.json",
    ], dir);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "Only legacy-score");
    const [, onlyLegacy] = result.stdout.split("Only legacy-score");
    assertStringIncludes(onlyLegacy, "Small");
    assertNotMatch(onlyLegacy, /Hub/);
    const [bothSection] = result.stdout.split("Only god-class");
    assertStringIncludes(bothSection, "Hub");
    assertEquals(await Deno.readTextFile(join(dir, "unslop.config.json")), before);
  });
});
