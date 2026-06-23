/**
 * @module DelegateReturnE2ETest
 * @path tests/integration/delegate_return_e2e_test.ts
 * @description Phase 123 Step 6 — end-to-end delegate return test verifying that
 *   HeadlessSessionLauncher → parser → return.json produces a trustworthy return
 *   with real paths_touched, populated token_stats, and cost_usd for one OpenCode
 *   config. Tagged @provider_live: skipped in CI unless EXA_TEST_LIVE_DELEGATION=true.
 *   A real git worktree is used so the git-diff fallback can compute paths_touched.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { HeadlessSessionLauncher } from "../../apps/daemon/src/headless_session_launcher.ts";
import { checkScope } from "@exaix/session/scope_checker.ts";
import type { SessionReturn } from "@exaix/schemas/session_delegate.ts";

const IS_LIVE = Deno.env.get("EXA_TEST_LIVE_DELEGATION") === "true";

function createBrief(traceId: string, tool: "opencode" | "claude-code", worktreePath: string) {
  return {
    trace_id: traceId,
    gate: "code_changes" as const,
    tool,
    objective: "Create result.txt containing the text 'e2e-pass'",
    artifact_ref: `trace:${traceId}`,
    permitted_paths: ["**"],
    worktree_path: worktreePath,
    token_budget: { max_input_tokens: 5000, max_output_tokens: 5000, max_total_tokens: 10000 },
    resume_token: `tok-${traceId}`,
    deadline: new Date(Date.now() + 120_000).toISOString(),
  };
}

async function assertReturn(
  tmpDir: string,
  traceId: string,
  traceDir: string,
  brief: ReturnType<typeof createBrief>,
  worktreePath: string,
) {
  const returnPath = join(traceDir, "return.json");
  let raw: string;
  try {
    raw = await Deno.readTextFile(returnPath);
  } catch {
    assert(false, "return.json must exist after headless launch");
    return;
  }
  const ret: SessionReturn = JSON.parse(raw);

  assertExists(ret.trace_id, "return must have trace_id");
  assertEquals(ret.trace_id, traceId);
  assertExists(ret.decision, "return must have decision");
  assertExists(ret.summary, "return must have summary");

  assertExists(ret.paths_touched, "return must have paths_touched");
  assert(ret.paths_touched.length > 0, "paths_touched must be non-empty for a file-creating run");

  assertExists(ret.token_stats, "return must have token_stats");
  assert(ret.token_stats.total_tokens >= 0, "token_stats.total_tokens must be non-negative");

  assertExists(ret.cost_usd, "return must have cost_usd");

  const scopeResult = checkScope(ret.paths_touched, brief.permitted_paths, worktreePath);
  assertEquals(
    scopeResult.violations.length,
    0,
    `no scope violations: ${JSON.stringify(scopeResult.violations)}`,
  );
  assert(scopeResult.accepted.length > 0, "at least one path must be accepted by scope_checker");

  await Deno.remove(tmpDir, { recursive: true });
}

async function runDelegateTest(
  tool: "opencode" | "claude-code",
  launchArgs: string[],
): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "p123-e2e-" });
  const sessionDir = join(tmpDir, "Session");
  const worktreePath = join(tmpDir, "worktree");
  await ensureDir(sessionDir);
  await ensureDir(worktreePath);

  await gitExec(worktreePath, ["init"]);
  await Deno.writeTextFile(join(worktreePath, "existing.txt"), "hello\n");
  await gitExec(worktreePath, ["add", "-A"]);
  await gitExec(worktreePath, ["commit", "-m", "initial"]);

  const traceId = crypto.randomUUID();
  const traceDir = join(sessionDir, traceId);
  await ensureDir(traceDir);

  const brief = createBrief(traceId, tool, worktreePath);
  await Deno.writeTextFile(join(traceDir, "brief.json"), JSON.stringify(brief, null, 2));

  const launcher = new HeadlessSessionLauncher({
    sessionDir,
    allowlist: new Set(["opencode", "claude"]),
  });
  const launch = {
    command: tool === "opencode" ? "opencode" : "claude",
    args: launchArgs,
    cwd: worktreePath,
    env: {},
  };
  await launcher.launch(launch, traceId, undefined);

  await assertReturn(tmpDir, traceId, traceDir, brief, worktreePath);
}

Deno.test({
  name: "[provider_live][opencode] real run produces scope-checked return with paths + cost",
  ignore: !IS_LIVE,
  async fn() {
    await runDelegateTest("opencode", [
      "run",
      "--format",
      "json",
      "--model",
      "deepseek-v4-flash",
      "Create result.txt containing the text 'e2e-pass'",
    ]);
  },
});

Deno.test({
  name: "[provider_live][claude-code] real run produces scope-checked return with paths + cost",
  ignore: !IS_LIVE,
  async fn() {
    await runDelegateTest("claude-code", [
      "-p",
      "Create result.txt containing the text 'e2e-pass'",
      "--output-format",
      "json",
    ]);
  },
});

async function gitExec(cwd: string, args: string[]): Promise<void> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "null",
    env: {
      GIT_AUTHOR_NAME: "p123-test",
      GIT_AUTHOR_EMAIL: "p123@test",
      GIT_COMMITTER_NAME: "p123-test",
      GIT_COMMITTER_EMAIL: "p123@test",
    },
  });
  const result = await cmd.output();
  assert(result.success, `git ${args.join(" ")} must succeed`);
}
