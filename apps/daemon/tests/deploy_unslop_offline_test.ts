/**
 * @module DeployUnslopOfflineTest
 * @path apps/daemon/tests/deploy_unslop_offline_test.ts
 * @description Acceptance test for the deployed portal lint adapter: a sandbox with no engine
 *   source and an empty child Deno cache must lint a changed line from verified local assets.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/git, @exaix/git/testing, @exaix/portal, @exaix/schemas, @exaix/shared]
 * @related-files [scripts/deploy_workspace.ts, packages/execution/src/unslop_check_runner.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { readHeadSha } from "@exaix/git";
import { createGitTestContext, type IGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { PathResolver } from "@exaix/portal";
import { UnslopCheckRunner } from "@exaix/execution";
import { ExaPathDefaults } from "@exaix/shared";
import { deployUnslopAssets, installUnslopAssets, verifyUnslopAssetSet } from "../../../scripts/deploy_workspace.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SEED_CAST = "export const seed = 1 as unknown as string;\n";
const CLEAN_LINE = "export const clean = 1;\n";

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
  const repositoryAssets = join(REPO_ROOT, "lint");
  if (await exists(join(repositoryAssets, "manifest.json"))) {
    // The suite preflight builds this set on the host, so the network-none worker needs no egress.
    await installUnslopAssets(repositoryAssets, join(sourceDeploy, "lint"));
  } else {
    await deployUnslopAssets(REPO_ROOT, sourceDeploy);
  }
  await deployUnslopAssets(sourceDeploy, deployedRoot);
  return { deployedRoot, cleanup: [sourceDeploy, deployedRoot] };
}

Deno.test("[deploy-unslop-offline] redeployed-offline-adapter lints with no source and an empty child cache", async () => {
  const { deployedRoot, cleanup } = await stageDeployedAssets();
  const emptyChildCache = await Deno.makeTempDir({ prefix: "exaix-deploy-empty-cache-" });
  const previousDenoDir = Deno.env.get("DENO_DIR");
  const ctx = await createGitTestContext("unslop-offline-");
  try {
    // A deployed workspace carries no engine source, so only the verified asset set can serve the child.
    assertFalse(await exists(join(deployedRoot, "unslop-ts")));
    assertFalse(await exists(join(deployedRoot, "packages")));
    await verifyUnslopAssetSet(join(deployedRoot, "lint"));

    Deno.env.set("DENO_DIR", emptyChildCache);
    await Deno.mkdir(join(ctx.tempDir, ctx.config.paths.runtime), { recursive: true });
    const settings = ConfigSchema.parse({
      system: { log_level: "info", root: deployedRoot },
      paths: { ...ExaPathDefaults },
    }).verification.unslop;
    const logger = new EventLogger({ db: ctx.db });
    const runner = new UnslopCheckRunner(logger, {
      settings,
      systemRoot: deployedRoot,
      logger,
      pathResolver: new PathResolver(ctx.config),
      knownSecrets: [],
    });

    await setupGitRepo(ctx.repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(ctx.repoDir, "seed.ts"), CLEAN_LINE);
    const base = await commitAll(ctx, "seed");
    await Deno.writeTextFile(join(ctx.repoDir, "seed.ts"), `${CLEAN_LINE}${SEED_CAST}`);
    const target = await commitAll(ctx, "change");

    const outcome = await runner.run({
      requestId: "request-229-offline",
      traceId: "trace-229-offline",
      attempt: 1,
      executionRoot: ctx.repoDir,
      runId: crypto.randomUUID(),
      baseSha: base,
      targetSha: target,
      git: ctx.git,
      checkIndex: 0,
      check: { kind: "unslop" },
      timeoutMs: 120_000,
      outputMaxChars: 4_000,
    });

    assertEquals(outcome.kind, "failed");
    const findings = outcome.kind === "failed" ? outcome.findings : [];
    const chainedCast = findings.find((finding) => finding.rule === "unslop/no-chained-type-assertions");
    assert(chainedCast !== undefined, `expected the chained-cast rule, got ${findings.map((f) => f.rule).join(", ")}`);
    assertEquals(chainedCast.file, "seed.ts");
    assertEquals(chainedCast.start_line, 2);

    // The adapter only read the deployed set: the assets still verify and the worktree is untouched.
    await verifyUnslopAssetSet(join(deployedRoot, "lint"));
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
