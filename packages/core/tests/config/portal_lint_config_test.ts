/**
 * @module PortalLintConfigTest
 * @path packages/core/tests/config/portal_lint_config_test.ts
 * @description Real ConfigService TOML loading of mixed verification kinds, the lint settings defaults and a Config DB override.
 * @architectural-layer Test
 * @dependencies [@db/sqlite, @std/assert, @exaix/core, @exaix/schemas]
 * @related-files [packages/schemas/src/portal_verification.ts, packages/schemas/src/config.ts, packages/schemas/src/lint_settings.ts]
 */

import { Database } from "@db/sqlite";
import { assert, assertEquals } from "@std/assert";
import {
  ConfigService,
  DaemonConfigAdapter,
  ensureConfigDb,
  getAllEffectiveValues,
  InMemoryConfigStore,
  insertOverride,
  migrateConfigDb,
  seedConfigDb,
} from "@exaix/core/config";
import { SwapClass } from "@exaix/core";
import { isDenoTaskCheck, type IVerificationCheck } from "@exaix/schemas";
import { resolveLintSettings } from "@exaix/schemas/lint_settings.ts";

const MIXED_TOML = `
[system]
log_level = "info"

[paths]
workspace = "Workspace"

[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "deno_task"
task = "lint"
path = "src"
args = ["--no-check"]

[[portals.verification.checks]]
kind = "unslop"
include = ["src/**/*.ts", "lib/**/*.mts"]
`;

function firstCheck(
  config: { portals: Array<{ verification?: { checks: IVerificationCheck[] } }> },
): IVerificationCheck {
  const check = config.portals[0].verification?.checks[0];
  assert(check !== undefined);
  return check;
}

async function loadConfig(toml: string): Promise<ConfigService> {
  const dir = await Deno.makeTempDir({ prefix: "unslop-config-" });
  const path = `${dir}/exa.config.toml`;
  await Deno.writeTextFile(path, toml);
  return new ConfigService(path);
}

Deno.test("[portal-unslop-config] real TOML loads mixed verification kinds with defaults", async () => {
  const service = await loadConfig(MIXED_TOML);
  const config = service.get();
  const checks = config.portals[0].verification?.checks ?? [];

  assertEquals(checks.length, 2);
  const denoCheck = checks[0];
  assert(isDenoTaskCheck(denoCheck));
  assertEquals(denoCheck.task, "lint");
  assertEquals(denoCheck.path, "src");
  assertEquals(denoCheck.args, ["--no-check"]);

  const unslopCheck = checks[1];
  assertEquals(unslopCheck.kind, "unslop");
  assertEquals(unslopCheck.kind === "unslop" ? unslopCheck.packs : [], ["typescript"]);
  assertEquals(
    unslopCheck.kind === "unslop" ? unslopCheck.include : [],
    ["src/**/*.ts", "lib/**/*.mts"],
  );
  assertEquals(config.verification.unslop.findings_limit, 50);
  assertEquals(config.verification.unslop.asset_dir, "lint");
});

Deno.test("[portal-unslop-config] an unslop check defaults the include globs", async () => {
  const service = await loadConfig(`
[system]
log_level = "info"

[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
`);
  const check = firstCheck(service.get());
  assertEquals(check.kind === "unslop" ? check.include : [], [
    "**/*.ts",
    "**/*.tsx",
    "**/*.mts",
    "**/*.cts",
  ]);
});

Deno.test("[portal-unslop-config] an unsupported kind, pack or catalog fails the real config load", async () => {
  const invalid = [
    `
[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
packs = ["deno"]
`,
    `
[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
catalog = "/absolute/catalog.json"
`,
    `
[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
include = []
`,
    `
[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
include = ["../escape/*.ts"]
`,
    `
[[portals]]
alias = "demo"
target_path = "/tmp/demo"

[[portals.verification.checks]]
kind = "unslop"
include = ["/absolute/*.ts"]
`,
  ];
  for (const toml of invalid) {
    let failed = false;
    try {
      (await loadConfig(toml)).get();
    } catch {
      failed = true;
    }
    assertEquals(failed, true, "the config load must reject the invalid block");
  }
});

Deno.test("[portal-lint-config] verification.lint defaults apply to a real TOML load", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lint-config-" });
  try {
    const path = `${dir}/exa.config.toml`;
    await Deno.writeTextFile(
      path,
      `
[system]
log_level = "info"
`,
    );
    const service = new ConfigService(path);
    assertEquals(service.get().verification.lint, {
      policy_root: "lint",
      findings_limit: 50,
      json_max_bytes: 8_388_608,
      stderr_max_bytes: 65_536,
      batch_max_files: 32,
      git_max_bytes: 16_777_216,
    });
    assertEquals(resolveLintSettings(service.get()).findings_limit, 50);

    await Deno.writeTextFile(
      path,
      `
[system]
log_level = "info"

[verification.lint]
findings_limit = 12
batch_max_files = 4
`,
    );
    const configured = new ConfigService(path).get().verification.lint;
    assertEquals(configured.findings_limit, 12);
    assertEquals(configured.batch_max_files, 4);
    assertEquals(configured.git_max_bytes, 16_777_216);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[portal-lint-config] a Config DB override wins over the TOML value", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lint-config-" });
  try {
    const path = `${dir}/exa.config.toml`;
    await Deno.writeTextFile(
      path,
      `
[system]
log_level = "info"

[verification.lint]
findings_limit = 12
`,
    );
    const service = new ConfigService(path);
    const configDb = new Database(ensureConfigDb(dir));
    try {
      migrateConfigDb(configDb);
      seedConfigDb(configDb);
      insertOverride(configDb, "verification.lint.findings_limit", 7, "cli", SwapClass.RESTART);
      const store = new InMemoryConfigStore();
      for (const [key, value] of getAllEffectiveValues(configDb)) store.set(key, value, SwapClass.RESTART);
      const adapter = new DaemonConfigAdapter(store, configDb);

      assertEquals(adapter.getOverride("verification.lint.findings_limit"), 7);
      const resolved = resolveLintSettings(service.get(), adapter);
      assertEquals(resolved.findings_limit, 7);
      assertEquals(resolved.batch_max_files, 32);
      assertEquals(resolved.policy_root, "lint");
    } finally {
      configDb.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
