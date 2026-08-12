/**
 * @module ExternalMcpClientCutoverTest
 * @path tests/integration/external_mcp_client_cutover_test.ts
 * @description Phase 162 Step 5 (mandatory, non-deferrable cutover) — proves
 * `exactl mcp connect` is reachable from a REAL subprocess invocation
 * (`deno run -A apps/exactl/main.ts mcp connect <url> --list-tools|--call-tool`),
 * against a real, separately-running reference MCP server (Step 4's fixture,
 * built with the official `@modelcontextprotocol/server` SDK) — not an
 * in-process command-class call (`apps/exactl/tests/mcp_commands_test.ts`
 * already covers that, Step 3). This is the only step in the phase permitted
 * to spawn the actual `exactl` entry point.
 * @architectural-layer Test
 * @related-files [apps/exactl/main.ts, apps/exactl/src/commands/mcp_commands.ts, packages/mcp/tests/fixtures/reference_mcp_server.ts]
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";
import { startReferenceServer } from "@exaix/mcp/testing";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

function writeCliConfig(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

async function runExactl(
  configPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", `${REPO_ROOT}apps/exactl/main.ts`, ...args],
    env: { EXA_CONFIG_PATH: configPath },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const { code, stdout, stderr } = await proc.output();
  return { stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr), code };
}

Deno.test({
  name:
    "[ExternalMcpClientCutover] exactl mcp connect --list-tools reaches a real server process and lists its real tools",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "external-mcp-client-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    const reference = await startReferenceServer();
    try {
      await runMigrationsIn(tempDir);
      writeCliConfig(configPath, tempDir);

      const result = await runExactl(configPath, ["mcp", "connect", reference.url.href, "--list-tools"]);

      if (result.code !== 0) {
        throw new Error(`exactl exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      assertStringIncludes(result.stdout, "echo");
      assertStringIncludes(result.stdout, "fail");
      assertStringIncludes(result.stdout, "totals");
    } finally {
      await reference.stop();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[ExternalMcpClientCutover] exactl mcp connect --call-tool round-trips a real tool call through the real CLI entry point",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "external-mcp-client-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    const reference = await startReferenceServer();
    try {
      await runMigrationsIn(tempDir);
      writeCliConfig(configPath, tempDir);

      const result = await runExactl(configPath, [
        "mcp",
        "connect",
        reference.url.href,
        "--call-tool",
        "echo",
        "--args",
        '{"text":"hello"}',
      ]);

      if (result.code !== 0) {
        throw new Error(`exactl exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      assertStringIncludes(result.stdout, "echo: hello");
    } finally {
      await reference.stop();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
