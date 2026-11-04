/**
 * @module ActivationProjectTestHelper
 * @path packages/lint-policy/tests/helpers/activation_project.ts
 * @description Shared helper that copies the authored policy and lint task passes into an isolated project and runs one pass through the real Deno CLI.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/activation_policy_test.ts, packages/lint-policy/tests/max_params_activation_test.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

export const REPO_ROOT = new URL("../../../../", import.meta.url);

const CLI_TIMEOUT_MS = 30_000;

export const CANARY_PATHS = [
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
export function sourceOf(path: string, misplaced: boolean): string {
  const header =
    `/**\n * @module ActivationCanary\n * @path ${path}\n * @description Checks the import placement gate.\n * Usage: deno run ${path}\n */\n`;
  const declaration = "export const before = 1;\n";
  const imported = 'import { value } from "./support.ts";\n';
  const body = misplaced ? declaration + imported : imported + declaration;
  const shebang = path.startsWith("scripts/") ? "#!/usr/bin/env -S deno run -A\n" : "";
  return shebang + header + body + "export const after = value;\n";
}

/** Copies the authored policy and task passes into an isolated project. */
export async function withActivationProject(body: (dir: string) => Promise<void>): Promise<void> {
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
export async function runPass(
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
