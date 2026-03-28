/**
 * @module Build_Test
 * @path tests/infra/build_test.ts
 * @description Module for build_test.
 */

import { assert, assertEquals } from "https://deno.land/std@0.221.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.221.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.221.0/fs/mod.ts";

const REPO_ROOT = Deno.cwd();
const DIST_DIR = join(REPO_ROOT, "dist", "bin");
const CI_SCRIPT = join(REPO_ROOT, "scripts", "ci.ts");

Deno.test({
  name: "[ci] build command should produce target artifacts",
  async fn() {
    // 1. Run build for current target (for speed in test)
    const target = Deno.build.target;
    const isWin = target.includes("windows");
    const expectedName = isWin ? `exaix-${target}.exe` : `exaix-${target}`;
    const expectedPath = join(DIST_DIR, expectedName);

    // Clean up first
    try {
      if (await exists(expectedPath)) {
        await Deno.remove(expectedPath);
      }
    } catch (_e) {
      // ignore
    }

    console.log(`\n🩺 Testing build for ${target}...`);
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", CI_SCRIPT, "build", "--compile", "--targets", target],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    assertEquals(output.code, 0, "Build command should exit with 0");

    // 2. Verify file exists
    const fileExists = await exists(expectedPath);
    assert(fileExists, `Artifact ${expectedName} should exist in dist/bin/`);

    // 3. Verify it's executable and shows version (only for native target)
    if (!isWin) { // Skip execution check on windows if we are on linux runner
      const verifyCmd = new Deno.Command(expectedPath, {
        args: ["--version"],
      });
      const verifyOutput = await verifyCmd.output();
      assertEquals(verifyOutput.code, 0, "Binary should be executable and return 0 for --version");
    }
  },
  // This test is slow and does network IO (deno compile fetches stuff).
  // We ignore it by default to keep 'deno task test' fast.
  ignore: Deno.env.get("CI") !== "true" && Deno.args.includes("--quick"),
});
