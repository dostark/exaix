/**
 * @module GoPortPreserveSnapshotTest
 * @path tests/scripts/go_port_preserve_snapshot_test.ts
 * @description Validates the snapshot target guard, manifest refs, clone checkout and environment binding.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/go_port/preserve_snapshot.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  assertTargetAllowed,
  cloneSnapshot,
  snapshotEnv,
  validateManifestRefs,
} from "../../scripts/go_port/preserve_snapshot.ts";

Deno.test("preserve-snapshot-path: a target inside the repository is refused", async () => {
  const repo = await Deno.makeTempDir({ prefix: "snapshot_repo_" });
  try {
    await assertRejects(() => assertTargetAllowed(repo, join(repo, "snapshot")), Error, "inside");
    const outside = await Deno.makeTempDir({ prefix: "snapshot_out_" });
    try {
      await assertTargetAllowed(repo, join(outside, "snapshot"));
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("preserve-snapshot-manifest: a missing or malformed ref is refused", () => {
  assertEquals(validateManifestRefs({ parent: "0".repeat(40), submodules: {} }), []);
  assertEquals(validateManifestRefs({ parent: "bad", submodules: {} }).length > 0, true);
  assertEquals(validateManifestRefs({ parent: "0".repeat(40), submodules: { x: "bad" } }).length > 0, true);
});

Deno.test("preserve-snapshot-clone: a fixture repository is cloned at the recorded commit", async () => {
  const repo = await Deno.makeTempDir({ prefix: "snapshot_clone_" });
  const target = await Deno.makeTempDir({ prefix: "snapshot_target_" });
  try {
    await Deno.writeTextFile(join(repo, "README.md"), "fixture\n");
    const init = await new Deno.Command("git", { args: ["-C", repo, "init"], stdout: "null" }).output();
    assertEquals(init.success, true);
    await new Deno.Command("git", { args: ["-C", repo, "add", "README.md"] }).output();
    const commit = await new Deno.Command("git", {
      args: ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"],
      stdout: "null",
    }).output();
    assertEquals(commit.success, true);
    const sha = new TextDecoder().decode(
      (await new Deno.Command("git", { args: ["-C", repo, "rev-parse", "HEAD"], stdout: "piped" }).output()).stdout,
    ).trim();
    await Deno.remove(target, { recursive: true });
    await cloneSnapshot({ parent: sha, submodules: {} }, target, repo);
    assertEquals(await Deno.readTextFile(join(target, "README.md")), "fixture\n");
    const status = await new Deno.Command("git", { args: ["-C", target, "status", "--porcelain"], stdout: "piped" })
      .output();
    assertEquals(new TextDecoder().decode(status.stdout).trim(), "");
  } finally {
    await Deno.remove(repo, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("preserve-snapshot-cli: the environment binds the snapshot exactl and daemon", () => {
  const env = snapshotEnv("/snapshot");
  assertEquals(env.EXA_BIN_PATH, "/snapshot/tests/scenario_framework/bin");
  assertEquals(env.EXA_DAEMON_SCRIPT, "/snapshot/apps/daemon/main.ts");
});
