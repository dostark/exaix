/**
 * @module DogfoodMcpLaunchTest
 * @path packages/session/tests/dogfood_mcp_launch_test.ts
 * @description dogfood_mcp_config.ts's pure builders (exact Claude/
 * OpenCode/Codex config shapes, argv, and env-var references — never a credential
 * value) plus SessionDelegateService.resolveHardenedLaunch's wiring of a connection into
 * each tool: generated permission union (existing agent.* / sandbox / allowedTools
 * preserved, MCP grant additive), no credential in argv, config cleanup via
 * removeOrphanContextClientConfigs.
 * @architectural-layer Tests
 * @related-files [packages/session/src/dogfood_mcp_config.ts, packages/session/src/session_delegate_service.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { type ISessionDelegateServiceDeps, SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import {
  buildClaudeMcpConfig,
  buildCodexMcpArgs,
  buildOpencodeMcpFragment,
  claudeMcpAllowedToolEntries,
  DOGFOOD_MCP_SERVER_KEY,
  type IDogfoodMcpConnectionInput,
  removeOrphanContextClientConfigs,
  writeClaudeMcpConfig,
} from "@exaix/session/dogfood_mcp_config.ts";

const FIXED_NOW = new Date("2026-06-26T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };
const TEST_AGENT_ROLE = "dogfood-coder";

const CONNECTION: IDogfoodMcpConnectionInput = {
  endpoint: "http://127.0.0.1:54321/mcp",
  bearerEnvVar: "EXAIX_CONTEXT_BEARER",
  toolNames: ["query_relationships", "who_depends_on", "search_memory"],
};

function makeService(sessionDir: string, overrides: Partial<ISessionDelegateServiceDeps> = {}): SessionDelegateService {
  return new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
    pathResolver: {
      resolve: (path: string) => Promise.resolve(`${sessionDir}/${path.replace("@Runtime/", "")}`),
    } as never,
    versionProbe: (_command, minimumVersion) => Promise.resolve({ version: minimumVersion, supported: true }),
    ...overrides,
  });
}

function briefFor(
  tool: SessionBrief["tool"],
  overrides?: Opt<Partial<SessionBrief>, Reason.OptionalInput>,
): SessionBrief {
  return {
    trace_id: "00000000-0000-4000-8000-000000000176",
    agent_role: TEST_AGENT_ROLE,
    gate: "code_changes" as const,
    tool,
    objective: "Execute step test",
    artifact_ref: "trace:test/step:test",
    context_card_ref: undefined,
    acceptance_criteria: [],
    permitted_paths: ["src/**"],
    worktree_path: undefined,
    token_budget: { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
    resume_token: "tok",
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

// Pure builders

Deno.test("[dogfood_mcp_config] buildClaudeMcpConfig produces an mcpServers HTTP entry with an env-reference header, never a literal credential", () => {
  const config = buildClaudeMcpConfig(CONNECTION);
  assertEquals(config.mcpServers[DOGFOOD_MCP_SERVER_KEY].type, "http");
  assertEquals(config.mcpServers[DOGFOOD_MCP_SERVER_KEY].url, CONNECTION.endpoint);
  assertEquals(config.mcpServers[DOGFOOD_MCP_SERVER_KEY].headers.Authorization, "Bearer ${EXAIX_CONTEXT_BEARER}");
  assert(!JSON.stringify(config).includes("actual-secret-value"));
});

Deno.test("[dogfood_mcp_config] claudeMcpAllowedToolEntries names each tool mcp__<server>__<tool>", () => {
  const entries = claudeMcpAllowedToolEntries(CONNECTION);
  assertEquals(entries, [
    "mcp__exaix_context__query_relationships",
    "mcp__exaix_context__who_depends_on",
    "mcp__exaix_context__search_memory",
  ]);
});

Deno.test("[dogfood_mcp_config] buildOpencodeMcpFragment produces a remote server entry with an {env:VAR} reference header", () => {
  const fragment = buildOpencodeMcpFragment(CONNECTION);
  assertEquals(fragment[DOGFOOD_MCP_SERVER_KEY], {
    type: "remote",
    url: CONNECTION.endpoint,
    oauth: false,
    headers: { Authorization: "Bearer {env:EXAIX_CONTEXT_BEARER}" },
  });
});

Deno.test("[dogfood_mcp_config] buildCodexMcpArgs never includes the credential value, only the env var NAME", () => {
  const args = buildCodexMcpArgs(CONNECTION);
  const joined = args.join(" ");
  assert(joined.includes(`bearer_token_env_var="EXAIX_CONTEXT_BEARER"`));
  assert(joined.includes(`url="${CONNECTION.endpoint}"`));
  assert(joined.includes(`enabled_tools=["query_relationships","who_depends_on","search_memory"]`));
});

Deno.test("[dogfood_mcp_config] writeClaudeMcpConfig writes owner-only-permissioned JSON under @Runtime/<trace>/context-client/", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const pathResolver = { resolve: (path: string) => Promise.resolve(`${dir}/${path.replace("@Runtime/", "")}`) };
    const configPath = await writeClaudeMcpConfig(CONNECTION, pathResolver as never, "trace-1");
    assertEquals(configPath, `${dir}/trace-1/context-client/claude_mcp_config.json`);
    const written = JSON.parse(await Deno.readTextFile(configPath));
    assertEquals(written.mcpServers[DOGFOOD_MCP_SERVER_KEY].url, CONNECTION.endpoint);
    const stat = await Deno.stat(configPath);
    assertEquals((stat.mode ?? 0) & 0o777, 0o600);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[dogfood_mcp_config] removeOrphanContextClientConfigs removes every context-client/ dir under @Runtime and reports the count", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const pathResolver = { resolve: (path: string) => Promise.resolve(`${dir}/${path.replace(/^@Runtime\/?/, "")}`) };
    await writeClaudeMcpConfig(CONNECTION, pathResolver as never, "trace-a");
    await writeClaudeMcpConfig(CONNECTION, pathResolver as never, "trace-b");
    await Deno.mkdir(`${dir}/trace-c`, { recursive: true }); // no context-client dir at all

    const removed = await removeOrphanContextClientConfigs(pathResolver as never);
    assertEquals(removed, 2);
    await assertDirMissing(`${dir}/trace-a/context-client`);
    await assertDirMissing(`${dir}/trace-b/context-client`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[dogfood_mcp_config] removeOrphanContextClientConfigs returns 0 when the runtime root does not exist", async () => {
  const pathResolver = { resolve: (path: string) => Promise.resolve(`/nonexistent-${crypto.randomUUID()}/${path}`) };
  const removed = await removeOrphanContextClientConfigs(pathResolver as never);
  assertEquals(removed, 0);
});

async function assertDirMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
    throw new Error(`expected ${path} to be removed`);
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound);
  }
}

// resolveHardenedLaunch wiring

Deno.test("[resolveHardenedLaunch+mcp] Claude Code: --mcp-config/--strict-mcp-config are appended and the MCP tools join the existing --allowedTools value", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(
      briefFor("claude-code"),
      "headless",
      {} as never,
      CONNECTION,
    );

    assertEquals(launch.args.includes("--strict-mcp-config"), true);
    const mcpConfigIndex = launch.args.indexOf("--mcp-config");
    assert(mcpConfigIndex !== -1);
    const configPath = launch.args[mcpConfigIndex + 1];
    const written = JSON.parse(await Deno.readTextFile(configPath));
    assertEquals(written.mcpServers[DOGFOOD_MCP_SERVER_KEY].url, CONNECTION.endpoint);

    const allowedToolsIndex = launch.args.indexOf("--allowedTools");
    const allowedToolsValue = launch.args[allowedToolsIndex + 1];
    // Existing scoped grant is preserved (not replaced) alongside the new MCP tools.
    assert(allowedToolsValue.includes("Read"));
    assert(allowedToolsValue.includes("Edit"));
    assert(allowedToolsValue.includes("mcp__exaix_context__query_relationships"));

    // The credential VALUE never appears anywhere in argv.
    assert(
      !launch.args.some((a) =>
        a.includes(CONNECTION.bearerEnvVar) && a.includes("=") === false && a === CONNECTION.bearerEnvVar
      ),
    );
    assert(JSON.stringify(launch.args).includes("actual-secret-value") === false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] Claude Code without a connection: no --mcp-config/--strict-mcp-config, existing behavior unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(briefFor("claude-code"), "headless", {} as never);
    assertEquals(launch.args.includes("--mcp-config"), false);
    assertEquals(launch.args.includes("--strict-mcp-config"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] OpenCode: mcp.exaix_context is merged into the generated config, preserving edit/external_directory/bash", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(briefFor("opencode"), "headless", {} as never, CONNECTION);

    assertExists(launch.configPath);
    const written = JSON.parse(await Deno.readTextFile(launch.configPath!));
    assertEquals(written.mcp[DOGFOOD_MCP_SERVER_KEY].url, CONNECTION.endpoint);
    assertEquals(written.mcp[DOGFOOD_MCP_SERVER_KEY].headers.Authorization, "Bearer {env:EXAIX_CONTEXT_BEARER}");
    const agentConfig = written.agent[TEST_AGENT_ROLE];
    assertExists(agentConfig, "existing agent permission block must be preserved alongside the MCP grant");
    assertEquals(agentConfig.external_directory, { "**": "deny" });
    assertEquals(agentConfig.bash, { "*": "deny" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] OpenCode without a connection: no mcp key in the generated config (existing behavior unchanged)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(briefFor("opencode"), "headless", {} as never);
    const written = JSON.parse(await Deno.readTextFile(launch.configPath!));
    assertEquals("mcp" in written, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] Codex: -c overrides are appended and the pre-existing single --sandbox flag is untouched", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(briefFor("codex"), "headless", {} as never, CONNECTION);

    const sandboxOccurrences = launch.args.filter((a) => a === "--sandbox").length;
    assertEquals(sandboxOccurrences, 1, "hardening must not duplicate --sandbox");

    const joined = launch.args.join(" ");
    assert(joined.includes(`mcp_servers.${DOGFOOD_MCP_SERVER_KEY}.url="${CONNECTION.endpoint}"`));
    assert(joined.includes(`mcp_servers.${DOGFOOD_MCP_SERVER_KEY}.bearer_token_env_var="EXAIX_CONTEXT_BEARER"`));
    assert(!joined.includes("actual-secret-value"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] Codex without a connection: no mcp_servers overrides (existing behavior unchanged)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir);
    const { launch } = await service.resolveHardenedLaunch(briefFor("codex"), "headless", {} as never);
    assert(!launch.args.join(" ").includes("mcp_servers"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[resolveHardenedLaunch+mcp] an unsupported binary version still fails closed even when a connection is supplied", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-mcp-launch-" });
  try {
    const service = makeService(dir, {
      versionProbe: () => Promise.resolve({ version: "0.0.1", supported: false }),
    });
    await assertRejectsAsync(() =>
      service.resolveHardenedLaunch(briefFor("claude-code"), "headless", {} as never, CONNECTION)
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function assertRejectsAsync(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected rejection");
}
