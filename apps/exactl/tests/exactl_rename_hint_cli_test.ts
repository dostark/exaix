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
