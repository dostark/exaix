/**
 * @module CliDelegateStrategyTest
 * @path packages/execution/tests/agents/cli_delegate_strategy_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts]
 * @architectural-layer Services
 * @description Verifies CliDelegateStrategy drives the configured headless CLI
 * (claude / opencode), both via a cold subprocess spawn per plan step resumed
 * with a captured session id, parses output into a changeset result, and
 * throws loudly (no silent fallback to the API path) when the tool cannot be
 * run. Both tools share the same injectable `run` seam.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CliDelegateStrategy } from "@exaix/execution";
import { AgentExecutionError, type IAgentFileBlueprint } from "@exaix/execution";
import { AgentExecutionErrorType, CLI_DELEGATE_TURN_TIMEOUT_MS, ExecutionStrategyName } from "@exaix/core";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { IRunCliDelegateProcess } from "@exaix/execution";

function makeBlueprint(): IAgentFileBlueprint {
  return {
    name: "senior-coder",
    model: "",
    provider: "",
    capabilities: ["code_generation", "cli_delegate"],
    systemPrompt: "You are an expert software engineer.",
  };
}

function makeContext(overrides: Partial<IExecutionContext> = {}): IExecutionContext {
  return {
    trace_id: "11111111-1111-1111-1111-111111111111",
    request_id: "REQ-1",
    request: "Fix the null-guard bug in renderAvatar",
    plan: "Step 1: patch renderAvatar",
    portal: "main",
    ...overrides,
  };
}

function makeOptions(): IAgentExecutionOptions {
  return {
    identity_id: "senior-coder",
    portal: "main",
    security_mode: "sandboxed" as IAgentExecutionOptions["security_mode"],
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

interface IResultLineOverrides {
  total_cost_usd?: number;
}

function systemLine(sessionId: string): string {
  return JSON.stringify({ type: "system", session_id: sessionId });
}

function resultLine(result: string, extra: IResultLineOverrides = {}): string {
  return JSON.stringify({ type: "result", result, usage: { input_tokens: 120, output_tokens: 45 }, ...extra });
}

Deno.test("CliDelegateStrategy: name is ExecutionStrategyName.CLI_DELEGATE", () => {
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
  });
  assertEquals(strategy.name, ExecutionStrategyName.CLI_DELEGATE);
});

Deno.test("CliDelegateStrategy: parses a claude-code turn's result into a changeset", async () => {
  const run: IRunCliDelegateProcess = (_command, _args, _options) =>
    Promise.resolve({
      code: 0,
      stdout: [
        systemLine("ses_claude_1"),
        resultLine("Fixed the null guard in renderAvatar.", { total_cost_usd: 0.0021 }),
      ].join("\n"),
      stderr: "",
    });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const result = await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(result.description, "Fixed the null guard in renderAvatar.");
  assertEquals(result.usage?.prompt_tokens, 120);
  assertEquals(result.usage?.completion_tokens, 45);
  assertEquals(result.usage?.cost_usd, 0.0021);
});

Deno.test("CliDelegateStrategy: builds claude argv with -p <objective>, stream-json output, and permission flags", async () => {
  let capturedArgs: string[] = [];
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedArgs = args;
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(capturedArgs[0], "-p");
  assertStringIncludes(capturedArgs[1], "Fix the null-guard bug in renderAvatar");
  assertEquals(capturedArgs.includes("--output-format"), true);
  assertEquals(capturedArgs.includes("stream-json"), true);
  assertEquals(capturedArgs.includes("--permission-mode"), true);
  assertEquals(capturedArgs.includes("acceptEdits"), true);
  assertEquals(capturedArgs.includes("--allowedTools"), true);
});

Deno.test("CliDelegateStrategy: passes CLI_DELEGATE_TURN_TIMEOUT_MS (not SafeSubprocess's generic 30s default) to a claude turn", async () => {
  let capturedTimeoutMs: number | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    capturedTimeoutMs = options.timeoutMs;
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(capturedTimeoutMs, CLI_DELEGATE_TURN_TIMEOUT_MS);
});

Deno.test("CliDelegateStrategy: a trace's first claude turn includes context.full_plan in the objective", async () => {
  let capturedObjective = "";
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedObjective = args[1];
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(
    makeBlueprint(),
    makeContext({ full_plan: "STEP 1: read files\n\n---\n\nSTEP 2: patch the bug\n\n---\n\nSTEP 3: run tests" }),
    makeOptions(),
  );

  assertStringIncludes(capturedObjective, "FULL PLAN:");
  assertStringIncludes(capturedObjective, "STEP 2: patch the bug");
  assertStringIncludes(capturedObjective, "STEP 3: run tests");
});

Deno.test("CliDelegateStrategy: a trace's second claude turn omits the full plan (already in the resumed session's history)", async () => {
  const capturedObjectives: string[] = [];
  let call = 0;
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedObjectives.push(args[1]);
    call++;
    if (call === 1) {
      return Promise.resolve({
        code: 0,
        stdout: [systemLine("ses_full_plan"), resultLine("step 1 done")].join("\n"),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: resultLine("step 2 done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const context = makeContext({ full_plan: "STEP 1: read files\n\n---\n\nSTEP 2: patch the bug" });
  await strategy.execute(makeBlueprint(), context, makeOptions());
  await strategy.execute(makeBlueprint(), context, makeOptions());

  assertStringIncludes(capturedObjectives[0], "FULL PLAN:");
  assertEquals(capturedObjectives[1].includes("FULL PLAN:"), false);
});

Deno.test("CliDelegateStrategy: without context.full_plan, the objective has no FULL PLAN section", async () => {
  let capturedObjective = "";
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedObjective = args[1];
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(capturedObjective.includes("FULL PLAN:"), false);
});

Deno.test("CliDelegateStrategy: passes CLI_DELEGATE_TURN_TIMEOUT_MS to an opencode step", async () => {
  let capturedTimeoutMs: number | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    capturedTimeoutMs = options.timeoutMs;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "opencode",
    bin: "opencode",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(capturedTimeoutMs, CLI_DELEGATE_TURN_TIMEOUT_MS);
});

Deno.test("CliDelegateStrategy: strips ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN from the claude subprocess env", async () => {
  const originalKey = Deno.env.get("ANTHROPIC_API_KEY");
  const originalToken = Deno.env.get("ANTHROPIC_AUTH_TOKEN");
  Deno.env.set("ANTHROPIC_API_KEY", "sk-should-not-reach-subprocess");
  Deno.env.set("ANTHROPIC_AUTH_TOKEN", "token-should-not-reach-subprocess");

  let capturedEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    capturedEnv = options.env;
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  try {
    const strategy = new CliDelegateStrategy({
      tool: "claude-code",
      bin: "claude",
      resolvePortalPath: () => "/tmp/portal",
      run,
    });
    await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

    assertEquals(capturedEnv?.ANTHROPIC_API_KEY, undefined);
    assertEquals(capturedEnv?.ANTHROPIC_AUTH_TOKEN, undefined);
  } finally {
    if (originalKey === undefined) Deno.env.delete("ANTHROPIC_API_KEY");
    else Deno.env.set("ANTHROPIC_API_KEY", originalKey);
    if (originalToken === undefined) Deno.env.delete("ANTHROPIC_AUTH_TOKEN");
    else Deno.env.set("ANTHROPIC_AUTH_TOKEN", originalToken);
  }
});

Deno.test("CliDelegateStrategy: overrides the subprocess PWD env var to match the resolved portal/worktree path, not the daemon's own stale PWD", async () => {
  // Live-observed root cause: Deno.Command's `cwd` option changes the OS-level working
  // directory the subprocess is spawned into, but does NOT touch a `PWD` env var inherited
  // via Deno.env.toObject() (buildDelegateEnv's base) — the daemon's own PWD (wherever it was
  // originally launched from) leaks through unchanged. opencode's CLI (JS/TS-based) resolves
  // relative tool-call paths against process.env.PWD rather than the kernel cwd, so a write
  // meant for a worktree checkout silently landed in the daemon's own launch directory
  // instead — reproduced via a minimal Deno.Command + real opencode probe before this fix.
  const originalPwd = Deno.env.get("PWD");
  Deno.env.set("PWD", "/some/stale/daemon/launch/dir");

  let capturedEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    capturedEnv = options.env;
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };

  try {
    const strategy = new CliDelegateStrategy({
      tool: "opencode",
      bin: "opencode",
      resolvePortalPath: () => "/tmp/worktree-checkout",
      run,
    });
    await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

    assertEquals(capturedEnv?.PWD, "/tmp/worktree-checkout");
  } finally {
    if (originalPwd === undefined) Deno.env.delete("PWD");
    else Deno.env.set("PWD", originalPwd);
  }
});

Deno.test("CliDelegateStrategy: claude's second call for the same trace_id resumes with the captured session id", async () => {
  const capturedArgsPerCall: string[][] = [];
  let call = 0;
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedArgsPerCall.push(args);
    call++;
    if (call === 1) {
      return Promise.resolve({
        code: 0,
        stdout: [systemLine("ses_claude_abc"), resultLine("step 1 done")].join("\n"),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: resultLine("step 2 done"), stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const context = makeContext();
  const first = await strategy.execute(makeBlueprint(), context, makeOptions());
  const second = await strategy.execute(makeBlueprint(), context, makeOptions());

  assertEquals(capturedArgsPerCall[0].includes("--resume"), false);
  const resumeIndex = capturedArgsPerCall[1].indexOf("--resume");
  assertEquals(resumeIndex >= 0, true);
  assertEquals(capturedArgsPerCall[1][resumeIndex + 1], "ses_claude_abc");
  assertEquals(first.description, "step 1 done");
  assertEquals(second.description, "step 2 done");
});

Deno.test("CliDelegateStrategy: two different trace_ids never pass --resume to claude", async () => {
  const capturedArgsPerCall: string[][] = [];
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedArgsPerCall.push(args);
    return Promise.resolve({
      code: 0,
      stdout: [systemLine("ses_x"), resultLine("done")].join("\n"),
      stderr: "",
    });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(
    makeBlueprint(),
    makeContext({ trace_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    makeOptions(),
  );
  await strategy.execute(
    makeBlueprint(),
    makeContext({ trace_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
    makeOptions(),
  );

  assertEquals(capturedArgsPerCall[0].includes("--resume"), false);
  assertEquals(capturedArgsPerCall[1].includes("--resume"), false);
});

Deno.test("CliDelegateStrategy: builds opencode argv with run, --format json, and objective", async () => {
  let capturedArgs: string[] = [];
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedArgs = args;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "opencode",
    bin: "opencode",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(capturedArgs[0], "run");
  assertEquals(capturedArgs[1], "--format");
  assertEquals(capturedArgs[2], "json");
  assertStringIncludes(capturedArgs[3], "Fix the null-guard bug in renderAvatar");
});

Deno.test("CliDelegateStrategy: opencode's second call for the same trace_id passes --session with the captured id", async () => {
  const capturedArgsPerCall: string[][] = [];
  let call = 0;
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    capturedArgsPerCall.push(args);
    call++;
    if (call === 1) {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ type: "text", sessionID: "ses_abc123", part: { text: "ok" } }),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  const strategy = new CliDelegateStrategy({
    tool: "opencode",
    bin: "opencode",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const context = makeContext();
  await strategy.execute(makeBlueprint(), context, makeOptions());
  await strategy.execute(makeBlueprint(), context, makeOptions());

  assertEquals(capturedArgsPerCall[0].includes("--session"), false);
  const sessionFlagIndex = capturedArgsPerCall[1].indexOf("--session");
  assertEquals(sessionFlagIndex >= 0, true);
  assertEquals(capturedArgsPerCall[1][sessionFlagIndex + 1], "ses_abc123");
});

Deno.test("CliDelegateStrategy: throws AgentExecutionError (no fallback) when the claude binary cannot be spawned", async () => {
  const run: IRunCliDelegateProcess = () => {
    throw new Error("Command not found: claude");
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const err = await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(err.type, AgentExecutionErrorType.CONFIGURATION_ERROR);
});

Deno.test("CliDelegateStrategy: throws AgentExecutionError when a claude turn reports is_error", async () => {
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        is_error: true,
        result: "authentication failed",
        usage: { input_tokens: 1, output_tokens: 0 },
      }),
      stderr: "",
    });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const err = await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(err.type, AgentExecutionErrorType.CONFIGURATION_ERROR);
  assertStringIncludes(err.message, "authentication failed");
});

Deno.test("CliDelegateStrategy: throws AgentExecutionError when the claude subprocess exits non-zero", async () => {
  const run: IRunCliDelegateProcess = () => Promise.resolve({ code: 1, stdout: "", stderr: "authentication failed" });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const err = await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(err.type, AgentExecutionErrorType.CONFIGURATION_ERROR);
  assertStringIncludes(err.message, "authentication failed");
});

Deno.test("CliDelegateStrategy: throws AgentExecutionError when the opencode subprocess exits non-zero", async () => {
  const run: IRunCliDelegateProcess = (_command, _args, _options) =>
    Promise.resolve({ code: 1, stdout: "", stderr: "authentication failed" });

  const strategy = new CliDelegateStrategy({
    tool: "opencode",
    bin: "opencode",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const err = await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(err.type, AgentExecutionErrorType.CONFIGURATION_ERROR);
  assertStringIncludes(err.message, "authentication failed");
});

Deno.test("CliDelegateStrategy: parses opencode JSONL events for files_changed and usage, normalizing opencode's absolute filePath to a portal-relative path", async () => {
  // Verified live (2026-07-20): opencode's real `edit`/`write` tool_use events report
  // filePath as an ABSOLUTE path, not portal-relative. GitAuditService's unauthorized-
  // change check compares against `git status --porcelain` output, which is always
  // relative — an unnormalized absolute path here never matches and every real opencode
  // edit gets reverted as a false-positive security violation.
  const events = [
    JSON.stringify({ type: "text", part: { text: "Patched the null guard." } }),
    JSON.stringify({
      type: "tool_use",
      part: { tool: "edit", state: { input: { filePath: "/tmp/portal/src/render_avatar.ts" } } },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 200, output: 80, total: 280 }, cost: 0.004 },
    }),
  ].join("\n");

  const run: IRunCliDelegateProcess = (_command, _args, _options) =>
    Promise.resolve({ code: 0, stdout: events, stderr: "" });

  const strategy = new CliDelegateStrategy({
    tool: "opencode",
    bin: "opencode",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const result = await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(result.description, "Patched the null guard.");
  assertEquals(result.files_changed, ["src/render_avatar.ts"]);
  assertEquals(result.usage?.prompt_tokens, 200);
  assertEquals(result.usage?.completion_tokens, 80);
  assertEquals(result.usage?.cost_usd, 0.004);
});

Deno.test("CliDelegateStrategy: throws AgentExecutionError when the portal path cannot be resolved", async () => {
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => undefined,
  });

  const err = await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(err.type, AgentExecutionErrorType.CONFIGURATION_ERROR);
  assertStringIncludes(err.message, "main");
});

Deno.test("CliDelegateStrategy: dispose() clears tracked session ids without throwing", async () => {
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: [systemLine("ses_1"), resultLine("done")].join("\n"),
      stderr: "",
    });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());
  strategy.dispose();
});
