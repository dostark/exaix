/**
 * @module UnslopVerificationSecurityTest
 * @path packages/execution/tests/unslop_verification_security_test.ts
 * @description Security controls of the portal unslop adapter: suppression markers, source kinds,
 *   asset integrity and concurrent private directories.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/git/testing]
 * @related-files [packages/execution/src/unslop_check_runner.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ExaPathDefaults } from "@exaix/shared";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver } from "@exaix/portal";
import { createGitTestContext, type IGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { readHeadSha } from "@exaix/git";
import { type IUnslopCheckContext, UnslopCheckRunner } from "@exaix/execution";
import { buildUnslopPortalAssets } from "../../../scripts/build_unslop_portal_bundle.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const CLEAN = "export const clean = 1;\n";
const MARKER = "// deno-lint-ignore-file\n";
const CAST = "export const seed = 1 as unknown as string;\n";

interface IScope {
  readonly ctx: IGitTestContext;
  readonly runner: UnslopCheckRunner;
}

async function makeScope(): Promise<IScope> {
  const ctx = await createGitTestContext("unslop-security-");
  await buildUnslopPortalAssets({ root: REPO_ROOT, out: join(ctx.tempDir, "lint") });
  await Deno.mkdir(join(ctx.tempDir, ctx.config.paths.runtime), { recursive: true });
  const settings = ConfigSchema.parse({
    system: { log_level: "info", root: ctx.tempDir },
    paths: { ...ExaPathDefaults },
  }).verification.unslop;
  const runner = new UnslopCheckRunner({
    settings,
    systemRoot: ctx.tempDir,
    logger: new EventLogger({ db: ctx.db }),
    pathResolver: new PathResolver(ctx.config),
    knownSecrets: [],
  });
  return { ctx, runner };
}

async function commitAll(scope: IScope, message: string): Promise<string> {
  await scope.ctx.git.runGitCommand(["add", "-A"]);
  await scope.ctx.git.runGitCommand(["commit", "-m", message]);
  return await readHeadSha(scope.ctx.git);
}

function contextFor(scope: IScope, baseSha: string, targetSha: string): IUnslopCheckContext {
  return {
    requestId: "request-sec",
    traceId: "trace-sec",
    attempt: 1,
    executionRoot: scope.ctx.repoDir,
    runId: crypto.randomUUID(),
    baseSha,
    targetSha,
    git: scope.ctx.git,
    checkIndex: 0,
    check: { kind: "unslop" },
    timeoutMs: 120_000,
    outputMaxChars: 4_000,
  };
}

async function baseWith(scope: IScope): Promise<string> {
  await setupGitRepo(scope.ctx.repoDir, { initialCommit: true });
  await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), CLEAN);
  return await commitAll(scope, "seed");
}

Deno.test("[security] a new or existing suppression marker is rejected before the host", async () => {
  const scope = await makeScope();
  try {
    const base = await baseWith(scope);
    for (const content of [`${MARKER}${CAST}`, `${MARKER}export const a = 1;\n${CAST}`]) {
      await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), content);
      const target = await commitAll(scope, "marked");
      const result = await scope.runner.run(contextFor(scope, base, target));
      assertEquals(result.kind, "error");
      assertEquals(
        result.kind === "error" ? result.error_class : "",
        "UnslopSuppressionForbidden",
      );
    }

    const stringMarker = `export const marker = "// deno-lint-ignore-file";\n${CAST}`;
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), stringMarker);
    const target = await commitAll(scope, "string marker");
    const stringResult = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(stringResult.kind, "error");
    assertEquals(
      stringResult.kind === "error" ? stringResult.error_class : "",
      "UnslopSuppressionForbidden",
    );
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("[security] a suppression marker in an untouched file is not scanned", async () => {
  const scope = await makeScope();
  try {
    await setupGitRepo(scope.ctx.repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), `${MARKER}${CLEAN}`);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "other.ts"), CLEAN);
    const base = await commitAll(scope, "seed");
    await Deno.writeTextFile(join(scope.ctx.repoDir, "other.ts"), `${CLEAN}export const extra = 1;\n`);
    const target = await commitAll(scope, "other");

    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "passed");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("[security] a non-regular or non-UTF8 selected source is a categorical error", async () => {
  const scope = await makeScope();
  try {
    const base = await baseWith(scope);
    await Deno.writeFile(join(scope.ctx.repoDir, "raw.ts"), new Uint8Array([0xff, 0xfe, 0x0a]));
    const invalidUtf8 = await commitAll(scope, "raw source");
    const rawResult = await scope.runner.run(contextFor(scope, base, invalidUtf8));
    assertEquals(rawResult.kind, "error");
    assertEquals(rawResult.kind === "error" ? rawResult.error_class : "", "UnslopSourceInvalid");

    await Deno.symlink("seed.ts", join(scope.ctx.repoDir, "link.ts"));
    const linked = await commitAll(scope, "symlink");
    const linkResult = await scope.runner.run(contextFor(scope, invalidUtf8, linked));
    assertEquals(linkResult.kind, "error");
    assertEquals(linkResult.kind === "error" ? linkResult.error_class : "", "UnslopSourceInvalid");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("[security] a tampered packaged catalog is rejected", async () => {
  const scope = await makeScope();
  try {
    const base = await baseWith(scope);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), `${CLEAN}${CAST}`);
    const target = await commitAll(scope, "change");

    const catalogPath = join(scope.ctx.tempDir, "lint", "unslop_portal_catalog.json");
    const bytes = await Deno.readFile(catalogPath);
    bytes[0] = bytes[0] ^ 0xff;
    await Deno.writeFile(catalogPath, bytes);

    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "error");
    assertEquals(result.kind === "error" ? result.error_class : "", "UnslopAssetInvalid");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("[security] concurrent runs on one trace keep separate private directories", async () => {
  const scope = await makeScope();
  try {
    const base = await baseWith(scope);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "first.ts"), CAST);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "second.ts"), CAST);
    const target = await commitAll(scope, "change");
    const runId = crypto.randomUUID();
    const first = contextFor(scope, base, target);
    const second = { ...contextFor(scope, base, target), runId };

    const [left, right] = await Promise.all([
      scope.runner.run({ ...first, runId }),
      scope.runner.run(second),
    ]);
    assertEquals(left.kind, "failed");
    assertEquals(right.kind, "failed");

    const entries: string[] = [];
    const runtimeDir = join(scope.ctx.tempDir, scope.ctx.config.paths.runtime, "unslop");
    for await (const entry of Deno.readDir(runtimeDir)) entries.push(entry.name);
    assertEquals(entries, []);
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("[security] the adapter never writes into the execution worktree", async () => {
  const scope = await makeScope();
  try {
    const base = await baseWith(scope);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), `${CLEAN}${CAST}`);
    const target = await commitAll(scope, "change");
    const before = await Deno.readFile(join(scope.ctx.repoDir, "seed.ts"));

    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "failed");
    const after = await Deno.readFile(join(scope.ctx.repoDir, "seed.ts"));
    assertEquals(new TextDecoder().decode(after), new TextDecoder().decode(before));
    const status = await scope.ctx.git.runGitCommand(["status", "--porcelain"]);
    assert(status.output.trim() === "");
  } finally {
    await scope.ctx.cleanup();
  }
});
