/**
 * @module DenoLintSecurityTest
 * @path packages/execution/tests/deno_lint_security_test.ts
 * @description Rejects untrusted policy directories and file-level ignore directives before the host runs.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/git, @exaix/schemas, @exaix/testing, @std/assert, @std/path]
 * @related-files [packages/execution/src/deno_lint_check.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createNoopEventLogger } from "@exaix/core/logger";
import type { GitService } from "@exaix/git";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { LintSettingsSchema } from "@exaix/schemas/config.ts";
import { DENO_LINT_CHECK_KIND, DenoLintCheckSchema } from "@exaix/schemas/portal_verification.ts";
import { installLintPolicyForTest } from "@exaix/testing";
import {
  DenoLintCheckRunner,
  type IDenoLintCheckContext,
  type IDenoLintCheckOutcome,
  type IDenoLintCheckRunnerOptions,
} from "../src/deno_lint_check.ts";
import type { IDenoLintBatchOutcome } from "../src/deno_lint_process.ts";

const CAST_SEED = "export const s = 1 as unknown as string;\n";
const CAST_CODE = "unslop/no-chained-type-assertions";

/** Returns the path unchanged, so the runner's own physical checks decide trust. */
const identityPathValidator = {
  validatePath(path: string, _allowedRoots: string[]): Promise<string> {
    return Promise.resolve(path);
  },
};

interface IRepo {
  readonly root: string;
  readonly git: GitService;
  readonly head: string;
  readonly cleanup: () => Promise<void>;
}

async function makeRepo(prefix: string, files: Record<string, string>): Promise<IRepo> {
  const context = await createGitTestContext(prefix);
  await setupGitRepo(context.repoDir, { initialCommit: true });
  for (const [path, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(context.repoDir, path), content);
  }
  await context.git.runGitCommand(["add", "-A"]);
  await context.git.runGitCommand(["commit", "-m", "seed"]);
  const head = (await context.git.runGitCommand(["rev-parse", "HEAD"])).output.trim();
  return { root: context.repoDir, git: context.git, head, cleanup: context.cleanup };
}

function runnerFor(
  systemRoot: string,
  overrides: Partial<IDenoLintCheckRunnerOptions> = {},
): DenoLintCheckRunner {
  return new DenoLintCheckRunner(createNoopEventLogger(), {
    settings: LintSettingsSchema.parse({}),
    systemRoot,
    pathResolver: identityPathValidator,
    ...overrides,
  });
}

function contextFor(repo: IRepo): IDenoLintCheckContext {
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
    timeoutMs: 30_000,
    outputMaxChars: 2_000,
  };
}

function errorClass(outcome: IDenoLintCheckOutcome): string | null {
  if (outcome.kind !== "error") throw new Error(`expected error, got ${outcome.kind}`);
  return outcome.error_class;
}

Deno.test("policy-trust-boundaries", async (test) => {
  const systemRoot = await Deno.makeTempDir({ prefix: "deno-lint-trust-" });
  try {
    await installLintPolicyForTest(join(systemRoot, "lint"));
    const repo = await makeRepo("deno-lint-trust-repo-", { "seed.ts": CAST_SEED });
    try {
      await test.step("a missing config is a policy miss", async () => {
        const empty = await Deno.makeTempDir({ prefix: "deno-lint-trust-empty-" });
        try {
          await Deno.mkdir(join(empty, "lint", "unslop"), { recursive: true });
          const outcome = await runnerFor(empty).run(contextFor(repo));
          assertEquals(errorClass(outcome), "LintPolicyMissing");
          await Deno.mkdir(join(empty, "lint", "unslop", "deno.json"));
          const notFile = await runnerFor(empty).run(contextFor(repo));
          assertEquals(errorClass(notFile), "LintPolicyMissing");
        } finally {
          await Deno.remove(empty, { recursive: true });
        }
      });

      await test.step("a symlinked policy directory is untrusted", async () => {
        const linked = await Deno.makeTempDir({ prefix: "deno-lint-trust-link-" });
        try {
          await Deno.mkdir(join(linked, "lint"), { recursive: true });
          await Deno.rename(join(systemRoot, "lint", "unslop"), join(linked, "real-unslop"));
          await Deno.symlink(join(linked, "real-unslop"), join(linked, "lint", "unslop"));
          const outcome = await runnerFor(linked).run(contextFor(repo));
          assertEquals(errorClass(outcome), "LintPolicyUntrusted");
          await Deno.rename(join(linked, "real-unslop"), join(systemRoot, "lint", "unslop"));
        } finally {
          await Deno.remove(linked, { recursive: true });
        }
      });

      await test.step("a policy under the execution root is untrusted", async () => {
        const inside = await makeRepo("deno-lint-trust-exec-", { "seed.ts": CAST_SEED });
        try {
          await installLintPolicyForTest(join(inside.root, "lint"));
          const outcome = await runnerFor(inside.root).run(contextFor(inside));
          assertEquals(errorClass(outcome), "LintPolicyUntrusted");
        } finally {
          await inside.cleanup();
        }
      });

      await test.step("a policy under a portal root is untrusted", async () => {
        const inside = await makeRepo("deno-lint-trust-portal-", { "seed.ts": CAST_SEED });
        try {
          await installLintPolicyForTest(join(inside.root, "lint"));
          const outcome = await runnerFor(systemRoot, { portalRoots: [inside.root] })
            .run({ ...contextFor(inside), executionRoot: systemRoot });
          assertEquals(errorClass(outcome), "LintPolicyUntrusted");
        } finally {
          await inside.cleanup();
        }
      });
    } finally {
      await repo.cleanup();
    }
  } finally {
    await Deno.remove(systemRoot, { recursive: true });
  }
});

Deno.test("file-ignore-rejected", async (test) => {
  const systemRoot = await Deno.makeTempDir({ prefix: "deno-lint-ignore-" });
  try {
    await installLintPolicyForTest(join(systemRoot, "lint"));
    const cases = [
      ["bare", "// deno-lint-ignore-file\n"],
      ["bare with reason", "// deno-lint-ignore-file -- typed upstream\n"],
      ["indented", "  // deno-lint-ignore-file\n"],
      ["named guard rule", `// deno-lint-ignore-file unslop/no-forbidden-lint-ignore ${CAST_CODE}\n`],
    ] as const;
    for (const [name, directive] of cases) {
      await test.step(name, async () => {
        const repo = await makeRepo("deno-lint-ignore-repo-", { "seed.ts": `${directive}${CAST_SEED}` });
        try {
          let calls = 0;
          const runBatch = (): Promise<IDenoLintBatchOutcome> => {
            calls++;
            return Promise.resolve({ kind: "spawn_failed" });
          };
          const outcome = await runnerFor(systemRoot, { runBatch }).run(contextFor(repo));
          assertEquals(errorClass(outcome), "LintSuppressionForbidden", name);
          assertEquals(calls, 0, "the guard runs before the host");
        } finally {
          await repo.cleanup();
        }
      });
    }

    await test.step("a named line ignore reaches the host and is reported", async () => {
      const repo = await makeRepo("deno-lint-ignore-line-", {
        "seed.ts": `// deno-lint-ignore ${CAST_CODE} -- typed upstream\n${CAST_SEED}`,
      });
      try {
        const outcome = await runnerFor(systemRoot).run(contextFor(repo));
        assertEquals(outcome.kind, "failed");
        assertEquals(
          outcome.kind === "failed"
            ? outcome.findings.some((finding) => finding.rule === "unslop/no-forbidden-lint-ignore")
            : false,
          true,
        );
      } finally {
        await repo.cleanup();
      }
    });

    await test.step("a block comment form does not trigger the guard", async () => {
      const repo = await makeRepo("deno-lint-ignore-block-", {
        "seed.ts": `/* deno-lint-ignore-file */\n${CAST_SEED}`,
      });
      try {
        const outcome = await runnerFor(systemRoot).run(contextFor(repo));
        assertEquals(outcome.kind, "failed");
      } finally {
        await repo.cleanup();
      }
    });
  } finally {
    await Deno.remove(systemRoot, { recursive: true });
  }
});
