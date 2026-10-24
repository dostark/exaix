/**
 * @module PortalUnslopConfigTest
 * @path packages/core/tests/config/portal_unslop_config_test.ts
 * @description Real ConfigService TOML loading of mixed verification kinds and the unslop settings defaults.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core, @exaix/schemas]
 * @related-files [packages/schemas/src/portal_verification.ts, packages/schemas/src/config.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ConfigService } from "@exaix/core/config";
import { isDenoTaskCheck, type IVerificationCheck } from "@exaix/schemas";

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
