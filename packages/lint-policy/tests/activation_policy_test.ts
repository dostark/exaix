/**
 * @module ActivationPolicyTest
 * @path packages/lint-policy/tests/activation_policy_test.ts
 * @description Verifies atomic rule activation and the authored lint task through the real CLI.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/lint-policy/tests/rule_ceilings_test.ts]
 */

import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { assertRuleEvidence } from "../../../unslop-ts/src/cli/rule_report.ts";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const ACTIVE_PLUGIN_IDS = [
  "ignore-needs-reason",
  "max-cyclomatic-complexity",
  "max-cognitive-complexity",
  "max-function-lines",
  "no-pass-through-type-alias",
  "promise-response-alias",
  "ts-suppression-pragmas",
  "no-forbidden-lint-ignore",
  "import-inside-statement",
  "dynamic-import",
  "inline-type-import",
  "unslop-isolation",
  "import-boundaries",
  "require-module-header",
  "exported-interface-naming",
  "ephemeral-filename",
  "decorative-comment",
  "require-deno-shebang",
  "require-script-usage",
  "no-chained-type-assertions",
  "barrel-only-reexports",
  "import-placement",
  "re-export-imported",
  "exported-interface-placement",
  "no-interface-rename-on-import",
].map((key) => `exaix/${key}`);

Deno.test("atomic-policy-transition: independent active plugin IDs include only delivered rules", () => {
  const actual = Object.entries(POLICY_CATALOG.rules)
    .filter(([, entry]) => entry.engine === "plugin" && entry.severity === "error")
    .map(([id]) => id).sort();
  assertEquals(actual, ACTIVE_PLUGIN_IDS.toSorted());
  const entry = POLICY_CATALOG.rules["exaix/import-placement"];
  assertEquals(entry.scope, "all");
  assertEquals(entry.optIn, undefined);
  assertEquals(entry.reason, undefined);
});

const REPO_ROOT = new URL("../../../", import.meta.url);
const RULE = "exaix/import-placement";
const IMPORT_INTERFACE_RULES = ["re-export-imported", "exported-interface-placement", "no-interface-rename-on-import"];
const CLI_TIMEOUT_MS = 30_000;

/** Writes a clean or misplaced import with the authored module header. */
function sourceOf(path: string, misplaced: boolean): string {
  const header =
    `/**\n * @module ActivationCanary\n * @path ${path}\n * @description Checks the import placement gate.\n * Usage: deno run ${path}\n */\n`;
  const declaration = "export const before = 1;\n";
  const imported = 'import { value } from "./support.ts";\n';
  const body = misplaced ? declaration + imported : imported + declaration;
  const shebang = path.startsWith("scripts/") ? "#!/usr/bin/env -S deno run -A\n" : "";
  return shebang + header + body + "export const after = value;\n";
}

/** Copies the authored policy and task passes into an isolated project. */
async function withActivationProject(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "activation_policy_" });
  try {
    const authored = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
    const passes = authored.tasks.lint.split(" && ");
    assertEquals(passes.length, 2);
    const imports: Record<string, string> = {};
    for (const [key, value] of Object.entries<string>(authored.imports)) {
      imports[key] = value.startsWith(".") ? new URL(value, REPO_ROOT).href : value;
    }
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        imports,
        lint: { plugins: ["./plugin.ts"] },
        tasks: { "lint:main": passes[0], "lint:scripts": passes[1] },
      }),
    );
    await Deno.copyFile(new URL("unslop.config.json", REPO_ROOT), join(dir, "unslop.config.json"));
    const descriptor = new URL("packages/lint-policy/unslop.project.ts", REPO_ROOT).href;
    const engine = new URL("unslop-ts/deno.ts", REPO_ROOT).href;
    const plugin = `import { createUnslopProject } from "${engine}";
import { descriptor as authored } from "${descriptor}";
import config from "./unslop.config.json" with { type: "json" };
const rootUrl = new URL("./", import.meta.url);
const descriptor = { ...authored, rootUrl, configUrl: new URL("unslop.config.json", rootUrl), lintConfigUrl: new URL("deno.json", rootUrl), pluginUrl: new URL("plugin.ts", rootUrl) };
export default createUnslopProject({ descriptor, config }).plugin;
`;
    await Deno.writeTextFile(join(dir, "plugin.ts"), plugin);
    for (
      const folder of [
        "packages/core/src",
        "packages/core/tests",
        "tests",
        "apps/daemon/src",
        "exaix-team/packages/ai/tests",
        "scripts",
      ]
    ) {
      await Deno.mkdir(join(dir, folder), { recursive: true });
      const support = join(folder, "support.ts");
      const shebang = support.startsWith("scripts/") ? "#!/usr/bin/env -S deno run -A\n" : "";
      await Deno.writeTextFile(
        join(dir, support),
        `${shebang}/**\n * @module ActivationSupport\n * @path ${support}\n * @description Supplies the canary value.\n * Usage: deno run ${support}\n */\nexport interface IProbe { value: number; }\nexport const value = 1;\n`,
      );
    }
    const fixture = "packages/core/tests/fixtures";
    await Deno.mkdir(join(dir, fixture), { recursive: true });
    await Deno.writeTextFile(join(dir, fixture, "support.ts"), "export const value = 1;\n");
    await Deno.writeTextFile(join(dir, fixture, "canary.ts"), sourceOf(`${fixture}/canary.ts`, true));
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs an authored task with a caller selector that must not narrow the default pass. */
async function runPass(
  dir: string,
  pass: string,
): Promise<{ code: number; stdout: string; stderr: string; runId: string }> {
  const runId = crypto.randomUUID();
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", `lint:${pass}`],
    cwd: dir,
    env: { EXAIX_LINT_RULES: "exaix/no-pass-through-type-alias", EXAIX_LINT_TRACE: runId, NO_COLOR: "1" },
    signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, stdout: decoder.decode(result.stdout), stderr: decoder.decode(result.stderr), runId };
}

Deno.test("default-import-placement: authored passes reject each applicable root and accept clean imports", async () => {
  await withActivationProject(async (dir) => {
    for (
      const path of [
        "packages/core/src/canary.ts",
        "packages/core/tests/canary_test.ts",
        "tests/canary_test.ts",
        "exaix-team/packages/ai/tests/canary_test.ts",
        "scripts/canary.ts",
        "scripts/canary_test.ts",
      ]
    ) {
      await Deno.writeTextFile(join(dir, path), sourceOf(path, true));
      const pass = path.startsWith("scripts/") ? "scripts" : "main";
      const failed = await runPass(dir, pass);
      assertEquals(failed.code, 1, failed.stderr);
      assertStringIncludes(failed.stderr, `error[${RULE}]:`);
      assertRuleEvidence({
        rule: RULE,
        runId: failed.runId,
        stderr: failed.stderr,
        checkedFiles: [toFileUrl(join(dir, path)).href],
        cwd: dir,
      });
      await Deno.writeTextFile(join(dir, path), sourceOf(path, false));
      const clean = await runPass(dir, pass);
      assertEquals(clean.code, 0, clean.stderr);
      assertRuleEvidence({
        rule: RULE,
        runId: clean.runId,
        stderr: clean.stderr,
        checkedFiles: [toFileUrl(join(dir, path)).href],
        cwd: dir,
      });
    }
  });
});

Deno.test("default-import-placement: missing plugin and inactive policy invalidate clean acceptance", async () => {
  await withActivationProject(async (dir) => {
    const path = "packages/core/src/canary.ts";
    await Deno.writeTextFile(join(dir, path), sourceOf(path, true));
    const configPath = join(dir, "unslop.config.json");
    const policy = JSON.parse(await Deno.readTextFile(configPath));
    policy.rules[RULE].level = "off";
    policy.rules[RULE].optIn = true;
    policy.rules[RULE].reason = "Negative activation control.";
    await Deno.writeTextFile(configPath, JSON.stringify(policy));
    const inactive = await runPass(dir, "main");
    assertEquals(inactive.code, 0, inactive.stderr);
    assertThrows(
      () =>
        assertRuleEvidence({
          rule: RULE,
          runId: inactive.runId,
          stderr: inactive.stderr,
          checkedFiles: [path],
          cwd: dir,
        }),
      Error,
      "did not evaluate",
    );
    const config = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    config.lint.plugins = [];
    await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(config));
    const missing = await runPass(dir, "main");
    assertThrows(
      () =>
        assertRuleEvidence({
          rule: RULE,
          runId: missing.runId,
          stderr: missing.stderr,
          checkedFiles: [path],
          cwd: dir,
        }),
      Error,
      "no observation",
    );
  });
});

Deno.test("atomic-policy-transition: scripts select the active rule and its parked ceiling is absent", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
  const scripts = config.tasks.lint.split(" && ")[1];
  const selected = scripts.match(/^EXAIX_LINT_RULES=([^ ]+)/)[1].split(",");
  const delivered = [RULE, ...IMPORT_INTERFACE_RULES.map((key) => `exaix/${key}`)];
  assertArrayIncludes(selected, delivered);
  for (const id of selected) assertEquals(POLICY_CATALOG.rules[id].severity, "error", id);
  const ceilings = JSON.parse(await Deno.readTextFile(new URL("packages/lint-policy/rule_ceilings.json", REPO_ROOT)));
  for (const id of delivered) {
    assertEquals(ceilings[id], undefined, id);
    assertEquals(POLICY_CATALOG.rules[id].scope, "all", id);
    assertEquals(POLICY_CATALOG.rules[id].optIn, undefined, id);
    assertEquals(POLICY_CATALOG.rules[id].reason, undefined, id);
  }
  const parked = [
    "long-comment",
    "ephemeral-comment",
    "test-inline-multiline-fixture",
    "no-constant-substring-assert",
    "promise-response-return",
    "magic-union-type",
    "no-object-parameters",
    "no-unsafe-dictionary",
    "no-typeof-escape",
    "no-explicit-unknown",
    "no-repeated-assert-call",
    "no-boolean-assert",
  ];
  for (const key of parked) {
    const id = `exaix/${key}`;
    assertEquals(POLICY_CATALOG.rules[id].severity, "off", id);
    assert(POLICY_CATALOG.rules[id].optIn, id);
    assertExists(ceilings[id], id);
  }
});

/** One rule's violation or clean counterpart, with imports kept first. */
function importInterfaceSource(path: string, key: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  if (key === "re-export-imported") {
    const exported = violation ? "export { value };\n" : "export const ownValue = value;\n";
    return header + 'import { value } from "./support.ts";\n' + exported;
  }
  if (key === "exported-interface-placement") {
    const shape = "export interface ICanary { value: number; }\n";
    const value = "export const ownValue = 1;\n";
    return header + (violation ? value + shape : shape + value);
  }
  const name = violation ? "IRenamedProbe" : "IProbe";
  const imported = violation ? "IProbe as IRenamedProbe" : "IProbe";
  return header + `import type { ${imported} } from "./support.ts";\nexport const ownValue: ${name} = { value: 1 };\n`;
}

Deno.test("default-import-interface-gates: exact rule canaries and clean controls reach both authored passes", async () => {
  await withActivationProject(async (dir) => {
    for (const key of IMPORT_INTERFACE_RULES) {
      const rule = `exaix/${key}`;
      for (
        const path of [
          "packages/core/src/canary.ts",
          "packages/core/tests/canary_test.ts",
          "tests/canary_test.ts",
          "exaix-team/packages/ai/tests/canary_test.ts",
          "scripts/canary.ts",
          "scripts/canary_test.ts",
        ]
      ) {
        await Deno.writeTextFile(join(dir, path), importInterfaceSource(path, key, true));
        const pass = path.startsWith("scripts/") ? "scripts" : "main";
        const failed = await runPass(dir, pass);
        assertEquals(failed.code, 1, failed.stderr);
        assertStringIncludes(failed.stderr, `error[${rule}]:`);
        assertRuleEvidence({
          rule,
          runId: failed.runId,
          stderr: failed.stderr,
          checkedFiles: [toFileUrl(join(dir, path)).href],
          cwd: dir,
        });
        await Deno.writeTextFile(join(dir, path), importInterfaceSource(path, key, false));
        const clean = await runPass(dir, pass);
        assertEquals(clean.code, 0, clean.stderr);
        assertRuleEvidence({
          rule,
          runId: clean.runId,
          stderr: clean.stderr,
          checkedFiles: [toFileUrl(join(dir, path)).href],
          cwd: dir,
        });
      }
    }
  });
});

Deno.test("default-import-interface-gates: package entry points, helpers and the markdown exception remain valid", async () => {
  await withActivationProject(async (dir) => {
    for (const name of ["mod.ts", "index.ts"]) {
      const path = `packages/core/src/${name}`;
      const header = sourceOf(path, false).split("import { value }")[0];
      await Deno.writeTextFile(join(dir, path), header + 'export { value } from "./support.ts";\n');
    }
    const helper = "tests/helpers/allowed.ts";
    await Deno.mkdir(join(dir, "tests/helpers"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, helper),
      sourceOf(helper, false).split("import { value }")[0] + 'export { value } from "../support.ts";\n',
    );
    const markdown = "packages/core/src/parsing/markdown.ts";
    await Deno.mkdir(join(dir, "packages/core/src/parsing"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, markdown),
      importInterfaceSource(markdown, "no-interface-rename-on-import", true).replace(
        '"./support.ts"',
        '"../support.ts"',
      ),
    );
    const result = await runPass(dir, "main");
    assertEquals(result.code, 0, result.stderr);
    for (const key of IMPORT_INTERFACE_RULES) {
      assertRuleEvidence({
        rule: `exaix/${key}`,
        runId: result.runId,
        stderr: result.stderr,
        checkedFiles: [],
        cwd: dir,
      });
    }
  });
});
