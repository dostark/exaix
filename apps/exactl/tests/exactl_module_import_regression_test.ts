/**
 * @module ExaCtlModuleImportRegressionTest
 * @path apps/exactl/tests/exactl_module_import_regression_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Regression test ensuring apps/exactl/src/exactl.ts can be imported as a module
 * without auto-running the CLI parser and terminating the test process.
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { ExaPathDefaults } from "@exaix/core";

function buildMinimalConfig(root: string): string {
  return `
[system]
root = ${JSON.stringify(root)}
version = "1.0.0"
log_level = "info"

[paths]
memory = ${JSON.stringify(ExaPathDefaults.memory)}
blueprints = ${JSON.stringify(ExaPathDefaults.blueprints)}
runtime = ${JSON.stringify(ExaPathDefaults.runtime)}
workspace = ${JSON.stringify(ExaPathDefaults.workspace)}
portals = ${JSON.stringify(ExaPathDefaults.portals)}
active = ${JSON.stringify(ExaPathDefaults.active)}
archive = ${JSON.stringify(ExaPathDefaults.archive)}
plans = ${JSON.stringify(ExaPathDefaults.plans)}
requests = ${JSON.stringify(ExaPathDefaults.requests)}
rejected = ${JSON.stringify(ExaPathDefaults.rejected)}
agents = ${JSON.stringify(ExaPathDefaults.agents)}
flows = ${JSON.stringify(ExaPathDefaults.flows)}
memoryProjects = ${JSON.stringify(ExaPathDefaults.memoryProjects)}
memoryExecution = ${JSON.stringify(ExaPathDefaults.memoryExecution)}
memoryIndex = ${JSON.stringify(ExaPathDefaults.memoryIndex)}
memorySkills = ${JSON.stringify(ExaPathDefaults.memorySkills)}
memoryPending = ${JSON.stringify(ExaPathDefaults.memoryPending)}
memoryTasks = ${JSON.stringify(ExaPathDefaults.memoryTasks)}
memoryGlobal = ${JSON.stringify(ExaPathDefaults.memoryGlobal)}
`.trim();
}

Deno.test("[regression] importing exactl module does not auto-run CLI entrypoint", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exactl-import-" });
  const cliModuleUrl = toFileUrl(join(Deno.cwd(), "apps/exactl/src/exactl.ts")).href;
  const env = { ...Deno.env.toObject() };
  delete env.EXA_TEST_MODE;
  delete env.EXA_TEST_CLI_MODE;
  env.EXA_CONFIG_PATH = join(tempDir, "config.toml");

  await Deno.writeTextFile(env.EXA_CONFIG_PATH, buildMinimalConfig(tempDir));

  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `import ${JSON.stringify(cliModuleUrl)}; console.log("after import");`,
      ],
      cwd: Deno.cwd(),
      env,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    assertEquals(code, 0);
    assertStringIncludes(output, "after import");
    assertFalse(output.includes("Usage:   exactl"), "CLI help should not print on module import");
    assertFalse(errorOutput.includes("Usage:   exactl"), "CLI help should not print on stderr");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
