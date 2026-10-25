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
import { type IDenoLintBatchOptions, type IDenoLintBatchOutcome, runDenoLintBatch } from "../src/deno_lint_process.ts";
import { buildVerificationCheckEnv } from "../src/verification_output.ts";

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

/** Returns the path unchanged, so the runner's own physical checks decide trust. */
const identityPathValidator = {
  validatePath(path: string, _allowedRoots: string[]): Promise<string> {
    return Promise.resolve(path);
  },
};

function runnerFor(
  systemRoot: string,
  settings: ILintSettings,
  overrides: Partial<IDenoLintCheckRunnerOptions> = {},
): DenoLintCheckRunner {
  return new DenoLintCheckRunner(createNoopEventLogger(), {
    settings,
    systemRoot,
    pathResolver: identityPathValidator,
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

function errorClass(outcome: IDenoLintCheckOutcome): string {
  return errored(outcome).error_class;
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

    await test.step("host-json-guard", async () => {
      const syntax = await makeRepo("deno-lint-guard-syntax-", { "seed.ts": "export const PRIVATE_SOURCE = ;\n" });
      try {
        const outcome = errored(await runnerFor(systemRoot, settingsOf()).run(contextFor(syntax)));
        assertEquals(outcome.error_class, "LintSourceInvalid");
        assertEquals(JSON.stringify(outcome).includes("PRIVATE_SOURCE"), false);
      } finally {
        await syntax.cleanup();
      }

      const timeout = await makeRepo("deno-lint-guard-timeout-", { "seed.ts": CAST_SEED });
      try {
        const outcome = errored(await runnerFor(systemRoot, settingsOf()).run(contextFor(timeout, 0)));
        assertEquals(outcome.error_class, "LintTimeout");
      } finally {
        await timeout.cleanup();
      }

      const capped = await makeRepo("deno-lint-guard-cap-", { "seed.ts": CAST_SEED });
      try {
        const { env, clearEnv } = buildVerificationCheckEnv();
        const batch = await runDenoLintBatch({
          configPath: join(policyDir, "deno.json"),
          files: ["./seed.ts"],
          cwd: capped.root,
          env,
          clearEnv,
          timeoutMs: 30_000,
          jsonMaxBytes: 16,
          stderrMaxBytes: 65_536,
        });
        assertEquals(batch.kind, "limit");
        const limited = await runnerFor(systemRoot, settingsOf(), {
          runBatch: () => Promise.resolve({ kind: "limit" }),
        }).run(contextFor(capped));
        assertEquals(errorClass(limited), "LintOutputLimit");
      } finally {
        await capped.cleanup();
      }

      const unused = await makeRepo("deno-lint-guard-unused-", {
        "seed.ts": "// deno-lint-ignore unslop/no-chained-type-assertions -- unused\nexport const value = 1;\n",
      });
      try {
        const outcome = failed(await runnerFor(systemRoot, settingsOf()).run(contextFor(unused)));
        assert(outcome.findings.some((finding) => finding.rule === "ban-unused-ignore"), outcome.output);
      } finally {
        await unused.cleanup();
      }

      const forged = await makeRepo("deno-lint-guard-forged-", { "seed.ts": CAST_SEED });
      try {
        const seedUrl = toFileUrl(join(forged.root, "seed.ts")).href;
        for (const code of ["Unslop/Bad", "a/b/c"]) {
          const runBatch = (): Promise<IDenoLintBatchOutcome> =>
            Promise.resolve({
              kind: "diagnostics",
              hostExitCodes: [1],
              diagnostics: [{
                filename: seedUrl,
                code,
                message: "forged",
                hint: "",
                start: { line: 1, column: 1 },
                end: { line: 1, column: 2 },
              }],
            });
          const outcome = errored(
            await runnerFor(systemRoot, settingsOf(), { runBatch }).run(contextFor(forged)),
          );
          assertEquals(outcome.error_class, "LintHostFailed", code);
        }
      } finally {
        await forged.cleanup();
      }
    });

    await test.step("guard-deadline-bounded", async () => {
      const repo = await makeRepo("deno-lint-guard-deadline-", { "a.ts": CLEAN_SEED, "b.ts": CLEAN_SEED });
      try {
        let reads = 0;
        let clock = 0;
        const outcome = errored(
          await runnerFor(systemRoot, settingsOf(), {
            readSource: () => {
              reads++;
              clock = 20_000;
              return Promise.resolve(CLEAN_SEED);
            },
            now: () => clock,
          }).run(contextFor(repo, 10_000)),
        );
        assertEquals(outcome.error_class, "LintTimeout");
        assertEquals(reads, 1);
      } finally {
        await repo.cleanup();
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

Deno.test("lint-dead-surface", async () => {
  const [snapshotSource, checkSource] = await Promise.all([
    Deno.readTextFile(new URL("../src/lint_snapshot.ts", import.meta.url)),
    Deno.readTextFile(new URL("../src/deno_lint_check.ts", import.meta.url)),
  ]);
  assertEquals(snapshotSource.includes("ILintCollectedFindings"), false);
  assertEquals(checkSource.includes("hostExitCodes"), false);

  const systemRoot = await Deno.makeTempDir({ prefix: "deno-lint-surface-" });
  const repo = await makeRepo("deno-lint-surface-repo-", { "seed.ts": CAST_SEED });
  try {
    await installLintPolicyForTest(join(systemRoot, "lint"));
    const outcome = await runnerFor(systemRoot, settingsOf()).run(contextFor(repo));
    assertEquals("hostExitCodes" in outcome, false);
  } finally {
    await repo.cleanup();
    await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
  }
});
