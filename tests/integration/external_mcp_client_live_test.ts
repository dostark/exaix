/**
 * @module ExternalMcpClientLiveTest
 * @path tests/integration/external_mcp_client_live_test.ts
 * @description Phase 162 Step 7 (mandatory, non-deferrable live cutover) —
 * proves `exactl mcp connect` is reachable end to end, via a REAL subprocess
 * invocation (mirroring `external_mcp_client_cutover_test.ts`'s pattern
 * exactly), against two genuine third-party MCP servers outside Exaix's
 * control: DeepWiki's public, unauthenticated server, and GitHub's official,
 * bearer-token-authenticated remote server. Both tests are tagged `[live]`
 * and skip cleanly (never fail) only when their precondition is
 * unavailable — a CI run always skips (no outbound network there), and the
 * GitHub test skips when no real PAT is provided. Once the precondition is
 * met, a real failure (unreachable server, broken auth, code regression)
 * fails loudly, matching Step 5's cutover test — a live proof that quietly
 * skips on error would defeat its purpose. This is the only step in the
 * phase (besides Step 5) permitted to reach a genuine external network
 * service.
 * @architectural-layer Test
 * @related-files [apps/exactl/main.ts, apps/exactl/src/commands/mcp_commands.ts, apps/exactl/src/commands/constants.ts, tests/integration/external_mcp_client_cutover_test.ts]
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

/** Official, unauthenticated public reference server — no PAT required. */
const DEEPWIKI_MCP_ENDPOINT = "https://mcp.deepwiki.com/mcp";
/** GitHub's official remote MCP server — requires `Authorization: Bearer <PAT>`. */
const GITHUB_MCP_ENDPOINT = "https://api.githubcopilot.com/mcp/";
/** Env var this test reads a real PAT from — matches the `gh`/GitHub Actions ecosystem convention. */
const GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN";

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
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", `${REPO_ROOT}apps/exactl/main.ts`, ...args],
    env: { EXA_CONFIG_PATH: configPath, ...extraEnv },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const { code, stdout, stderr } = await proc.output();
  return { stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr), code };
}

Deno.test({
  name:
    "[live] exactl mcp connect --list-tools reaches a real, unauthenticated third-party MCP server (DeepWiki) and lists its real tools",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "external-mcp-client-live-deepwiki-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      writeCliConfig(configPath, tempDir);

      const result = await runExactl(configPath, ["mcp", "connect", DEEPWIKI_MCP_ENDPOINT, "--list-tools"]);

      if (result.code !== 0) {
        throw new Error(`exactl exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      assertStringIncludes(result.stdout, "read_wiki_structure");
      assertStringIncludes(result.stdout, "ask_question");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[live] exactl mcp connect --list-tools reaches GitHub's real, bearer-token-authenticated MCP server and lists its real tools",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const token = Deno.env.get(GITHUB_TOKEN_ENV_VAR);
    if (!token) {
      console.warn(`⏭️  Skipping [live] GitHub auth test: ${GITHUB_TOKEN_ENV_VAR} not set`);
      return;
    }

    const tempDir = await Deno.makeTempDir({ prefix: "external-mcp-client-live-github-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      writeCliConfig(configPath, tempDir);

      const result = await runExactl(configPath, ["mcp", "connect", GITHUB_MCP_ENDPOINT, "--list-tools"], {
        EXA_MCP_BEARER_TOKEN: token,
      });

      if (result.code !== 0) {
        throw new Error(`exactl exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      assertStringIncludes(result.stdout, "get_me");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
