/**
 * @module ReviewJournalFixture
 * @path apps/exactl/tests/helpers/review_journal_fixture.ts
 * @description Real journal, branch and CLI fixture for verification input-boundary tests.
 * @architectural-layer Tests
 * @related-files [apps/exactl/tests/review_unslop_security_test.ts, apps/exactl/tests/review_unslop_cli_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { ReviewCommands } from "../../src/commands/review_commands.ts";
import { createCliTestContext, initGitRepo, runGitCommand } from "./test_setup.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

/** The persisted review, its journal writer and both read paths. */
export type IReviewJournalFixture = Awaited<ReturnType<typeof createCliTestContext>> & {
  trace: string;
  log: (overrides?: Record<string, unknown>, status?: string) => Promise<void>;
  cli: () => Promise<string>;
  show: () => ReturnType<ReviewCommands["show"]>;
};

/** Creates one persisted failed review whose snapshot can be replaced by the test. */
export async function createReviewJournalFixture(): Promise<IReviewJournalFixture> {
  const ctx = await createCliTestContext();
  const trace = crypto.randomUUID();
  const request = "request-journal";
  const run = crypto.randomUUID();
  const branch = `feat/${request}-${trace}`;
  await initGitRepo(ctx.tempDir);
  await runGitCommand(ctx.tempDir, ["checkout", "-b", branch]);
  await Deno.writeTextFile(join(ctx.tempDir, "seed.ts"), "export const seed = 1;\n");
  await runGitCommand(ctx.tempDir, ["add", "seed.ts"]);
  await runGitCommand(ctx.tempDir, ["commit", "-m", "review fixture"]);
  const commit = await runGitCommand(ctx.tempDir, ["rev-parse", "HEAD"]);
  await runGitCommand(ctx.tempDir, ["checkout", TEST_DEFAULT_BRANCH]);
  const log = async (overrides: Record<string, unknown> = {}, status = "failed"): Promise<void> => {
    await ctx.db.preparedRun("DELETE FROM activity WHERE trace_id = ?", [trace]);
    ctx.db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      {
        request_id: request,
        commit_sha: commit,
        verification_run_id: run,
        verification_status: status,
      },
      trace,
      null,
    );
    ctx.db.logActivity(
      "daemon",
      DomainEventType.ExecutionVerificationLintFindings,
      null,
      {
        request_id: request,
        run_id: run,
        attempt: 0,
        commit_sha: commit,
        verification_status: status,
        total: 2,
        checks: [{ check_index: 0, outcome: "failed", total: 2, error_class: null }],
        findings: [{ check_index: 0, file: "src/é.ts", line: 3, rule: "unslop/no-chained-type-assertions" }],
        truncated: true,
        ...overrides,
      },
      trace,
      null,
    );
    await ctx.db.waitForFlush();
  };
  const cli = async (): Promise<string> => {
    const root = fromFileUrl(new URL("../../../..", import.meta.url));
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      EXA_CONFIG_PATH: join(ctx.tempDir, "exa.config.toml"),
      NO_COLOR: "1",
    };
    delete env.EXA_TEST_MODE;
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--config",
        join(root, "deno.json"),
        join(root, "apps/exactl/main.ts"),
        "review",
        "show",
        branch,
      ],
      cwd: ctx.tempDir,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    if (!result.success) throw new Error(`CLI failed: ${output}`);
    return output;
  };
  const commands = new ReviewCommands(ctx.context);
  return { ...ctx, trace, log, cli, show: () => commands.show(branch) };
}
