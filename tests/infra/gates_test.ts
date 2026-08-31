/**
 * @module Gates_Test
 * @path tests/infra/gates_test.ts
 * @description Module for gates_test.
 */

import { assertStringIncludes } from "@std/assert";

// Verifies that the CI script correctly imposes security regression gates, documentation
// drift gates, and coverage thresholds.

const CI_SCRIPT = "scripts/ci.ts";

async function runCiCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", CI_SCRIPT, "--dry-run", ...args],
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("Gate: Documentation Drift Check triggers on 'check'", async () => {
  // This just verifies the command is wired up
  const result = await runCiCommand(["check"]);
  assertStringIncludes(result.stdout, "Docs Drift Check");
  assertStringIncludes(result.stdout, "(DRY RUN)");
});

Deno.test("Gate: Security Tests trigger on 'test'", async () => {
  const result = await runCiCommand(["test", "--quick"]);
  assertStringIncludes(result.stdout, "Security Regression Tests");
  assertStringIncludes(result.stdout, "(DRY RUN)");
});

// Gate: Coverage Check triggers on 'all'
Deno.test({
  name: "Gate: Coverage Check triggers on 'all'",
  fn: async () => {
    const result = await runCiCommand(["all"]);
    // Since verifyCoverage also uses run() for its tasks, we expect Dry Run output
    assertStringIncludes(result.stdout, "Coverage Verification");
    assertStringIncludes(result.stdout, "(DRY RUN)");
  },
});
