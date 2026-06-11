/**
 * @module DenoPermissionsPolicySecurityTest
 * @path tests/security/deno_permissions_policy_test.ts
 * @description Security regression for Finding 2 (Exaix_Security_Vulnerability_Analysis.md).
 * The operational deno tasks that launch the daemon / CLI / TUI must not grant the
 * blanket `--allow-all` permission. They run with an explicit, scoped grant whose
 * subprocess capability (`--allow-run`) is limited to the known binary allowlist.
 * `--allow-ffi` is intentionally retained: the SQLite Activity-Journal backend
 * (@db/sqlite) loads a native library via FFI, so it cannot be dropped here.
 * @architectural-layer Infra
 * @related-files [packages/tool-runtime/src/tool_registry.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

interface DenoJson {
  tasks: Record<string, string>;
}

async function loadTasks(): Promise<Record<string, string>> {
  const text = await Deno.readTextFile(join(REPO_ROOT, "deno.json"));
  return (JSON.parse(text) as DenoJson).tasks;
}

/** Tasks that launch the long-running app surfaces an attacker can reach. */
const OPERATIONAL_TASKS = ["start", "stop", "status", "dev", "cli", "tui", "compile"];

function grantsAllowAll(command: string): boolean {
  return /(^|\s)(--allow-all|-A)(\s|$)/.test(command);
}

Deno.test("security: operational deno tasks do not grant --allow-all", async () => {
  const tasks = await loadTasks();
  for (const name of OPERATIONAL_TASKS) {
    const command = tasks[name];
    assert(command, `expected task '${name}' to exist in deno.json`);
    assertEquals(
      grantsAllowAll(command),
      false,
      `operational task '${name}' must not use --allow-all: ${command}`,
    );
  }
});

Deno.test("security: operational deno tasks scope --allow-run to an allowlist", async () => {
  const tasks = await loadTasks();
  for (const name of OPERATIONAL_TASKS) {
    const command = tasks[name];
    // A scoped grant uses `--allow-run=<list>`; a bare `--allow-run` (any binary) is rejected.
    assert(
      command.includes("--allow-run="),
      `operational task '${name}' must scope --allow-run to an allowlist: ${command}`,
    );
    assert(
      !/--allow-run(\s|$)/.test(command),
      `operational task '${name}' must not grant bare --allow-run (any binary): ${command}`,
    );
  }
});

Deno.test("security: an explicit unsafe opt-in task remains available", async () => {
  const tasks = await loadTasks();
  // The blanket-permission escape hatch is preserved but renamed so it is opt-in.
  assert(tasks["start:unsafe"], "expected a 'start:unsafe' opt-in task for full --allow-all");
  assert(
    grantsAllowAll(tasks["start:unsafe"]),
    "'start:unsafe' should retain --allow-all for the documented escape hatch",
  );
});
