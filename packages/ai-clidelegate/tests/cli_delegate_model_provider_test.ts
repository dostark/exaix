/**
 * @module CliDelegateModelProviderTest
 * @path packages/ai-clidelegate/tests/cli_delegate_model_provider_test.ts
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 * @architectural-layer AI
 * @description Verifies CliDelegateModelProvider drives a headless claude/opencode CLI
 * subprocess for a stateless generate() call — no --resume/session-id (each call is
 * independent), env auth stripped, and both tools' stdout shapes parsed into IGenerateResult.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import type { IRunCliDelegateProcess } from "../src/cli_delegate_model_provider.ts";
import { ModelProviderError } from "@exaix/ai/providers";

Deno.test("CliDelegateModelProvider: builds claude argv with -p, prompt, --output-format json, --model", async () => {
  let seenCommand = "";
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (command, args) => {
    seenCommand = command;
    seenArgs = args;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: "Analysis complete.",
        usage: { input_tokens: 100, output_tokens: 40 },
        total_cost_usd: 0,
      }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  assertEquals(seenCommand, "claude");
  assertEquals(seenArgs, ["-p", "Analyze this request", "--output-format", "json", "--model", "claude-sonnet-5"]);
});

Deno.test("CliDelegateModelProvider: builds opencode argv with run, --format json, --model, prompt", async () => {
  let seenCommand = "";
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (command, args) => {
    seenCommand = command;
    seenArgs = args;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "text",
        part: { text: "Analysis complete." },
      }) + "\n" + JSON.stringify({
        type: "step_finish",
        part: { tokens: { input: 100, output: 40, total: 140 }, cost: 0 },
      }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  assertEquals(seenCommand, "opencode");
  assertEquals(seenArgs, [
    "run",
    "--format",
    "json",
    "--model",
    "opencode/deepseek-v4-flash-free",
    "Analyze this request",
  ]);
});

Deno.test("CliDelegateModelProvider: opencode calls set OPENCODE_CONFIG to a config that denies edit/bash/task", async () => {
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "text", part: { text: "Analysis complete." } }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  const configPath = seenEnv?.OPENCODE_CONFIG;
  assertEquals(typeof configPath, "string");
  const raw = await Deno.readTextFile(configPath!);
  const parsed = JSON.parse(raw);
  assertEquals(parsed.permission.edit, "deny");
  assertEquals(parsed.permission.bash, "deny");
  assertEquals(parsed.permission.task, "deny");
});

Deno.test("CliDelegateModelProvider: the OPENCODE_CONFIG file is written under cwd, not the system tempdir", async () => {
  // The daemon process only holds --allow-write for its own sandbox/portal tree, not the
  // OS tempdir — Deno.makeTempFile() (which defaults to the OS tempdir) fails with
  // NotCapable there. Verified live: "Requires write access to <TMP>, run again with the
  // --allow-write flag" when this wrote outside cwd.
  const cwd = await Deno.makeTempDir();
  try {
    let seenEnv: Record<string, string> | undefined;
    const run: IRunCliDelegateProcess = (_command, _args, options) => {
      seenEnv = options.env;
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ type: "text", part: { text: "ok" } }),
        stderr: "",
      });
    };

    const provider = new CliDelegateModelProvider({
      tool: "opencode",
      bin: "opencode",
      model: "opencode/deepseek-v4-flash-free",
      cwd,
      run,
    });

    await provider.generate("Analyze this request");

    const configPath = seenEnv?.OPENCODE_CONFIG;
    assertEquals(typeof configPath, "string");
    assertEquals(configPath!.startsWith(cwd), true);
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("CliDelegateModelProvider: claude calls do NOT set OPENCODE_CONFIG", async () => {
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  assertEquals(seenEnv?.OPENCODE_CONFIG, undefined);
});

Deno.test("CliDelegateModelProvider: without conversationId, calls never pass --resume or --session (stateless)", async () => {
  const seenArgsPerCall: string[][] = [];
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call");
  await provider.generate("second call");

  for (const args of seenArgsPerCall) {
    assertEquals(args.includes("--resume"), false);
    assertEquals(args.includes("--session"), false);
  }
});

Deno.test("CliDelegateModelProvider: claude's second call with the same conversationId resumes via --resume <session_id>", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          type: "result",
          result: "first turn",
          session_id: "sess_abc123",
          usage: {},
          total_cost_usd: 0,
        }),
        stderr: "",
      });
    }
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "second turn", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call", { conversationId: "req-1" });
  await provider.generate("second call", { conversationId: "req-1" });

  assertEquals(seenArgsPerCall[0].includes("--resume"), false);
  const resumeIdx = seenArgsPerCall[1].indexOf("--resume");
  assertEquals(resumeIdx >= 0, true);
  assertEquals(seenArgsPerCall[1][resumeIdx + 1], "sess_abc123");
});

Deno.test("CliDelegateModelProvider: opencode's second call with the same conversationId resumes via --session <session_id>", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ type: "text", sessionID: "ses_xyz789", part: { text: "first turn" } }),
        stderr: "",
      });
    }
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "text", sessionID: "ses_xyz789", part: { text: "second turn" } }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call", { conversationId: "req-1" });
  await provider.generate("second call", { conversationId: "req-1" });

  assertEquals(seenArgsPerCall[0].includes("--session"), false);
  const sessionIdx = seenArgsPerCall[1].indexOf("--session");
  assertEquals(sessionIdx >= 0, true);
  assertEquals(seenArgsPerCall[1][sessionIdx + 1], "ses_xyz789");
});

Deno.test("CliDelegateModelProvider: different conversationIds never share a session", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: `turn ${callIndex}`,
        session_id: `sess_${callIndex}`,
        usage: {},
        total_cost_usd: 0,
      }),
      stderr: "",
    });
  };

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("call for req-1", { conversationId: "req-1" });
  await provider.generate("call for req-2", { conversationId: "req-2" });

  for (const args of seenArgsPerCall) {
    assertEquals(args.includes("--resume"), false);
  }
});

Deno.test("CliDelegateModelProvider: strips and empties ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL from the spawned env", async () => {
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  Deno.env.set("ANTHROPIC_API_KEY", "sk-should-not-reach-subprocess");
  Deno.env.set("ANTHROPIC_AUTH_TOKEN", "token-should-not-reach-subprocess");
  try {
    const provider = new CliDelegateModelProvider({
      tool: "claude-code",
      bin: "claude",
      model: "claude-sonnet-5",
      cwd: "/tmp/portal",
      run,
    });
    await provider.generate("prompt");
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
    Deno.env.delete("ANTHROPIC_AUTH_TOKEN");
  }

  assertEquals(seenEnv?.ANTHROPIC_API_KEY, undefined);
  assertEquals(seenEnv?.ANTHROPIC_AUTH_TOKEN, undefined);
  assertEquals(seenEnv?.ANTHROPIC_BASE_URL, undefined);
});

Deno.test("[security] CliDelegateModelProvider: strips LD_*/DYLD_* dynamic-linker env vars from the spawned env", async () => {
  // Deno's scoped --allow-run=<bin> permission (the daemon's own posture — see
  // DAEMON_SPAWN_RUN_BINARIES) refuses to forward any env var whose name starts with
  // "LD_" or "DYLD_" to a spawned child: `Deno.errors.NotCapable: Requires --allow-run
  // permissions to spawn subprocess with <VAR> environment variable. Alternatively,
  // spawn with the environment variable unset.` These vars instruct the dynamic linker
  // to load arbitrary shared libraries into the child, so an operator whose shell sets
  // LD_LIBRARY_PATH/LD_PRELOAD (common: CUDA/conda/HPC toolchains) would otherwise see
  // every headless CLI delegate (claude/opencode/codex) fail every generate() call with
  // a generic "Subprocess failed" error — discovered live while proving Phase 167 Step
  // 3's forced-ReAct Codex evidence on a workstation with LD_LIBRARY_PATH set.
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  Deno.env.set("LD_LIBRARY_PATH", "/should/not/reach/subprocess");
  Deno.env.set("LD_PRELOAD", "/should/not/reach/subprocess.so");
  Deno.env.set("DYLD_INSERT_LIBRARIES", "/should/not/reach/subprocess.dylib");
  try {
    const provider = new CliDelegateModelProvider({
      tool: "claude-code",
      bin: "claude",
      model: "claude-sonnet-5",
      cwd: "/tmp/portal",
      run,
    });
    await provider.generate("prompt");
  } finally {
    Deno.env.delete("LD_LIBRARY_PATH");
    Deno.env.delete("LD_PRELOAD");
    Deno.env.delete("DYLD_INSERT_LIBRARIES");
  }

  assertEquals(seenEnv?.LD_LIBRARY_PATH, undefined);
  assertEquals(seenEnv?.LD_PRELOAD, undefined);
  assertEquals(seenEnv?.DYLD_INSERT_LIBRARIES, undefined);
  // Sanity: clearEnv still forwards ordinary vars — this isn't a blanket env wipe.
  assertEquals(seenEnv?.PATH, Deno.env.get("PATH"));
});

Deno.test("[security] CliDelegateModelProvider: buildDelegateEnv only forwards an explicit allowlist of safe parent env vars", async () => {
  // GAP-14 (Phase 167 post-gap-analysis): the pre-fix implementation was a 7-pattern
  // denylist (5 exact keys + 2 dynamic-linker prefixes) starting from the daemon's FULL
  // ambient environment — any other secret-shaped var (cloud credentials, VCS tokens, DB
  // URLs, the SSH agent socket, or this daemon's OWN OPENROUTER_API_KEY) passed through
  // unfiltered. This test proves the fix: only an explicit safe-key allowlist is forwarded.
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "ok", usage: {}, total_cost_usd: 0 }),
      stderr: "",
    });
  };

  const secretShapedVars: Record<string, string> = {
    AWS_SECRET_ACCESS_KEY: "should-not-reach-subprocess",
    AWS_SESSION_TOKEN: "should-not-reach-subprocess",
    GITHUB_TOKEN: "should-not-reach-subprocess",
    GH_TOKEN: "should-not-reach-subprocess",
    GOOGLE_APPLICATION_CREDENTIALS: "/should/not/reach/subprocess.json",
    NPM_TOKEN: "should-not-reach-subprocess",
    DATABASE_URL: "postgres://should-not-reach-subprocess",
    SSH_AUTH_SOCK: "/should/not/reach/subprocess.sock",
    OPENROUTER_API_KEY: "should-not-reach-subprocess",
  };
  for (const [key, value] of Object.entries(secretShapedVars)) Deno.env.set(key, value);
  try {
    const provider = new CliDelegateModelProvider({
      tool: "claude-code",
      bin: "claude",
      model: "claude-sonnet-5",
      cwd: "/tmp/portal",
      run,
    });
    await provider.generate("prompt");
  } finally {
    for (const key of Object.keys(secretShapedVars)) Deno.env.delete(key);
  }

  for (const key of Object.keys(secretShapedVars)) {
    assertEquals(seenEnv?.[key], undefined, `${key} must not reach the spawned subprocess`);
  }
  // Sanity: the allowlist still forwards ordinary vars — this isn't a blanket env wipe.
  assertEquals(seenEnv?.PATH, Deno.env.get("PATH"));
});

Deno.test("CliDelegateModelProvider: maps claude result into IGenerateResult (content, usage, cost_usd)", async () => {
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: "The request wants a null-safety fix.",
        usage: { input_tokens: 500, output_tokens: 120 },
        total_cost_usd: 0.0421,
      }),
      stderr: "",
    });

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("prompt");

  assertEquals(result.content, "The request wants a null-safety fix.");
  assertEquals(result.usage.promptTokens, 500);
  assertEquals(result.usage.completionTokens, 120);
  assertEquals(result.usage.totalTokens, 620);
  assertEquals(result.model, "claude-sonnet-5");
  assertEquals(result.provider, "claude-code");
  assertEquals(result.cost_usd, 0.0421);
});

Deno.test("CliDelegateModelProvider: maps opencode JSONL into IGenerateResult (last text + step_finish tokens)", async () => {
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: [
        JSON.stringify({ type: "text", part: { text: "The request wants a null-safety fix." } }),
        JSON.stringify({ type: "step_finish", part: { tokens: { input: 300, output: 80, total: 380 }, cost: 0 } }),
      ].join("\n"),
      stderr: "",
    });

  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("prompt");

  assertEquals(result.content, "The request wants a null-safety fix.");
  assertEquals(result.usage.promptTokens, 300);
  assertEquals(result.usage.completionTokens, 80);
  assertEquals(result.usage.totalTokens, 380);
  assertEquals(result.provider, "opencode");
  assertEquals(result.cost_usd, 0);
});

Deno.test("CliDelegateModelProvider: opencode plan JSON using 'edit_file' is normalized to 'patch_file' before being returned", async () => {
  const planJson = JSON.stringify({
    title: "Add null guards",
    description: "d",
    steps: [{
      step: 1,
      title: "t1",
      description: "d1",
      tools: ["edit_file"],
      actions: [{
        tool: "edit_file",
        params: { path: "/ws/src/utils.ts", oldString: "a", newString: "b" },
      }],
    }],
  });
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: [
        JSON.stringify({ type: "text", part: { text: planJson } }),
        JSON.stringify({ type: "step_finish", part: { tokens: { input: 10, output: 10, total: 20 }, cost: 0 } }),
      ].join("\n"),
      stderr: "",
    });

  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("prompt");
  const parsed = JSON.parse(result.content);

  assertEquals(parsed.steps[0].actions[0].tool, "patch_file");
  assertEquals(parsed.steps[0].actions[0].params, {
    path: "/ws/src/utils.ts",
    search: "a",
    replace: "b",
  });
});

Deno.test("CliDelegateModelProvider: claude content is never passed through the opencode plan-schema adapter", async () => {
  // A claude response containing the literal string "edit_file" (e.g. explaining the fix
  // in prose) must be returned verbatim — the adapter only ever applies to tool: "opencode".
  const proseWithEditFile = "I used edit_file conceptually to describe the change.";
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: proseWithEditFile,
        usage: { input_tokens: 10, output_tokens: 10 },
        total_cost_usd: 0,
      }),
      stderr: "",
    });

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("prompt");

  assertEquals(result.content, proseWithEditFile);
});

Deno.test("CliDelegateModelProvider: throws ModelProviderError when the subprocess exits non-zero", async () => {
  const run: IRunCliDelegateProcess = () => Promise.resolve({ code: 1, stdout: "", stderr: "authentication failed" });

  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });

  await assertRejects(() => provider.generate("prompt"), ModelProviderError);
});

Deno.test("CliDelegateModelProvider: id defaults to '<tool>-<model>'", () => {
  const provider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
  });

  assertEquals(provider.id, "opencode-opencode/deepseek-v4-flash-free");
});
