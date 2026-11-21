/**
 * @module CommitPlanStepTest
 * @path tests/scripts/commit_plan_step_test.ts
 * @description Exercises plan commits and checkout validation in local Git repositories.
 * @architectural-layer Test
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { GO_BOOTSTRAP } from "../../scripts/plan_git.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const MESSAGE = join(ROOT, "tests/fixtures/commit_plan_step/message.txt");
const GO = "exaix-go";
const DOCS = "exaix-dev-docs";
const SHARED = "shared.go";

async function command(cwd: string, executable: string, args: string[]): Promise<{ code: number; text: string }> {
  const env = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    LD_LIBRARY_PATH: "",
  };
  const result = await new Deno.Command(executable, { cwd, args, env, stdout: "piped", stderr: "piped" }).output();
  const decoder = new TextDecoder();
  return { code: result.code, text: decoder.decode(result.stdout).trim() + decoder.decode(result.stderr).trim() };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await command(cwd, "git", args);
  assertEquals(result.code, 0, result.text);
  return result.text;
}

async function stage(cwd: string, name: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(cwd, name), content);
  await git(cwd, "add", "--", name);
}

async function fixture(dir: string, bootstrap = false): Promise<string> {
  const parent = join(dir, "parent");
  await git(dir, "init", parent);
  for (const path of [DOCS, GO]) {
    const seed = join(dir, path + "-origin");
    if (bootstrap && path === GO) {
      await git(dir, "clone", "--no-local", join(ROOT, GO), seed);
      await git(seed, "checkout", "-B", "fixture", GO_BOOTSTRAP);
    } else {
      await git(dir, "init", seed);
      await stage(seed, "README.md", "base\n");
      await git(seed, "commit", "-m", "base");
    }
    if (bootstrap && path === GO) await git(parent, "commit", "-m", "record docs");
    await git(parent, "-c", "protocol.file.allow=always", "submodule", "add", seed, path);
  }
  if (!bootstrap) await git(parent, "commit", "-m", "record both pointers");
  const hook = join(parent, ".git/hooks/commit-msg");
  await Deno.writeTextFile(
    hook,
    `#!/bin/sh\nexec deno run -A --config "${ROOT}deno.json" "${ROOT}scripts/check_commit_msg.ts" "$1"\n`,
    { mode: 0o755 },
  );
  return parent;
}

async function plan(parent: string, path: string): Promise<void> {
  const lines = [
    "### Step 1: Record the change",
    "",
    "**Success Criteria**:",
    "",
    `- ✅ Recorded change → \`${path}\``,
    "",
  ];
  await stage(join(parent, DOCS), "plan.md", lines.join("\n"));
}

function run(parent: string): Promise<{ code: number; text: string }> {
  return command(parent, "deno", [
    "run",
    "-A",
    "--config",
    join(ROOT, "deno.json"),
    join(ROOT, "scripts/commit_plan_step.ts"),
    MESSAGE,
    "--commit",
  ]);
}

Deno.test("plan-step resumes child and parent rejections and checks all three revisions", async () => {
  await withTempDir(async (dir) => {
    const parent = await fixture(dir);
    const go = join(parent, GO);
    const docs = join(parent, DOCS);
    const base = await git(go, "rev-parse", "HEAD");
    const parentBase = await git(parent, "rev-parse", "HEAD");
    await plan(parent, GO + "/" + SHARED);
    await stage(go, SHARED, "package example\n");
    const hook = await git(go, "rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit");
    await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assertStringIncludes((await run(parent)).text, "Commit rejected in exaix-go");
    const docsRev = await git(docs, "rev-parse", "HEAD");
    assertEquals(await git(parent, "rev-parse", ":exaix-go"), base);
    await Deno.remove(hook);
    const parentHook = join(parent, ".git/hooks/pre-commit");
    await Deno.writeTextFile(parentHook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assertStringIncludes((await run(parent)).text, "Commit rejected in .");
    const goRev = await git(go, "rev-parse", "HEAD");
    assertEquals(await git(go, "rev-parse", "HEAD^"), base);
    await Deno.remove(parentHook);
    await stage(parent, "unrelated", "unrelated");
    assertStringIncludes((await run(parent)).text, "Parent staged content changed");
    await git(parent, "restore", "--staged", "unrelated");
    await git(parent, "update-index", "--cacheinfo", `160000,${base},exaix-go`);
    assertStringIncludes((await run(parent)).text, "staged pointer changed");
    await git(parent, "add", GO);
    const result = await run(parent);
    assertEquals(result.code, 0, result.text);
    assertEquals(await git(parent, "rev-parse", "HEAD^"), parentBase);
    assertEquals(await git(parent, "rev-parse", "HEAD:exaix-go"), goRev);
    assertEquals(await git(parent, "rev-parse", "HEAD:exaix-dev-docs"), docsRev);
  });
});

for (
  const testCase of [
    { name: "unchanged pointer", arrow: GO + "/README.md", change: false },
    { name: "wrong repository", arrow: "exaix-team/" + SHARED, change: true },
    { name: "ambiguous unqualified path", arrow: SHARED, change: true },
  ]
) {
  Deno.test("plan hook rejects " + testCase.name, async () => {
    await withTempDir(async (dir) => {
      const parent = await fixture(dir);
      await plan(parent, testCase.arrow);
      if (testCase.change) await stage(join(parent, GO), SHARED, "package example");
      await stage(parent, SHARED, "parent change");
      const result = await run(parent);
      assertEquals(result.code, 1);
      assertStringIncludes(result.text, `module "${testCase.arrow}" is not among`);
    });
  });
}

Deno.test("plan hook accepts a unique legacy path from an intermediate child commit", async () => {
  await withTempDir(async (dir) => {
    const parent = await fixture(dir);
    const go = join(parent, GO);
    const docs = join(parent, DOCS);
    await plan(parent, SHARED);
    await git(docs, "commit", "-m", "record plan");
    await stage(go, SHARED, "package example");
    await git(go, "commit", "-m", "first change");
    await stage(go, "other.go", "package other");
    await git(go, "commit", "-m", "second change");
    await git(parent, "add", DOCS, GO);
    await git(parent, "commit", "-F", MESSAGE);
    assertEquals(await git(parent, "rev-parse", "HEAD:exaix-go"), await git(go, "rev-parse", "HEAD"));
  });
});

Deno.test("Go checkout distinguishes absent, incomplete and mismatched revisions", async () => {
  await withTempDir(async (dir) => {
    const parent = await fixture(dir);
    const go = join(parent, GO);
    assertEquals(await goCheckout(parent, true), go);
    await Deno.remove(join(go, "README.md"));
    await assertRejects(() => goCheckout(parent, false), Error, "Incomplete");
    await git(go, "add", "-u");
    await assertRejects(() => goCheckout(parent, true), Error, "Incomplete");
    await git(go, "restore", "--staged", "--worktree", "README.md");
    await git(go, "commit", "--allow-empty", "-m", "other revision");
    await assertRejects(() => goCheckout(parent, false), Error, "gitlink");
    await git(parent, "submodule", "deinit", "-f", GO);
    assertEquals(await goCheckout(parent, false), undefined);
    await assertRejects(() => goCheckout(parent, true), Error, "required");
    await Deno.writeTextFile(join(go, "stray"), "partial");
    await assertRejects(() => goCheckout(parent, false), Error, "gitlink");
  });
});

const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");
for (const file of ["README.md", SHARED]) {
  Deno.test("first Go gitlink checks the pinned bootstrap for " + file, { ignore: !checkout }, async () => {
    await withTempDir(async (dir) => {
      const parent = await fixture(dir, true);
      await plan(parent, GO + "/" + file);
      await stage(join(parent, GO), SHARED, "package example");
      const result = await run(parent);
      if (file === SHARED) assertEquals(result.code, 0, result.text);
      else assertStringIncludes(result.text, `module "exaix-go/README.md" is not among`);
    });
  });
}
