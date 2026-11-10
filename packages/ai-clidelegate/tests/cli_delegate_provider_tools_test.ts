/**
 * @module CliDelegateProviderToolsTest
 * @path packages/ai-clidelegate/tests/cli_delegate_provider_tools_test.ts
 * @description Checks the opt-in native-tool policy for direct CLI provider calls.
 * @architectural-layer Test
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import type { IRunCliDelegateProcess } from "../src/cli_delegate_model_provider.ts";

const CLAUDE_STDOUT = JSON.stringify({
  type: "result",
  result: "ok",
  usage: { input_tokens: 1, output_tokens: 1 },
  total_cost_usd: 0,
});

const CODEX_STDOUT = JSON.stringify({
  type: "item.completed",
  item: { id: "i1", type: "agent_message", text: "ok" },
});

const OPENCODE_STDOUT = `${JSON.stringify({ type: "text", part: { text: "ok" } })}\n${
  JSON.stringify({ type: "step_finish", part: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 } })
}`;

function captureRun(stdout: string, seen: { args?: string[]; env?: Record<string, string> }): IRunCliDelegateProcess {
  return (_command, args, options) => {
    seen.args = args;
    seen.env = options.env;
    return Promise.resolve({ code: 0, stdout, stderr: "" });
  };
}

Deno.test("claude provider keeps its read-only argv when no tool policy is configured", async () => {
  const seen: { args?: string[] } = {};
  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    run: captureRun(CLAUDE_STDOUT, seen),
  });
  await provider.generate("prompt");
  assertEquals(seen.args?.includes("--allowedTools"), false);
});

Deno.test("claude provider passes configured allowed tools as one flag", async () => {
  const seen: { args?: string[] } = {};
  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: "claude-sonnet-5",
    cwd: "/tmp/portal",
    providerTools: { claudeAllowedTools: ["Bash(./run-tests.sh)", "Bash(cd:*)"] },
    run: captureRun(CLAUDE_STDOUT, seen),
  });
  await provider.generate("prompt");
  const index = seen.args?.indexOf("--allowedTools") ?? -1;
  assertEquals(index >= 0, true);
  assertEquals(seen.args?.[index + 1], "Bash(./run-tests.sh),Bash(cd:*)");
});

Deno.test("claude provider rejects a blanket Bash grant", async () => {
  for (const tool of ["Bash", "Bash(*)"]) {
    const provider = new CliDelegateModelProvider({
      tool: "claude-code",
      bin: "claude",
      model: "claude-sonnet-5",
      cwd: "/tmp/portal",
      providerTools: { claudeAllowedTools: [tool] },
      run: captureRun(CLAUDE_STDOUT, {}),
    });
    await assertRejects(() => provider.generate("prompt"), Error, "Invalid Claude allowed tool");
  }
});

Deno.test("codex provider keeps the read-only sandbox by default", async () => {
  const seen: { args?: string[] } = {};
  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: "gpt-6.1-terra",
    cwd: "/tmp/portal",
    run: captureRun(CODEX_STDOUT, seen),
  });
  await provider.generate("prompt");
  const index = seen.args?.indexOf("--sandbox") ?? -1;
  assertEquals(seen.args?.[index + 1], "read-only");
});

Deno.test("codex provider uses the configured workspace-write sandbox", async () => {
  const seen: { args?: string[] } = {};
  const provider = new CliDelegateModelProvider({
    tool: "codex",
    bin: "codex",
    model: "gpt-6.1-terra",
    cwd: "/tmp/portal",
    providerTools: { codexSandbox: "workspace-write" },
    run: captureRun(CODEX_STDOUT, seen),
  });
  await provider.generate("prompt");
  const index = seen.args?.indexOf("--sandbox") ?? -1;
  assertEquals(seen.args?.[index + 1], "workspace-write");
});

Deno.test("workspace_tmp creates a workspace-local TMPDIR for the child", async () => {
  const cwd = await Deno.makeTempDir();
  try {
    const seen: { env?: Record<string, string> } = {};
    const provider = new CliDelegateModelProvider({
      tool: "claude-code",
      bin: "claude",
      model: "claude-sonnet-5",
      cwd,
      providerTools: { workspaceTmp: true },
      run: captureRun(CLAUDE_STDOUT, seen),
    });
    await provider.generate("prompt");
    assertEquals(seen.env?.TMPDIR, join(cwd, ".exa", "tmp"));
    assertEquals((await Deno.stat(seen.env?.TMPDIR ?? "")).isDirectory, true);
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("opencode provider keeps bash denied by default and allows it only on opt-in", async () => {
  const cwd = await Deno.makeTempDir();
  try {
    const denied: { env?: Record<string, string> } = {};
    await new CliDelegateModelProvider({
      tool: "opencode",
      bin: "opencode",
      model: "opencode/test",
      cwd,
      run: captureRun(OPENCODE_STDOUT, denied),
    }).generate("prompt");
    const deniedConfig = JSON.parse(await Deno.readTextFile(denied.env?.OPENCODE_CONFIG ?? ""));
    assertEquals(deniedConfig.permission.bash, "deny");
    assertEquals(deniedConfig.permission.edit, "deny");

    const allowed: { env?: Record<string, string> } = {};
    await new CliDelegateModelProvider({
      tool: "opencode",
      bin: "opencode",
      model: "opencode/test",
      cwd,
      providerTools: { opencodeBash: "allow" },
      run: captureRun(OPENCODE_STDOUT, allowed),
    }).generate("prompt");
    const allowedConfig = JSON.parse(await Deno.readTextFile(allowed.env?.OPENCODE_CONFIG ?? ""));
    assertEquals(allowedConfig.permission.bash, "allow");
    assertEquals(allowedConfig.permission.edit, "deny");
    assertEquals(allowedConfig.permission.task, "deny");
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});
