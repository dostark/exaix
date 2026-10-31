/**
 * @module DeployLintPolicyOfflineTest
 * @path apps/daemon/tests/deploy_lint_policy_offline_test.ts
 * @description Acceptance test for the deployed lint policy: a sandbox with no engine source and
 *   an empty child Deno cache must lint a commit from the verified installed directory.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/git, @exaix/git/testing, @exaix/portal, @exaix/schemas, @exaix/shared]
 * @related-files [scripts/deploy_workspace.ts, packages/execution/src/deno_lint_check.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { readHeadSha } from "@exaix/git";
import { createGitTestContext, type IGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { LintSettingsSchema } from "@exaix/schemas/config.ts";
import { PathResolver } from "@exaix/portal";
import { DenoLintCheckRunner } from "@exaix/execution";
import { DENO_LINT_CHECK_KIND, DenoLintCheckSchema } from "@exaix/schemas/portal_verification.ts";
import { deployLintPolicies, installLintPolicyDir, verifyLintPolicyDir } from "../../../scripts/deploy_workspace.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SEED_CAST = "export const seed = 1 as unknown as string;\n";
const CLEAN_LINE = "export const clean = 1;\n";
const COMPLEXITY_BRANCH_COUNT = 16;
const LONG_FUNCTION_STATEMENT_COUNT = 61;
const COMPLEXITY_RULES = [
  "unslop/max-cyclomatic-complexity",
  "unslop/max-cognitive-complexity",
  "unslop/max-function-lines",
];
const COMPLEXITY_SEED = [
  "export function decisions(flags: boolean[]): number {",
  "  let result = 0;",
  ...Array.from({ length: COMPLEXITY_BRANCH_COUNT }, (_, index) => `  if (flags[${index}]) result++;`),
  "  return result;",
  "}",
  "export function longUnit(value: number): number {",
  ...Array.from({ length: LONG_FUNCTION_STATEMENT_COUNT }, () => "  value += 1;"),
  "  return value;",
  "}",
].join("\n");
const CLEAN_POLICY_SEED = [
  "/**",
  " * @module PortalPolicySeed",
  " * @path seed.ts",
  " * @description Provides a clean export for the deployed policy check.",
  " */",
  CLEAN_LINE,
].join("\n");

/** Commits every pending change and returns the commit id. */
async function commitAll(ctx: IGitTestContext, message: string): Promise<string> {
  await ctx.git.runGitCommand(["add", "-A"]);
  await ctx.git.runGitCommand(["commit", "-m", message]);
  return await readHeadSha(ctx.git);
}

/** Copies a verified set into a source-free directory, building it only outside the offline lane. */
async function stageDeployedAssets(): Promise<{ deployedRoot: string; cleanup: string[] }> {
  const sourceDeploy = await Deno.makeTempDir({ prefix: "exaix-deploy-source-" });
  const deployedRoot = await Deno.makeTempDir({ prefix: "exaix-deploy-target-" });
  const repositoryPolicy = join(REPO_ROOT, "lint", "unslop");
  if (await exists(join(repositoryPolicy, "manifest.json"))) {
    // The suite preflight builds this directory on the host, so the network-none worker needs no egress.
    await installLintPolicyDir(repositoryPolicy, join(sourceDeploy, "lint", "unslop"));
  } else {
    await deployLintPolicies(REPO_ROOT, sourceDeploy);
  }
  await deployLintPolicies(sourceDeploy, deployedRoot);
  return { deployedRoot, cleanup: [sourceDeploy, deployedRoot] };
}

Deno.test("[deploy-lint-policy-offline] deployed-policy-offline lints with no source and an empty child cache", async () => {
  const { deployedRoot, cleanup } = await stageDeployedAssets();
  const emptyChildCache = await Deno.makeTempDir({ prefix: "exaix-deploy-empty-cache-" });
  const previousDenoDir = Deno.env.get("DENO_DIR");
  const ctx = await createGitTestContext("unslop-offline-");
  try {
    // A deployed workspace carries no engine source, so only the verified asset set can serve the child.
    assertFalse(await exists(join(deployedRoot, "unslop-ts")));
    assertFalse(await exists(join(deployedRoot, "packages")));
    await verifyLintPolicyDir(join(deployedRoot, "lint", "unslop"));

    Deno.env.set("DENO_DIR", emptyChildCache);
    await Deno.mkdir(join(ctx.tempDir, ctx.config.paths.runtime), { recursive: true });
    const settings = LintSettingsSchema.parse({});
    const logger = new EventLogger({ db: ctx.db });
    const runner = new DenoLintCheckRunner(logger, {
      settings,
      systemRoot: deployedRoot,
      pathResolver: new PathResolver(ctx.config),
      portalRoots: [],
      knownSecrets: [],
    });

    await setupGitRepo(ctx.repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(ctx.repoDir, "seed.ts"), CLEAN_LINE);
    await commitAll(ctx, "seed");
    await Deno.writeTextFile(join(ctx.repoDir, "seed.ts"), `${CLEAN_LINE}${SEED_CAST}${COMPLEXITY_SEED}\n`);
    const target = await commitAll(ctx, "change");

    const checkContext = {
      requestId: "request-lint-offline",
      traceId: "trace-lint-offline",
      attempt: 1,
      runId: crypto.randomUUID(),
      executionRoot: ctx.repoDir,
      targetSha: target,
      git: ctx.git,
      checkIndex: 0,
      check: DenoLintCheckSchema.parse({ kind: DENO_LINT_CHECK_KIND }),
      timeoutMs: 120_000,
      outputMaxChars: 4_000,
    };
    const outcome = await runner.run(checkContext);

    assertEquals(outcome.kind, "failed");
    const findings = outcome.kind === "failed" ? outcome.findings : [];
    const chainedCast = findings.find((finding) => finding.rule === "unslop/no-chained-type-assertions");
    assert(chainedCast !== undefined, `expected the chained-cast rule, got ${findings.map((f) => f.rule).join(", ")}`);
    assertEquals(chainedCast.file, "seed.ts");
    assertEquals(chainedCast.start_line, 2);
    for (const rule of COMPLEXITY_RULES) {
      assert(findings.some((finding) => finding.rule === rule), `expected ${rule} from the installed policy`);
    }

    await Deno.writeTextFile(join(ctx.repoDir, "seed.ts"), CLEAN_POLICY_SEED);
    const cleanTarget = await commitAll(ctx, "repair");
    const cleanOutcome = await runner.run({ ...checkContext, attempt: 2, targetSha: cleanTarget });
    assertEquals(cleanOutcome.kind, "passed");

    // The adapter only read the deployed set: the assets still verify and the worktree is untouched.
    await verifyLintPolicyDir(join(deployedRoot, "lint", "unslop"));
    const status = await ctx.git.runGitCommand(["status", "--porcelain"]);
    assertEquals(status.output.trim(), "");
  } finally {
    if (previousDenoDir === undefined) Deno.env.delete("DENO_DIR");
    else Deno.env.set("DENO_DIR", previousDenoDir);
    await ctx.cleanup();
    for (const path of [...cleanup, emptyChildCache]) {
      await Deno.remove(path, { recursive: true }).catch(() => {});
    }
  }
});
