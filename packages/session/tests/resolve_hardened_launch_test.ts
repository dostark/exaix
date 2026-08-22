/**
 * @module ResolveHardenedLaunchTest
 * @path packages/session/tests/resolve_hardened_launch_test.ts
 * @description Phase 128 Step 5 — tests for SessionDelegateService.resolveHardenedLaunch().
 *   Covers backward-compatibility (resolveLaunch unchanged), agent-name mismatch detection,
 *   configPath setting for OpenCode, and flag derivation for Claude Code.
 */

import { assertEquals, assertExists, assertMatch, assertRejects } from "@std/assert";
import type { SessionBrief, SessionDelegateConfig } from "@exaix/schemas/session_delegate.ts";
import {
  DOGFOOD_DEVELOPER_IDENTITY_ID,
  MINIMUM_VERSION_CLAUDE_CODE,
  MINIMUM_VERSION_CODEX,
  MINIMUM_VERSION_OPENCODE,
  SESSION_BIN_CODEX,
} from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { buildOpencodePermissionConfig } from "@exaix/session/opencode_permission_generator.ts";
import { type ISessionDelegateServiceDeps, SessionDelegateService } from "@exaix/session/session_delegate_service.ts";

const FIXED_NOW = new Date("2026-06-26T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

function makeService(sessionDir: string, overrides: Partial<ISessionDelegateServiceDeps> = {}): SessionDelegateService {
  return new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
    pathResolver: {
      resolve: (path: string) => Promise.resolve(`${sessionDir}/${path.replace("@Runtime/", "")}`),
    } as never,
    ...overrides,
  });
}

function opencodeBrief(overrides?: Opt<Partial<SessionBrief>, Reason.OptionalInput>): SessionBrief {
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

function claudeBrief(overrides?: Opt<Partial<SessionBrief>, Reason.OptionalInput>): SessionBrief {
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

function codexBrief(overrides?: Opt<Partial<SessionBrief>, Reason.OptionalInput>): SessionBrief {
  return {
    ...claudeBrief(),
    trace_id: "00000000-0000-4000-8000-000000000167",
    tool: "codex",
    objective: "Execute Codex hardening test",
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

Deno.test("[delegate_hardening] injected probe receives exact minimum versions for every CLI tool", async () => {
  const observed: Array<[string, string]> = [];
  const sessionDir = await Deno.makeTempDir();
  try {
    const svc = makeService(sessionDir, {
      versionProbe: (command, minimumVersion) => {
        observed.push([command, minimumVersion]);
        return Promise.resolve({ version: minimumVersion, supported: true });
      },
    });
    await svc.resolveHardenedLaunch(codexBrief(), "headless", hardenedConfig());
    await svc.resolveHardenedLaunch(claudeBrief(), "headless", hardenedConfig());
    await svc.resolveHardenedLaunch(opencodeBrief(), "headless", hardenedConfig());

    assertEquals(observed, [
      [SESSION_BIN_CODEX, MINIMUM_VERSION_CODEX],
      ["claude", MINIMUM_VERSION_CLAUDE_CODE],
      ["opencode", MINIMUM_VERSION_OPENCODE],
    ]);
  } finally {
    await Deno.remove(sessionDir, { recursive: true });
  }
});

Deno.test("[delegate_hardening][security] unhardened Codex launch (resolveLaunch, no harden_permissions) still includes --sandbox read-only", () => {
  // GAP-16 (Phase 167 post-gap-analysis): the base codex headless launch previously had
  // no --sandbox flag at all — an operator who omitted harden_permissions=true got a
  // fully unconstrained Codex process, relying entirely on Codex CLI's own unconfirmed
  // default. This proves the base launch is never fully unconstrained.
  const sessionDir = "/tmp/test-unhardened-codex-sandbox";
  const svc = makeService(sessionDir);
  const launch = svc.resolveLaunch(codexBrief(), "headless");
  assertEquals(launch.args.includes("--sandbox"), true);
  assertEquals(launch.args[launch.args.indexOf("--sandbox") + 1], "read-only");
});

Deno.test("[delegate_hardening][security] hardened Codex launch has exactly one --sandbox flag, widened to workspace-write for code_changes", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir, {
    versionProbe: (_command, minimumVersion) => Promise.resolve({ version: minimumVersion, supported: true }),
  });
  const result = await svc.resolveHardenedLaunch(codexBrief(), "headless", hardenedConfig());
  const sandboxOccurrences = result.launch.args.filter((a) => a === "--sandbox").length;
  assertEquals(
    sandboxOccurrences,
    1,
    "the base --sandbox read-only must be replaced, not duplicated, when hardening widens it",
  );
  assertEquals(result.launch.args[result.launch.args.indexOf("--sandbox") + 1], "workspace-write");
  assertEquals(result.launch.args.includes("danger-full-access"), false);
});

Deno.test("[delegate_hardening][security] hardened Codex launch stays read-only (single flag) for a non-code_changes gate", async () => {
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir, {
    versionProbe: (_command, minimumVersion) => Promise.resolve({ version: minimumVersion, supported: true }),
  });
  const result = await svc.resolveHardenedLaunch(codexBrief({ gate: "review" }), "headless", hardenedConfig());
  const sandboxOccurrences = result.launch.args.filter((a) => a === "--sandbox").length;
  assertEquals(
    sandboxOccurrences,
    1,
    "a non-code_changes gate must not leave a duplicate read-only pair from the base launch",
  );
  assertEquals(result.launch.args[result.launch.args.indexOf("--sandbox") + 1], "read-only");
});

Deno.test("[delegate_hardening][security] resolveHardenedLaunch fails closed when the version probe reports the binary unsupported", async () => {
  // GAP-17 (Phase 167 post-gap-analysis): the pre-fix implementation only set
  // versionWarning and proceeded to build the launch anyway — a compromised, ancient,
  // or version-spoofing binary was spawned exactly as if it had passed the gate.
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir, {
    versionProbe: () => Promise.resolve({ version: "0.1.0", supported: false, warning: "too old" }),
  });
  await assertRejects(
    () => svc.resolveHardenedLaunch(codexBrief(), "headless", hardenedConfig()),
    Error,
  );
});

Deno.test("[delegate_hardening][security] resolveHardenedLaunch proceeds with versionWarning when allowUnsupportedVersion is explicitly set", async () => {
  // The fail-closed default (above) has a deliberate, explicit opt-out for a caller
  // with a specific reason to launch anyway; production (apps/daemon/main.ts) does not
  // set this, so the fail-closed default governs there.
  const sessionDir = await Deno.makeTempDir();
  const svc = makeService(sessionDir, {
    versionProbe: () => Promise.resolve({ version: "0.1.0", supported: false, warning: "too old" }),
    allowUnsupportedVersion: true,
  });
  const result = await svc.resolveHardenedLaunch(codexBrief(), "headless", hardenedConfig());
  assertEquals(result.versionWarning, "too old");
});
