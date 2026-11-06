/**
 * @module ExaCtlRenameHintCliTest
 * @path apps/exactl/tests/exactl_rename_hint_cli_test.ts
 * @description Runs the real exactl binary with removed command paths and checks the rename hint and exit code.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/main.ts, apps/exactl/src/exactl_error_handler.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runExactlInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const USAGE_EXIT_CODE = 2;

async function assertHint(args: string[], expectedReplacement: string): Promise<void> {
  const run = await runExactlInTempWorkspace(args);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, `use '${expectedReplacement}'`);
}

Deno.test("running `exactl blueprint ls` prints the hint on stderr and exits 2", async () => {
  await assertHint(["blueprint", "ls"], "exactl blueprint list");
});

Deno.test("a removed nested path prints the replacement and exits 2", async () => {
  await assertHint(["blueprint", "agent-role", "list"], "exactl blueprint list");
});

Deno.test("a removed path followed by an unknown option still prints the hint", async () => {
  await assertHint(["blueprint", "rm", "some-agent", "--bogus"], "exactl blueprint remove some-agent");
});

Deno.test("removed `exactl journal` with options exits 2 with the log list hint", async () => {
  await assertHint(["journal", "-n", "5"], "exactl log list");
});

Deno.test("each removed journal path names its log replacement", async () => {
  await assertHint(["logs", "--filter", "model_resolved"], "exactl log list");
  await assertHint(["log", "journal", "--count"], "exactl log list");
  await assertHint(["journal", "wait", "--event", "daemon.ready"], "exactl log wait");
  await assertHint(["journal", "verify"], "exactl log verify");
  await assertHint(["cost", "--group-by", "model"], "exactl log cost");
});

Deno.test("the removed skills paths name the skill noun", async () => {
  await assertHint(["skills", "list"], "exactl skill list");
  await assertHint(["memory", "skill", "list"], "exactl skill list");
  await assertHint(["skills", "show", "testing-standard", "--revision", "abc"], "exactl skill show testing-standard");
});

Deno.test("the removed models, routing and config model paths name the model noun", async () => {
  await assertHint(["models", "list"], "exactl model list");
  await assertHint(["models", "pricing"], "exactl model list");
  await assertHint(["routing", "explain", "--request", "r.md"], "exactl model route explain");
  await assertHint(["routing", "policy", "validate", "policy.yaml"], "exactl model route validate policy.yaml");
  await assertHint(["config", "model", "--list"], "exactl model candidates");
  await assertHint(["config", "set-provider", "openai"], "exactl model use openai");
  await assertHint(["config", "set-model", "fast", "gpt-5"], "exactl config set models.<name>.model <model>");
});

Deno.test("the removed plan and memory compound paths name their grouped replacements", async () => {
  await assertHint(["plan", "approve-all"], "exactl plan approve --all");
  await assertHint(["plan", "amendment", "show-all"], "exactl plan amendment show --all");
  await assertHint(["plan", "amendment", "approve-all"], "exactl plan amendment approve --all");
  await assertHint(["memory", "pending", "list", "--eligible"], "exactl memory proposal list");
  await assertHint(["memory", "pending", "approve-all"], "exactl memory proposal approve --all");
  await assertHint(["memory", "delete-learning", "l-1"], "exactl memory learning remove l-1");
  await assertHint(["memory", "rebuild-index", "--include-embeddings"], "exactl memory index rebuild");
});

Deno.test("the removed git, portal, config and mcp paths name their grouped replacements", async () => {
  await assertHint(["git", "branches"], "exactl git branch list");
  await assertHint(["git", "worktrees", "list"], "exactl git worktree list");
  await assertHint(["portal", "analyze", "p", "--force"], "exactl portal knowledge analyze p");
  await assertHint(["portal", "knowledge", "p"], "exactl portal knowledge show p");
  await assertHint(["config", "lock-list"], "exactl config lock list");
  await assertHint(["config", "lock", "ai.timeout_ms"], "exactl config lock add ai.timeout_ms");
  await assertHint(["config", "unlock", "ai.timeout_ms"], "exactl config lock remove ai.timeout_ms");
  await assertHint(["config", "use-profile", "dev"], "exactl config profile use dev");
  await assertHint(["config", "list-profiles"], "exactl config profile list");
  await assertHint(["config", "set-path", "workspace", "/tmp/w"], "exactl config set paths.<key> <dir>");
  await assertHint(["mcp", "start"], "exactl mcp serve");
  await assertHint(
    ["mcp", "connect", "http://localhost:3000/mcp", "--list-tools"],
    "exactl mcp tool list --server <url>, or exactl mcp tool call <tool> --server <url>",
  );
});

Deno.test("`exactl request \"Fix bug\"` prints `exactl request create 'Fix bug'` and exits 2", async () => {
  const run = await runExactlInTempWorkspace(["request", "Fix bug"]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "exactl request create 'Fix bug'");
});

Deno.test("a request description with shell syntax is quoted in the hint and never run", async () => {
  const run = await runExactlInTempWorkspace(["request", "$(touch pwned)", "--priority", "high"]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "exactl request create '$(touch pwned)'");
});

Deno.test("`request create --agent-role x` names `--agent`", async () => {
  const run = await runExactlInTempWorkspace(["request", "create", "Fix bug", "--agent-role", "x"]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "use '--agent'");
});

Deno.test("`request create -a x` names `--agent`", async () => {
  const run = await runExactlInTempWorkspace(["request", "create", "Fix bug", "-a", "x"]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "use '--agent'");
});

Deno.test("`request list -a` is still the --all option and prints no hint", async () => {
  const run = await runExactlInTempWorkspace(["request", "list", "-a"]);
  assertEquals(run.code, 0, run.stderr);
});

Deno.test("`exactl watch <trace>` names `request watch --trace`", async () => {
  const run = await runExactlInTempWorkspace(["watch", "550e8400-e29b-41d4-a716-446655440000"]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "use 'exactl request watch --trace <trace-id>'");
});
