/**
 * @module CeilingProjectTestHelper
 * @path packages/lint-policy/tests/helpers/ceiling_project.ts
 * @description Shared helper that writes an isolated project with one rule, a workspace with a Team member and an empty ceilings file, and runs the real ceiling reporter on it.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/god_objects_cutover_test.ts, packages/lint-policy/tests/module_size_gate_test.ts]
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import type { JsonValue } from "@dostark/unslop-ts";

/** One finished process. */
export interface IProcessRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The rule that the fixture project enables, by its bare key, with its options. */
export interface ICeilingRule {
  readonly key: string;
  readonly options: Readonly<Record<string, JsonValue>>;
}

/** One row of the ceiling report that is over its ceiling. */
export interface IOverRow {
  readonly packageName: string;
  readonly count: number;
}

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const ENGINE_MODULE = new URL("../../../../unslop-ts/mod.ts", import.meta.url).href;
const REPORTER = join(REPO_ROOT, "unslop-ts/src/cli/rule_report.ts");
const PLUGIN_NAME = "demo";

const DESCRIPTOR = `import { type IProjectDescriptor, TYPESCRIPT_RULE_PACK } from "@dostark/unslop-ts";

const rootUrl = new URL("./", import.meta.url);

export const descriptor: IProjectDescriptor = {
  pluginName: "${PLUGIN_NAME}",
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

/** Runs Deno in one directory and returns its output. */
export async function runDeno(args: readonly string[], cwd: string): Promise<IProcessRun> {
  const output = await new Deno.Command(Deno.execPath(), { args: [...args], cwd, stdout: "piped", stderr: "piped" })
    .output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
}

function catalogOf(rule: ICeilingRule): string {
  return JSON.stringify({
    version: 2,
    plugin: PLUGIN_NAME,
    extends: [],
    docsBase: "docs/",
    paths: { test: ["**/*_test.ts"], fixture: ["**/fixtures/**"], ignore: [] },
    rules: { [`${PLUGIN_NAME}/${rule.key}`]: { level: "error", options: rule.options } },
  });
}

/** Writes an isolated project with a Team workspace member and runs `body` in it. */
export async function withCeilingProject(
  rule: ICeilingRule,
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ceiling_project_" });
  try {
    const members = ["./packages/x", "./exaix-team/packages/y"];
    const config = { imports: { "@dostark/unslop-ts": ENGINE_MODULE }, lint: { plugins: ["./plugin.ts"] } };
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({ ...config, workspace: members }));
    for (const member of members) {
      await Deno.mkdir(join(dir, member), { recursive: true });
      await Deno.writeTextFile(join(dir, member, "deno.json"), "{}");
    }
    await Deno.writeTextFile(join(dir, "unslop.project.ts"), DESCRIPTOR);
    await Deno.writeTextFile(join(dir, "unslop.config.json"), catalogOf(rule));
    await Deno.writeTextFile(join(dir, "plugin.ts"), PLUGIN);
    await Deno.writeTextFile(join(dir, "rule_ceilings.json"), JSON.stringify({ [`${PLUGIN_NAME}/${rule.key}`]: {} }));
    for (const [path, text] of Object.entries(files)) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), text);
    }
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the ceiling reporter for the rule and returns the exit code and the rows over their ceiling. */
export async function gateOver(
  dir: string,
  key: string,
  roots: string,
): Promise<{ code: number; over: readonly IOverRow[] }> {
  const result = await runDeno([
    "run",
    "-A",
    REPORTER,
    `--rule=${PLUGIN_NAME}/${key}`,
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

/** The repository root, for tests that run a real task. */
export const CEILING_REPO_ROOT = REPO_ROOT;
