/**
 * @module DenoLintCheckTest
 * @path packages/execution/tests/deno_lint_check_test.ts
 * @description Runs the generic Deno lint check against real repositories and the installed portal policy.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/git, @exaix/schemas, @exaix/testing, @std/assert, @std/path]
 * @related-files [packages/execution/src/deno_lint_check.ts, packages/execution/src/deno_lint_process.ts]
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { dirname, join, toFileUrl } from "@std/path";
import { createNoopEventLogger } from "@exaix/core/logger";
import type { GitService } from "@exaix/git";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { type ILintSettings, LintSettingsSchema } from "@exaix/schemas/config.ts";
import { DENO_LINT_CHECK_KIND, DenoLintCheckSchema } from "@exaix/schemas/portal_verification.ts";
import { installLintPolicyForTest } from "@exaix/testing";
import {
  DenoLintCheckRunner,
  type IDenoLintCheckOutcome,
  type IDenoLintCheckRunnerOptions,
} from "../src/deno_lint_check.ts";
import type { IDenoLintBatchOptions, IDenoLintBatchOutcome } from "../src/deno_lint_process.ts";

const CAST_SEED = "export const s = 1 as unknown as string;\n";
const CLEAN_SEED = "export const s: number = 1;\n";
const CAST_CODE = "unslop/no-chained-type-assertions";

interface IRepo {
  readonly root: string;
  readonly git: GitService;
  readonly head: string;
  readonly cleanup: () => Promise<void>;
}

/** Creates one committed repository from the given files, force-adding the named ignored paths. */
async function makeRepo(
  prefix: string,
  files: Record<string, string>,
  force: readonly string[] = [],
): Promise<IRepo> {
  const context = await createGitTestContext(prefix);
  await setupGitRepo(context.repoDir, { initialCommit: true });
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(context.repoDir, path)), { recursive: true });
    await Deno.writeTextFile(join(context.repoDir, path), content);
  }
  await context.git.runGitCommand(["add", "-A"]);
  if (force.length > 0) await context.git.runGitCommand(["add", "-f", ...force]);
  await context.git.runGitCommand(["commit", "-m", "seed"]);
  const head = (await context.git.runGitCommand(["rev-parse", "HEAD"])).output.trim();
  return { root: context.repoDir, git: context.git, head, cleanup: context.cleanup };
}

function settingsOf(overrides: Record<string, number> = {}): ILintSettings {
  return LintSettingsSchema.parse(overrides);
}

function runnerFor(
  systemRoot: string,
  settings: ILintSettings,
  overrides: Partial<IDenoLintCheckRunnerOptions> = {},
): DenoLintCheckRunner {
  return new DenoLintCheckRunner(createNoopEventLogger(), {
    settings,
    systemRoot,
    ...overrides,
  });
}

function contextFor(
  repo: IRepo,
  timeoutMs = 30_000,
): Parameters<DenoLintCheckRunner["run"]>[0] {
  return {
    requestId: "req",
    traceId: crypto.randomUUID(),
    attempt: 0,
    runId: crypto.randomUUID(),
    executionRoot: repo.root,
    targetSha: repo.head,
    git: repo.git,
    checkIndex: 0,
    check: DenoLintCheckSchema.parse({ kind: DENO_LINT_CHECK_KIND }),
    timeoutMs,
    outputMaxChars: 2_000,
  };
}

function failed(outcome: IDenoLintCheckOutcome): Extract<IDenoLintCheckOutcome, { kind: "failed" }> {
  if (outcome.kind !== "failed") throw new Error(`expected failed, got ${outcome.kind}`);
  return outcome;
}

function passed(outcome: IDenoLintCheckOutcome): Extract<IDenoLintCheckOutcome, { kind: "passed" }> {
  if (outcome.kind !== "passed") throw new Error(`expected passed, got ${outcome.kind}`);
  return outcome;
}

function errored(outcome: IDenoLintCheckOutcome): Extract<IDenoLintCheckOutcome, { kind: "error" }> {
  if (outcome.kind !== "error") throw new Error(`expected error, got ${outcome.kind}`);
  return outcome;
}

Deno.test("deno-lint-check", async (test) => {
  const systemRoot = await Deno.makeTempDir({ prefix: "deno-lint-system-" });
  try {
    const policyDir = await installLintPolicyForTest(join(systemRoot, "lint"));
    assertEquals((await Deno.stat(join(policyDir, "deno.json"))).isFile, true);

    await test.step("deno-lint-pass-fail", async () => {
      const clean = await makeRepo("deno-lint-clean-", { "seed.ts": CLEAN_SEED });
      try {
        const outcome = passed(await runnerFor(systemRoot, settingsOf()).run(contextFor(clean)));
        assertEquals(outcome.total, 0);
      } finally {
        await clean.cleanup();
      }

      const cast = await makeRepo("deno-lint-cast-", { "seed.ts": CAST_SEED });
      try {
        const outcome = failed(await runnerFor(systemRoot, settingsOf()).run(contextFor(cast)));
        assert(outcome.total > 0);
        assert(outcome.findings.some((finding) => finding.rule === CAST_CODE), JSON.stringify(outcome.findings));
        assertMatch(outcome.output, /seed\.ts:\d+ unslop\//);
      } finally {
        await cast.cleanup();
      }

      const excluded = await makeRepo(
        "deno-lint-excluded-",
        { "node_modules/pkg/bad.ts": CAST_SEED },
        ["node_modules/pkg/bad.ts"],
      );
      try {
        const outcome = passed(await runnerFor(systemRoot, settingsOf()).run(contextFor(excluded)));
        assertEquals(outcome.total, 0);
      } finally {
        await excluded.cleanup();
      }

      const capped = await makeRepo("deno-lint-capped-", { "seed.ts": CAST_SEED });
      try {
        const outcome = failed(
          await runnerFor(systemRoot, settingsOf({ findings_limit: 1 })).run(contextFor(capped)),
        );
        assert(outcome.total > 1, `expected the exact total, got ${outcome.total}`);
        assertEquals(outcome.findings.length, 1);
        assertEquals(outcome.output.split("\n").length, 1);
      } finally {
        await capped.cleanup();
      }

      const three = await makeRepo("deno-lint-batches-", {
        "a.ts": CAST_SEED,
        "b.ts": CAST_SEED,
        "c.ts": CAST_SEED,
      });
      try {
        const outcome = failed(
          await runnerFor(systemRoot, settingsOf({ batch_max_files: 1 })).run(contextFor(three)),
        );
        assert(outcome.total >= 3, `expected findings across every batch, got ${outcome.total}`);
      } finally {
        await three.cleanup();
      }

      const deadline = await makeRepo("deno-lint-deadline-", {
        "a.ts": CAST_SEED,
        "b.ts": CAST_SEED,
        "c.ts": CAST_SEED,
      });
      try {
        let calls = 0;
        const seedUrl = toFileUrl(join(deadline.root, "a.ts")).href;
        const runBatch = (_options: IDenoLintBatchOptions): Promise<IDenoLintBatchOutcome> => {
          calls++;
          if (calls === 2) return Promise.resolve({ kind: "deadline_exceeded" });
          return Promise.resolve({
            kind: "diagnostics",
            hostExitCodes: [1],
            diagnostics: [{
              filename: seedUrl,
              code: CAST_CODE,
              message: "cast",
              hint: "",
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            }],
          });
        };
        const outcome = errored(
          await runnerFor(systemRoot, settingsOf({ batch_max_files: 1 }), { runBatch })
            .run(contextFor(deadline, 30_000)),
        );
        assertEquals(outcome.error_class, "LintTimeout");
        assertEquals(calls, 2);
      } finally {
        await deadline.cleanup();
      }
    });

    await test.step("portal-config-cannot-hide-files", async () => {
      const repo = await makeRepo(
        "deno-lint-hidden-",
        {
          "seed.ts": CAST_SEED,
          ".gitignore": "seed.ts\n",
          "deno.json": JSON.stringify({
            lint: { exclude: ["seed.ts"], rules: { exclude: [CAST_CODE] } },
          }),
          "sub/deno.json": JSON.stringify({ lint: { rules: { exclude: [CAST_CODE] } } }),
        },
        ["seed.ts"],
      );
      try {
        const outcome = failed(await runnerFor(systemRoot, settingsOf()).run(contextFor(repo)));
        assert(outcome.findings.some((finding) => finding.rule === CAST_CODE), outcome.output);
      } finally {
        await repo.cleanup();
      }
    });
  } finally {
    await Deno.remove(systemRoot, { recursive: true });
  }
});
