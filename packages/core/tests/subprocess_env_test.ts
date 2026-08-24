/**
 * @module SubprocessEnvTest
 * @path packages/core/tests/subprocess_env_test.ts
 * @description Phase 167 Step 3 closure: `SafeSubprocess` spawns must never forward
 *   dynamic-linker env vars (`LD_*`/`DYLD_*`) to a child. Deno's scoped `--allow-run`
 *   permission refuses to spawn a subprocess that inherits `LD_LIBRARY_PATH` (and friends),
 *   which silently breaks every subprocess call (git audit, etc.) run by a daemon on a
 *   workstation where the parent env sets it — the live `git.audit.failed: Subprocess
 *   failed: git` find. This matches the security model `buildDelegateEnv`/`sanitizeChildEnv`
 *   already establish: those prefixes are never legitimately needed in a child and Deno
 *   rejects them anyway, so stripping them is both correct and consistent.
 */

import { assertEquals } from "@std/assert";
import { SafeSubprocess } from "@exaix/core";

Deno.test("SafeSubprocess: strips LD_*/DYLD_* from an explicit child env so the spawn is not refused", async () => {
  const result = await SafeSubprocess.run("env", [], {
    env: {
      LD_LIBRARY_PATH: "/opt/klee/lib",
      DYLD_LIBRARY_PATH: "/opt/extra/lib",
      EXA_SUBPROCESS_SENTINEL: "present",
    },
  });

  assertEquals(result.code, 0, `env should spawn cleanly, got stderr: ${result.stderr}`);
  assertEquals(result.stdout.includes("LD_LIBRARY_PATH="), false, "LD_LIBRARY_PATH must not reach the child");
  assertEquals(result.stdout.includes("DYLD_LIBRARY_PATH="), false, "DYLD_LIBRARY_PATH must not reach the child");
  assertEquals(result.stdout.includes("EXA_SUBPROCESS_SENTINEL=present"), true, "non-dynamic-linker env is preserved");
});

Deno.test("SafeSubprocess: clearEnv semantics are preserved (only explicit env reaches the child)", async () => {
  const result = await SafeSubprocess.run("env", [], {
    clearEnv: true,
    env: { EXA_SUBPROCESS_ONLY: "yes", LD_LIBRARY_PATH: "/should/be/stripped" },
  });

  assertEquals(result.code, 0, `env should spawn cleanly, got stderr: ${result.stderr}`);
  assertEquals(result.stdout.includes("LD_LIBRARY_PATH="), false, "LD_LIBRARY_PATH must be stripped");
  assertEquals(result.stdout.includes("EXA_SUBPROCESS_ONLY=yes"), true, "explicit env var is present");
  // With clearEnv, inherited vars like PATH must be absent (we started from an empty env).
  assertEquals(result.stdout.includes("PATH="), false, "clearEnv must not forward inherited PATH");
});
