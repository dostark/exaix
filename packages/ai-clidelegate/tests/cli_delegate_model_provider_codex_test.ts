/**
 * @module CliDelegateModelProviderCodexTest
 * @path packages/ai-clidelegate/tests/cli_delegate_model_provider_codex_test.ts
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 * @architectural-layer AI
 * @description Phase 166 Step 2 — verifies CliDelegateModelProvider drives a headless
 * `codex exec --json` subprocess for tool: "codex": argv shape (exec --json --sandbox
 * read-only --model <m>), --output-schema temp-file lifecycle (written under cwd, removed
 * after the subprocess exits regardless of exit code, dropped in favor of resume
 * continuity when both a schema and a cached session exist, and a removal failure logged
 * rather than silently swallowed), thread_id-based session resume, codex's JSONL stdout
 * mapped into IGenerateResult without opencode's OPENCODE_CONFIG/plan-schema-adapter
 * machinery, and that OPENAI_API_KEY/CODEX_API_KEY never reach the spawned subprocess env.
 * Also regression-guards that the three-way tool dispatch replacing the old isClaude
 * boolean left claude-code/opencode behavior unchanged.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import type { IRunCliDelegateProcess } from "../src/cli_delegate_model_provider.ts";
import { ModelProviderError } from "@exaix/ai/providers";

const CODEX_MODEL = "gpt-5.6-terra";

function codexAgentMessageStdout(text: string): string {
  return JSON.stringify({ type: "item.completed", item: { id: "i1", type: "agent_message", text } });
}

Deno.test("CliDelegateModelProvider: builds codex argv with exec --json --sandbox read-only --model <m> <prompt> for a fresh call with no sessionId", async () => {
  let seenCommand = "";
  let seenArgs: string[] = [];
  const run: IRunCliDelegateProcess = (command, args) => {
    seenCommand = command;
    seenArgs = args;
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" });
  };

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  assertEquals(seenCommand, "codex");
  assertEquals(seenArgs, [
    "exec",
    "--json",
    "--model",
    CODEX_MODEL,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "Analyze this request",
  ]);
});

Deno.test("CliDelegateModelProvider: codex adds --output-schema <path> under cwd when jsonSchema is set and no sessionId exists", async () => {
  const cwd = await Deno.makeTempDir();
  try {
    let seenArgs: string[] = [];
    let schemaFileContentDuringRun = "";
    const run: IRunCliDelegateProcess = async (_command, args) => {
      seenArgs = args;
      const schemaIdx = args.indexOf("--output-schema");
      if (schemaIdx >= 0) {
        schemaFileContentDuringRun = await Deno.readTextFile(args[schemaIdx + 1]);
      }
      return { code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" };
    };

    const provider = new CliDelegateModelProvider({ tool: "codex", bin: "codex", model: CODEX_MODEL, cwd, run });

    await provider.generate("prompt", { jsonSchema: { type: "object", properties: {} } });

    const schemaIdx = seenArgs.indexOf("--output-schema");
    assertEquals(schemaIdx >= 0, true);
    assertEquals(seenArgs[schemaIdx + 1].startsWith(cwd), true);
    assertEquals(JSON.parse(schemaFileContentDuringRun), { type: "object", properties: {} });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("CliDelegateModelProvider: codex removes the --output-schema temp file after the subprocess exits, including on a non-zero exit", async () => {
  const cwd = await Deno.makeTempDir();
  try {
    let lastSchemaPath = "";

    const successRun: IRunCliDelegateProcess = (_command, args) => {
      lastSchemaPath = args[args.indexOf("--output-schema") + 1];
      return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" });
    };
    const successProvider = new CliDelegateModelProvider({
      tool: "codex",
      bin: "codex",
      model: CODEX_MODEL,
      cwd,
      run: successRun,
    });
    await successProvider.generate("prompt", { jsonSchema: { type: "object" } });
    await assertRejects(() => Deno.stat(lastSchemaPath));

    const failRun: IRunCliDelegateProcess = (_command, args) => {
      lastSchemaPath = args[args.indexOf("--output-schema") + 1];
      return Promise.resolve({ code: 1, stdout: "", stderr: "boom" });
    };
    const failProvider = new CliDelegateModelProvider({
      tool: "codex",
      bin: "codex",
      model: CODEX_MODEL,
      cwd,
      run: failRun,
    });
    await assertRejects(
      () => failProvider.generate("prompt", { jsonSchema: { type: "object" } }),
      ModelProviderError,
    );
    await assertRejects(() => Deno.stat(lastSchemaPath));
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("CliDelegateModelProvider: codex drops --output-schema and keeps resume when both jsonSchema and a cached sessionId are present", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve({
        code: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread_abc" }),
          codexAgentMessageStdout("first"),
        ].join("\n"),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("second"), stderr: "" });
  };

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call", { conversationId: "req-1" });
  await provider.generate("second call", { conversationId: "req-1", jsonSchema: { type: "object" } });

  assertEquals(seenArgsPerCall[1].includes("--output-schema"), false);
  const resumeIdx = seenArgsPerCall[1].indexOf("resume");
  assertEquals(resumeIdx >= 0, true);
  assertEquals(seenArgsPerCall[1][resumeIdx + 1], "thread_abc");
});

Deno.test("CliDelegateModelProvider: codex's second call with the same conversationId resumes via resume <thread_id>", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve({
        code: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread_xyz" }),
          codexAgentMessageStdout("first turn"),
        ].join("\n"),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("second turn"), stderr: "" });
  };

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call", { conversationId: "req-1" });
  await provider.generate("second call", { conversationId: "req-1" });

  assertEquals(seenArgsPerCall[0].includes("resume"), false);
  const resumeIdx = seenArgsPerCall[1].indexOf("resume");
  assertEquals(resumeIdx >= 0, true);
  assertEquals(seenArgsPerCall[1][resumeIdx + 1], "thread_xyz");
});

Deno.test("CliDelegateModelProvider: codex captures thread_id from thread.started even when it is not the very first stdout line", async () => {
  const seenArgsPerCall: string[][] = [];
  let callIndex = 0;
  const run: IRunCliDelegateProcess = (_command, args) => {
    seenArgsPerCall.push(args);
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve({
        code: 0,
        stdout: [
          "",
          JSON.stringify({ type: "thread.started", thread_id: "thread_scanned" }),
          codexAgentMessageStdout("first"),
        ].join("\n"),
        stderr: "",
      });
    }
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("second"), stderr: "" });
  };

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("first call", { conversationId: "req-2" });
  await provider.generate("second call", { conversationId: "req-2" });

  const resumeIdx = seenArgsPerCall[1].indexOf("resume");
  assertEquals(resumeIdx >= 0, true);
  assertEquals(seenArgsPerCall[1][resumeIdx + 1], "thread_scanned");
});

Deno.test("CliDelegateModelProvider: maps codex JSONL into IGenerateResult (last agent_message text + turn.completed tokens)", async () => {
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread_1" }),
        codexAgentMessageStdout("Analysis complete."),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 10 },
        }),
      ].join("\n"),
      stderr: "",
    });

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("Analyze this request");

  assertEquals(result.content, "Analysis complete.");
  assertEquals(result.usage, { promptTokens: 100, completionTokens: 40, totalTokens: 140 });
  assertEquals(result.model, CODEX_MODEL);
  assertEquals(result.provider, "codex");
  assertEquals(result.cost_usd, 0);
});

Deno.test("CliDelegateModelProvider: codex calls do NOT set OPENCODE_CONFIG", async () => {
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" });
  };

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  await provider.generate("Analyze this request");

  assertEquals(seenEnv?.OPENCODE_CONFIG, undefined);
});

Deno.test("CliDelegateModelProvider: codex content is never passed through the opencode plan-schema adapter", async () => {
  // A codex response containing the literal string "edit_file" (e.g. explaining the fix in
  // prose) must be returned verbatim — the adapter only ever applies to tool: "opencode".
  const proseWithEditFile = "I used edit_file conceptually to describe the change.";
  const run: IRunCliDelegateProcess = () =>
    Promise.resolve({ code: 0, stdout: codexAgentMessageStdout(proseWithEditFile), stderr: "" });

  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: CODEX_MODEL,
    cwd: "/tmp/portal",
    run,
  });

  const result = await provider.generate("prompt");

  assertEquals(result.content, proseWithEditFile);
});

Deno.test("[security] CliDelegateModelProvider: strips and empties OPENAI_API_KEY/CODEX_API_KEY from the spawned env", async () => {
  let seenEnv: Record<string, string> | undefined;
  const run: IRunCliDelegateProcess = (_command, _args, options) => {
    seenEnv = options.env;
    return Promise.resolve({ code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" });
  };

  Deno.env.set("OPENAI_API_KEY", "sk-should-not-reach-subprocess");
  Deno.env.set("CODEX_API_KEY", "codex-key-should-not-reach-subprocess");
  try {
    const provider = new CliDelegateModelProvider({
      tool: "codex",
      bin: "codex",
      model: CODEX_MODEL,
      cwd: "/tmp/portal",
      run,
    });
    await provider.generate("prompt");
  } finally {
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("CODEX_API_KEY");
  }

  assertEquals(seenEnv?.OPENAI_API_KEY, undefined);
  assertEquals(seenEnv?.CODEX_API_KEY, undefined);
});

Deno.test("[regression] CliDelegateModelProvider: claude-code and opencode generate() behavior is unchanged by the codex three-way dispatch", async () => {
  const claudeRun: IRunCliDelegateProcess = () =>
    Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: "claude answer",
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0,
      }),
      stderr: "",
    });
  const claudeProvider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run: claudeRun,
  });
  const claudeResult = await claudeProvider.generate("prompt");
  assertEquals(claudeResult.content, "claude answer");
  assertEquals(claudeResult.provider, "claude-code");

  let opencodeEnv: Record<string, string> | undefined;
  const opencodeRun: IRunCliDelegateProcess = (_command, _args, options) => {
    opencodeEnv = options.env;
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "text", part: { text: "opencode answer" } }),
      stderr: "",
    });
  };
  const opencodeProvider = new CliDelegateModelProvider({
    tool: "opencode",
    bin: "opencode",
    model: "opencode/deepseek-v4-flash-free",
    cwd: "/tmp/portal",
    run: opencodeRun,
  });
  const opencodeResult = await opencodeProvider.generate("prompt");
  assertEquals(opencodeResult.content, "opencode answer");
  assertEquals(typeof opencodeEnv?.OPENCODE_CONFIG, "string");
});

Deno.test("CliDelegateModelProvider: codex warns (does not throw) when the --output-schema temp file was already removed by the time cleanup runs", async () => {
  const cwd = await Deno.makeTempDir();
  const warnSpy = spy(console, "warn");
  try {
    const run: IRunCliDelegateProcess = async (_command, args) => {
      // Simulate the schema temp file already being gone by the time generate()'s own
      // finally-block cleanup runs (e.g. an external cleanup, a race) — delete it here,
      // inside the fake subprocess callback, so the SECOND removal attempt fails.
      const schemaPath = args[args.indexOf("--output-schema") + 1];
      await Deno.remove(schemaPath);
      return { code: 0, stdout: codexAgentMessageStdout("ok"), stderr: "" };
    };
    const provider = new CliDelegateModelProvider({
      tool: "codex",
      bin: "codex",
      model: CODEX_MODEL,
      cwd,
      run,
    });

    const result = await provider.generate("prompt", { jsonSchema: { type: "object" } });

    assertEquals(result.content, "ok");
    assertSpyCalls(warnSpy, 1);
    assertStringIncludes(String(warnSpy.calls[0].args[0]), "schema temp file");
  } finally {
    warnSpy.restore();
    await Deno.remove(cwd, { recursive: true });
  }
});
