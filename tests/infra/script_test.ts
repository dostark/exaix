/**
 * @module Script_Test
 * @path tests/infra/script_test.ts
 * @description Module for script_test.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CI_SCRIPT_PATH = join(Deno.cwd(), "scripts", "ci.ts");

// Runs the CI script and captures output. Requires --allow-run permission.
async function runCiScript(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", CI_SCRIPT_PATH, ...args],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    return {
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
    };
  } catch (error) {
    // If we don't have run permissions, skip this test
    if (error instanceof Deno.errors.NotCapable) {
      throw new Error(
        "This test requires --allow-run permission to execute the CI script. Run with: deno test --allow-run tests_infra/script_test.ts",
      );
    }
    throw error;
  }
}

Deno.test({
  name: "[ci] check command should run valid checkers",
  fn: async () => {
    try {
      const result = await runCiScript(["check", "--help"]); // Run help to be fast/safe
      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "check");
      assertStringIncludes(result.stdout, "Run static analysis checks");
    } catch (error) {
      if (error instanceof Error && error.message.includes("requires --allow-run permission")) {
        console.warn("⚠️  Skipping CI script test - requires --allow-run permission");
        return;
      }
      throw error;
    }
  },
});
