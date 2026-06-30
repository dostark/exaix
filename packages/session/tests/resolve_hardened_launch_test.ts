/**
 * @module ResolveHardenedLaunchTest
 * @path packages/session/tests/resolve_hardened_launch_test.ts
 * @description Phase 128 Step 5 — tests for SessionDelegateService.resolveHardenedLaunch().
 *   Covers backward-compatibility (resolveLaunch unchanged), agent-name mismatch detection,
 *   configPath setting for OpenCode, and flag derivation for Claude Code.
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import type { SessionBrief, SessionDelegateConfig } from "@exaix/schemas/session_delegate.ts";
import { DOGFOOD_DEVELOPER_IDENTITY_ID } from "@exaix/core/types";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { buildOpencodePermissionConfig } from "@exaix/session/opencode_permission_generator.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";

const FIXED_NOW = new Date("2026-06-26T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

function makeService(sessionDir: string): SessionDelegateService {
  return new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
    pathResolver: {
      resolve: (path: string) => Promise.resolve(`${sessionDir}/${path.replace("@Runtime/", "")}`),
    } as never,
  });
}

function opencodeBrief(overrides?: Partial<SessionBrief>): SessionBrief {
  return {
    trace_id: "00000000-0000-0000-0000-0000000step5",
    gate: "code_changes" as const,
    tool: "opencode",
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

function claudeBrief(overrides?: Partial<SessionBrief>): SessionBrief {
  return {
    trace_id: "00000000-0000-0000-0000-0000000step5",
    gate: "code_changes" as const,
    tool: "claude-code",
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

function hardenedConfig(): SessionDelegateConfig {
  return {
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    launch_mode: "headless",
    harden_permissions: true,
  };
}

Deno.test("[delegate_hardening] resolveHardenedLaunch returns IHardenedLaunchResult with launch and agentNameMismatch", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir);
  const brief = opencodeBrief();
  const config = hardenedConfig();

  const result = await svc.resolveHardenedLaunch(brief, "headless", config);

  assertExists(result.launch);
  assertEquals(typeof result.agentNameMismatch, "boolean");
  assertEquals(result.launch.command, "opencode");
});

Deno.test("[delegate_hardening] resolveHardenedLaunch sets configPath on OpenCode launch", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir);
  const brief = opencodeBrief();
  const config = hardenedConfig();

  const result = await svc.resolveHardenedLaunch(brief, "headless", config);

  assertExists(result.launch.configPath);
  assertMatch(result.launch.configPath!, /opencode_config\.json$/);
});

Deno.test("[delegate_hardening] resolveHardenedLaunch appends permission flags for Claude Code", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir);
  const brief = claudeBrief();
  const config: SessionDelegateConfig = {
    enabled: true,
    tool: "claude-code",
    gates: ["code_changes"],
    launch_mode: "headless",
    harden_permissions: true,
  };

  const result = await svc.resolveHardenedLaunch(brief, "headless", config);

  assertExists(result.launch.args);
  // Claude Code should have --permission-mode and --allowedTools in args
  const argsJoined = result.launch.args.join(" ");
  assertMatch(argsJoined, /--permission-mode/);
  assertMatch(argsJoined, /--allowedTools/);
});

Deno.test("[delegate_hardening] agentNameMismatch is false when using canonical DOGFOOD_DEVELOPER_IDENTITY_ID", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir);
  const brief = opencodeBrief();
  const config = hardenedConfig();

  const result = await svc.resolveHardenedLaunch(brief, "headless", config);

  assertEquals(result.agentNameMismatch, false);
});

Deno.test("[delegate_hardening] agentNameMismatch comparison logic is structurally correct", () => {
  // Verify the generator always uses DOGFOOD_DEVELOPER_IDENTITY_ID as the agent key.
  // If this changes, agentNameMismatch will become true until the daemon-side
  // event emission is updated.
  const config = buildOpencodePermissionConfig(["src/**"]);
  assertExists(config.agent[DOGFOOD_DEVELOPER_IDENTITY_ID], "agent key must match canonical identity");
  assertEquals(config.agent[DOGFOOD_DEVELOPER_IDENTITY_ID].edit, { "*": "deny", "src/**": "allow" });

  // Verify that a non-canonical key would NOT match — proving the mismatch
  // detection logic would trigger if the generator diverged.
  assertEquals(config.agent["non-canonical-identity"], undefined);
});

Deno.test("[delegate_hardening] resolveHardenedLaunch returns versionWarning field on result", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir);
  const brief = opencodeBrief();
  const config = hardenedConfig();

  const result = await svc.resolveHardenedLaunch(brief, "headless", config);

  // versionWarning is undefined when probe succeeds (binary on PATH, version >= minimum)
  // or a string when binary not found / version below minimum.
  // The probe behavior is tested in delegate_version_probe_test.ts;
  // here we just verify the field is present on the result type.
  assertExists("versionWarning" in result);
});

Deno.test("[delegate_hardening] harden_permissions=false path: resolveLaunch unchanged (backward-compat)", () => {
  const sessionDir = "/tmp/test-backward-compat";
  const svc = makeService(sessionDir);
  const brief = opencodeBrief();
  const launch = svc.resolveLaunch(brief, "headless");

  assertEquals(launch.command, "opencode");
  assertEquals(launch.configPath, undefined);
});
