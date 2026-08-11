/**
 * @module ReadTaskLocalLicenseTest
 * @path tests/scripts/read_task_local_license_test.ts
 * @description RED-first test, Phase 144 post-gap remediation (GAP-7 / Step 13).
 *   `readTaskLocalLicense`'s bare `catch { continue; }` swallowed EVERY error reading a
 *   task-local LICENSE/NOTICE override — including a genuine I/O fault on a file that
 *   DOES exist (permission denied, a directory in its place, disk error) — silently
 *   treating it identically to "no override present." A license-override read failure must
 *   fail closed (propagate) rather than silently downgrade the task to the root license.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { readTaskLocalLicense } from "../../scripts/ingest_terminal_bench.ts";

Deno.test("[ReadTaskLocalLicense] a genuinely absent LICENSE/NOTICE resolves to undefined (no override present) — happy path unaffected", async () => {
  const sourceDir = await Deno.makeTempDir({ prefix: "exaix-tb-license-absent-" });
  try {
    const result = await readTaskLocalLicense(sourceDir);
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
  }
});

Deno.test("[ReadTaskLocalLicense] a real task-local LICENSE file is read and returned", async () => {
  const sourceDir = await Deno.makeTempDir({ prefix: "exaix-tb-license-present-" });
  try {
    await Deno.writeTextFile(join(sourceDir, "LICENSE"), "MIT License\n");
    const result = await readTaskLocalLicense(sourceDir);
    assertEquals(result, "MIT License\n");
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
  }
});

Deno.test("[ReadTaskLocalLicense] a non-NotFound I/O error reading LICENSE (e.g. it is a directory) propagates rather than being swallowed as no-override (GAP-7)", async () => {
  const sourceDir = await Deno.makeTempDir({ prefix: "exaix-tb-license-ioerror-" });
  try {
    // A directory named "LICENSE" makes Deno.readTextFile fail with a real I/O error
    // (IsADirectory), not NotFound — the exact "override exists but is unreadable" case.
    await Deno.mkdir(join(sourceDir, "LICENSE"));
    await assertRejects(
      () => readTaskLocalLicense(sourceDir),
      Error,
    );
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
  }
});
