/**
 * @module PortalLintConfigTest
 * @path packages/core/tests/config/portal_lint_config_test.ts
 * @description Real ConfigService TOML loading of the lint settings defaults and a Config DB override.
 * @architectural-layer Test
 * @dependencies [@db/sqlite, @std/assert, @exaix/core, @exaix/schemas]
 * @related-files [packages/schemas/src/portal_verification.ts, packages/schemas/src/config.ts, packages/schemas/src/lint_settings.ts]
 */

import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
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
import { resolveLintSettings } from "@exaix/schemas/lint_settings.ts";

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
