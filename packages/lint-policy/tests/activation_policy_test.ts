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
import { globToRegExp, join, toFileUrl } from "@std/path";
import { assertRuleEvidence } from "../../../unslop-ts/src/cli/rule_report.ts";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const ACTIVE_PLUGIN_IDS = [
  "exaix/ignore-needs-reason",
  "exaix/max-cyclomatic-complexity",
  "exaix/max-cognitive-complexity",
  "exaix/max-function-lines",
  "exaix/no-pass-through-type-alias",
  "exaix/promise-response-alias",
  "exaix/ts-suppression-pragmas",
  "exaix/no-forbidden-lint-ignore",
  "exaix/import-inside-statement",
  "exaix/dynamic-import",
  "exaix/inline-type-import",
  "exaix/unslop-isolation",
  "exaix/import-boundaries",
  "exaix/require-module-header",
  "exaix/exported-interface-naming",
  "exaix/ephemeral-filename",
  "exaix/decorative-comment",
  "exaix/require-deno-shebang",
  "exaix/require-script-usage",
  "exaix/no-chained-type-assertions",
  "exaix/barrel-only-reexports",
  "exaix/import-placement",
  "exaix/re-export-imported",
  "exaix/exported-interface-placement",
  "exaix/no-interface-rename-on-import",
  "exaix/long-comment",
  "exaix/ephemeral-comment",
  "exaix/test-inline-multiline-fixture",
  "exaix/no-constant-substring-assert",
  "exaix/promise-response-return",
  "exaix/magic-union-type",
  "exaix/no-object-parameters",
  "exaix/no-unsafe-dictionary",
  "exaix/no-typeof-escape",
  "exaix/no-explicit-unknown",
  "exaix/no-repeated-assert-call",
];

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
const IMPORT_INTERFACE_RULES = [
  "exaix/re-export-imported",
  "exaix/exported-interface-placement",
  "exaix/no-interface-rename-on-import",
];
const COMMENT_FIXTURE_RULES = [
  "exaix/long-comment",
  "exaix/ephemeral-comment",
  "exaix/test-inline-multiline-fixture",
];
const BOUNDARY_RULES = ["exaix/no-object-parameters", "exaix/no-unsafe-dictionary"];
const TYPEOF_RULES = ["exaix/no-typeof-escape"];
const UNKNOWN_RULES = ["exaix/no-explicit-unknown"];
const REPEATED_RULES = ["exaix/no-repeated-assert-call"];
const CONTRACT_RULES = [
  "exaix/no-constant-substring-assert",
  "exaix/promise-response-return",
  "exaix/magic-union-type",
];
const CLI_TIMEOUT_MS = 30_000;
const EXPECTED_SCOPE: Readonly<Record<string, string>> = {
  "exaix/test-inline-multiline-fixture": "test",
  "exaix/no-constant-substring-assert": "test",
  "exaix/magic-union-type": "prod",
  "exaix/no-repeated-assert-call": "test",
};
const CANARY_PATHS = [
  "packages/core/src/canary.ts",
  "packages/core/tests/canary_test.ts",
  "tests/canary_test.ts",
  "exaix-team/packages/ai/tests/canary_test.ts",
  "exaix-enterprise/packages/enterprise-placeholder/canary.ts",
  "exaix-enterprise/packages/enterprise-placeholder/canary_test.ts",
  "scripts/canary.ts",
  "scripts/canary_test.ts",
];

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
        "exaix-enterprise/packages/enterprise-placeholder",
        "scripts",
      ]
    ) {
      await Deno.mkdir(join(dir, folder), { recursive: true });
      const support = join(folder, "support.ts");
      const shebang = support.startsWith("scripts/") ? "#!/usr/bin/env -S deno run -A\n" : "";
      await Deno.writeTextFile(
        join(dir, support),
        `${shebang}/**\n * @module ActivationSupport\n * @path ${support}\n * @description Supplies the canary value.\n * Usage: deno run ${support}\n */\nexport interface IProbe { value: number; }\nexport const value = 1;\nexport const SUBJECT = \"part of the subject\";\n`,
      );
    }
    const enterprise = "exaix-enterprise";
    await Deno.writeTextFile(
      join(dir, enterprise, "deno.json"),
      JSON.stringify({ workspace: ["./packages/enterprise-placeholder"] }),
    );
    await Deno.writeTextFile(
      join(dir, enterprise, "packages/enterprise-placeholder/deno.json"),
      JSON.stringify({ name: "@exaix-enterprise/enterprise-placeholder", version: "0.1.0", exports: "./support.ts" }),
    );
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
    for (const path of CANARY_PATHS) {
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
  const delivered = [
    RULE,
    ...IMPORT_INTERFACE_RULES,
    ...COMMENT_FIXTURE_RULES,
    ...CONTRACT_RULES,
    ...BOUNDARY_RULES,
    ...TYPEOF_RULES,
    ...UNKNOWN_RULES,
    ...REPEATED_RULES,
  ];
  assertArrayIncludes(selected, delivered);
  for (const id of selected) assertEquals(POLICY_CATALOG.rules[id].severity, "error", id);
  const ceilings = JSON.parse(await Deno.readTextFile(new URL("packages/lint-policy/rule_ceilings.json", REPO_ROOT)));
  for (const id of delivered) {
    assertEquals(ceilings[id], undefined, id);
    assertEquals(POLICY_CATALOG.rules[id].scope, EXPECTED_SCOPE[id] ?? "all", id);
    assertEquals(POLICY_CATALOG.rules[id].optIn, undefined, id);
    assertEquals(POLICY_CATALOG.rules[id].reason, undefined, id);
  }
  const parked = [
    "exaix/no-boolean-assert",
  ];
  for (const id of parked) {
    assertEquals(POLICY_CATALOG.rules[id].severity, "off", id);
    assert(POLICY_CATALOG.rules[id].optIn, id);
    assertExists(ceilings[id], id);
  }
});

/** One rule's violation or clean counterpart, with imports kept first. */
function importInterfaceSource(path: string, rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  if (rule === "exaix/re-export-imported") {
    const exported = violation ? "export { value };\n" : "export const ownValue = value;\n";
    return header + 'import { value } from "./support.ts";\n' + exported;
  }
  if (rule === "exaix/exported-interface-placement") {
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
    for (const rule of IMPORT_INTERFACE_RULES) {
      for (const path of CANARY_PATHS) {
        await Deno.writeTextFile(join(dir, path), importInterfaceSource(path, rule, true));
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
        await Deno.writeTextFile(join(dir, path), importInterfaceSource(path, rule, false));
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
      importInterfaceSource(markdown, "exaix/no-interface-rename-on-import", true).replace(
        '"./support.ts"',
        '"../support.ts"',
      ),
    );
    const result = await runPass(dir, "main");
    assertEquals(result.code, 0, result.stderr);
    for (const rule of IMPORT_INTERFACE_RULES) {
      assertRuleEvidence({
        rule,
        runId: result.runId,
        stderr: result.stderr,
        checkedFiles: [],
        cwd: dir,
      });
    }
  });
});

/** One comment or fixture rule's violation or clean counterpart below the authored module header. */
function commentFixtureSource(path: string, rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  if (rule === "exaix/long-comment") {
    const lines = violation ? ["one", "two", "three", "four"] : ["one", "two", "three"];
    return header + "export const first = 1;\n" + lines.map((line) => `// ${line}\n`).join("") +
      "export const second = 2;\n";
  }
  if (rule === "exaix/ephemeral-comment") {
    const note = violation ? "we tried a loop first" : "The loop keeps the order stable";
    return header + `export const first = 1;\n// ${note}\nexport const second = 2;\n`;
  }
  const rows = violation ? 7 : 6;
  const body = Array.from({ length: rows }, (_, index) => `k${index}: ${index}`).join("\n");
  return header + `export const yaml = \`\n${body}\n\`;\n`;
}

/** True when the rule's compiled scope covers the canary path. */
function inScope(rule: string, path: string): boolean {
  const scope = POLICY_CATALOG.rules[rule].scope;
  if (scope === "all") return true;
  return /_test\.ts$/.test(path) === (scope === "test");
}

/** Runs each rule's violation and clean source through every canary path and both authored passes. */
async function assertCanaryMatrix(
  rules: readonly string[],
  build: (path: string, rule: string, violation: boolean) => string,
): Promise<void> {
  await withActivationProject(async (dir) => {
    for (const rule of rules) {
      for (const path of CANARY_PATHS) {
        const pass = path.startsWith("scripts/") ? "scripts" : "main";
        const evidence = (run: { runId: string; stderr: string }) =>
          assertRuleEvidence({
            rule,
            runId: run.runId,
            stderr: run.stderr,
            checkedFiles: [toFileUrl(join(dir, path)).href],
            cwd: dir,
          });
        await Deno.writeTextFile(join(dir, path), build(path, rule, true));
        const seeded = await runPass(dir, pass);
        const covered = inScope(rule, path);
        if (covered) {
          assertEquals(seeded.code, 1, `${rule} ${path}: ${seeded.stderr}`);
          assertStringIncludes(seeded.stderr, `error[${rule}]:`);
          evidence(seeded);
        } else {
          assertEquals(seeded.code, 0, `${rule} ${path}: ${seeded.stderr}`);
        }
        await Deno.writeTextFile(join(dir, path), build(path, rule, false));
        const clean = await runPass(dir, pass);
        assertEquals(clean.code, 0, `${rule} ${path}: ${clean.stderr}`);
        if (covered) evidence(clean);
      }
    }
  });
}

Deno.test("default-comment-fixture-gates: exact canaries fail and clean or out-of-scope controls pass in both passes", async () => {
  await assertCanaryMatrix(COMMENT_FIXTURE_RULES, commentFixtureSource);
});

Deno.test("default-comment-fixture-gates: module headers and fixture folders stay exempt", async () => {
  await withActivationProject(async (dir) => {
    const header = sourceOf("packages/core/src/header.ts", false).split("import { value }")[0];
    assert(header.split("\n").length > 3);
    await Deno.writeTextFile(join(dir, "packages/core/src/header.ts"), header + "export const first = 1;\n");
    const fixture = "packages/core/tests/fixtures/canary_test.ts";
    await Deno.writeTextFile(
      join(dir, fixture),
      commentFixtureSource(fixture, "exaix/test-inline-multiline-fixture", true),
    );
    const result = await runPass(dir, "main");
    assertEquals(result.code, 0, result.stderr);
    for (const rule of COMMENT_FIXTURE_RULES) {
      assertRuleEvidence({
        rule,
        runId: result.runId,
        stderr: result.stderr,
        checkedFiles: [],
        cwd: dir,
      });
    }
  });
});

/** One substring, return or union rule's violation or clean counterpart below the authored module header. */
function contractSource(path: string, rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  if (rule === "exaix/no-constant-substring-assert") {
    const imports = 'import { assertStringIncludes } from "@std/assert";\nimport { SUBJECT } from "./support.ts";\n';
    const local = violation ? "" : 'const message = "part of the subject";\n';
    const subject = violation ? "SUBJECT" : "message";
    return header + imports + local +
      `export function check(): void {\n  assertStringIncludes(${subject}, "part");\n}\nexport const keep = SUBJECT;\n`;
  }
  if (rule === "exaix/promise-response-return") {
    const returned = violation ? "Promise<Response>" : "ReturnType<typeof fetch>";
    return header + `export function get(): ${returned} {\n  return fetch("x");\n}\n`;
  }
  const named = violation ? "" : 'type TMode = "fast" | "slow";\n';
  const annotation = violation ? '"fast" | "slow"' : "TMode";
  return header + named + `export function mode(value: ${annotation}): string {\n  return value;\n}\n`;
}

Deno.test("default-substring-subject-contract: an imported constant subject reports and a local subject does not", async () => {
  await assertCanaryMatrix(["exaix/no-constant-substring-assert"], contractSource);
});

Deno.test("default-return-union-contracts: forbidden and named forms are told apart in scope and in both passes", async () => {
  await assertCanaryMatrix(["exaix/promise-response-return", "exaix/magic-union-type"], contractSource);
});

/** One object-parameter or dictionary rule's violation or clean counterpart below the authored module header. */
function boundarySource(path: string, rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  if (rule === "exaix/no-object-parameters") {
    const signature = violation ? "(value: object)" : "<TValue extends object>(value: TValue)";
    return header + `export function take${signature}: string {\n  return JSON.stringify(value);\n}\n`;
  }
  const valueType = violation ? "unknown" : "string";
  return header + `export const lookup: Record<string, ${valueType}> = {};\n`;
}

Deno.test("default-object-dictionary-gates: weak object and dictionary forms report and named forms pass in both passes", async () => {
  await assertCanaryMatrix(BOUNDARY_RULES, boundarySource);
});

/** The typeof-escape rule's violation or clean counterpart below the authored module header. */
function typeofSource(path: string, _rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  const form = violation
    ? "export const clock = ((): number => 1) as typeof Date.now;"
    : "export const clock: typeof Date.now = (): number => 1;";
  return header + form + "\n";
}

Deno.test("default-typeof-gate: an as-typeof cast reports and a precise typed binding passes in both passes", async () => {
  await assertCanaryMatrix(TYPEOF_RULES, typeofSource);
});

/** A fetch stub cast to the one allowed typeof target. */
const FETCH_STUB_SOURCE =
  'export const stub = ((): ReturnType<typeof fetch> => fetch("x")) as typeof globalThis.fetch;\n';

Deno.test("default-typeof-gate: the allowed fetch target passes in test files and is reported in production files", async () => {
  const rule = "exaix/no-typeof-escape";
  await withActivationProject(async (dir) => {
    for (const path of CANARY_PATHS) {
      const header = sourceOf(path, false).split("import { value }")[0];
      await Deno.writeTextFile(join(dir, path), header + FETCH_STUB_SOURCE);
      const result = await runPass(dir, path.startsWith("scripts/") ? "scripts" : "main");
      const testFile = /_test\.ts$/.test(path);
      assertEquals(result.code, testFile ? 0 : 1, `${path}: ${result.stderr}`);
      if (!testFile) assertStringIncludes(result.stderr, `error[${rule}]:`);
      assertRuleEvidence({
        rule,
        runId: result.runId,
        stderr: result.stderr,
        checkedFiles: [toFileUrl(join(dir, path)).href],
        cwd: dir,
      });
      await Deno.remove(join(dir, path));
    }
  });
});

/** The explicit-unknown rule's violation or clean counterpart below the authored module header. */
function unknownSource(path: string, _rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  const form = violation ? "export const stored: unknown = 1;\n" : [
    'export function isText(value: unknown): value is string {\n  return typeof value === "string";\n}\n',
    "export function describe<TValue extends Record<string, unknown>>(value: TValue): TValue {\n  return value;\n}\n",
    'export function recover(run: () => void): string {\n  try {\n    run();\n    return "";\n  } catch (error: unknown) {\n    return String(error);\n  }\n}\n',
  ].join("");
  return header + form;
}

Deno.test("default-unknown-gate: a stored unknown reports while catch, predicate and constraint forms pass in both passes", async () => {
  await assertCanaryMatrix(UNKNOWN_RULES, unknownSource);
});

/** The repeated-call rule's violation or clean counterpart: two calls of one stateful function in a block. */
function repeatedSource(path: string, _rule: string, violation: boolean): string {
  const header = sourceOf(path, false).split("import { value }")[0];
  const imports = 'import { assertEquals } from "./support.ts";\n';
  const body = violation
    ? "  assertEquals(next(), 1);\n  assertEquals(next(), 2);\n"
    : "  const first: number = next();\n  const second: number = next();\n  assertEquals(first, 1);\n  assertEquals(second, 2);\n";
  return header + imports + "declare function next(): number;\nexport function check(): void {\n" + body + "}\n";
}

Deno.test("default-repeated-gate: adjacent calls of one stateful function report and named results pass in both passes", async () => {
  await assertCanaryMatrix(REPEATED_RULES, repeatedSource);
});

Deno.test("repeated-stateful-calls: one named result per call keeps the call count and order of a stateful function", () => {
  const order: number[] = [];
  let counter = 0;
  const next = (): number => {
    counter++;
    order.push(counter);
    return counter;
  };
  const first: number = next();
  const second: number = next();
  assertEquals([first, second], [1, 2]);
  assertEquals(order, [1, 2]);
});

/** The directories below `base` that hold a deno.json, as repository-relative paths. */
async function configuredDirectories(base: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(new URL(base, REPO_ROOT))) {
    if (!entry.isDirectory || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const directory = `${base}/${entry.name}`;
    const configured = await Deno.stat(new URL(`${directory}/deno.json`, REPO_ROOT)).then(() => true, () => false);
    if (configured) found.push(directory);
    found.push(...await configuredDirectories(directory));
  }
  return found;
}

Deno.test("team-package-coverage: every directory with a deno.json under exaix-team is a root workspace member", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
  const members = config.workspace.map((entry: string) =>
    globToRegExp(entry.replace(/^\.\//, ""), { extended: true, globstar: false })
  );
  const outside = (await configuredDirectories("exaix-team")).filter((directory) =>
    !members.some((member: RegExp) => member.test(directory))
  );
  assertEquals(outside, [], "Deno loads no lint plugin for a package outside the root workspace");
});

Deno.test("team-package-coverage: the workspace names the Team tree by pattern, so a new package joins without an edit", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
  const teamEntries: string[] = config.workspace.filter((entry: string) => entry.includes("exaix-team"));
  assertEquals(teamEntries, ["./exaix-team/packages/*", "./exaix-team/apps/*"]);
});
