/**
 * @module DogfoodCleanTest
 * @path tests/integration/dogfood_clean_test.ts
 * @description Integration test for the guarded dogfood:clean script (Phase 124
 *   Step 3). Verifies it removes only the realpath-equal configured root, refuses
 *   paths outside it, refuses symlinked roots that resolve outside (GAP-4), and
 *   refuses while the daemon PID is alive. Runs in isolated temp dirs via
 *   DOGFOOD_ROOT to avoid touching the real .dogfood/.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";

const CLEAN_SCRIPT = "scripts/dogfood_clean.ts";

async function runClean(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", CLEAN_SCRIPT, ...args],
    env: { ...env, EXA_TEST_MODE: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test({
  name: "[dogfood_clean] removes the configured .dogfood root",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "dogfood-clean-ok-" });
    await ensureDir(join(root, ".exa"));
    await Deno.writeTextFile(join(root, "marker.txt"), "x");

    const res = await runClean(["--force"], { DOGFOOD_ROOT: root });
    assertEquals(res.code, 0, res.stderr);
    assertEquals(await exists(root), false, "root should be removed");
  },
});

Deno.test({
  name: "[dogfood_clean] refuses a path outside the configured root",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // DOGFOOD_ROOT points at a real dir, but we also create a sibling we must NOT touch.
    const root = await Deno.makeTempDir({ prefix: "dogfood-clean-in-" });
    const sibling = await Deno.makeTempDir({ prefix: "dogfood-clean-sib-" });
    await Deno.writeTextFile(join(sibling, "keep.txt"), "x");

    // Ask the script to clean the sibling explicitly — it must refuse since it
    // is not the configured DOGFOOD_ROOT.
    const res = await runClean(["--force", "--path", sibling], { DOGFOOD_ROOT: root });
    assert(res.code !== 0, "must refuse a non-configured path");
    assertEquals(await exists(sibling), true, "sibling must be untouched");
    await Deno.remove(root, { recursive: true });
    await Deno.remove(sibling, { recursive: true });
  },
});

Deno.test({
  name: "[dogfood_clean] refuses a symlinked root that realpath-resolves outside repo (GAP-4)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const realDir = await Deno.makeTempDir({ prefix: "dogfood-clean-real-" });
    await Deno.writeTextFile(join(realDir, "keep.txt"), "x");
    const linkParent = await Deno.makeTempDir({ prefix: "dogfood-clean-link-" });
    const link = join(linkParent, "rootlink");
    await Deno.symlink(realDir, link);

    const res = await runClean(["--force"], { DOGFOOD_ROOT: link });
    assert(res.code !== 0, "must refuse a symlinked root");
    assertEquals(await exists(realDir), true, "symlink target must be untouched");
    await Deno.remove(realDir, { recursive: true });
    await Deno.remove(linkParent, { recursive: true });
  },
});

Deno.test({
  name: "[dogfood_clean] refuses while the daemon PID is alive",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "dogfood-clean-alive-" });
    await ensureDir(join(root, ".exa"));
    // Write our own (alive) PID into the daemon PID file.
    await Deno.writeTextFile(join(root, ".exa", "daemon.pid"), String(Deno.pid));

    const res = await runClean(["--force"], { DOGFOOD_ROOT: root });
    assert(res.code !== 0, "must refuse while daemon PID is alive");
    assertEquals(await exists(root), true, "root must be untouched while daemon alive");
    await Deno.remove(root, { recursive: true });
  },
});
