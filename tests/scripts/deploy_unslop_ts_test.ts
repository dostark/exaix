/**
 * @module DeployUnslopTsTest
 * @path tests/scripts/deploy_unslop_ts_test.ts
 * @description Drives scripts/deploy_unslop_ts.ts against temp git repositories: usage errors, refusals, a successful move, a failed compatibility check, and --init.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/deploy_unslop_ts.ts, packages/lint-policy/tests/unslop_ts_compat_test.ts]
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { compatCommandArgs, compatEnv, isApprovalAnswer } from "../../scripts/deploy_unslop_ts.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "deploy_unslop_ts.ts");
const SUBMODULE = "unslop-ts";
const COMPAT_TEST = "packages/lint-policy/tests/unslop_ts_compat_test.ts";
const USAGE_EXIT = 2;
const FAILURE_EXIT = 1;
const PASSING_TEST = 'Deno.test("engine works", () => {});\n';
const FAILING_TEST = 'Deno.test("engine breaks the catalog", () => {\n  throw new Error("incompatible");\n});\n';
const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
  GIT_CONFIG_KEY_1: "commit.gpgsign",
  GIT_CONFIG_VALUE_1: "false",
  GIT_CONFIG_KEY_2: "tag.gpgsign",
  GIT_CONFIG_VALUE_2: "false",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

interface IRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface IFixture {
  readonly root: string;
  readonly superproject: string;
  readonly work: string;
  readonly remote: string;
}

async function run(command: string, args: readonly string[], cwd: string): Promise<IRun> {
  const result = await new Deno.Command(command, {
    args: [...args],
    cwd,
    env: GIT_ENV,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, stdout: decoder.decode(result.stdout), stderr: decoder.decode(result.stderr) };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run("git", args, cwd);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function commitFile(work: string, path: string, content: string, message: string): Promise<void> {
  await Deno.mkdir(dirname(join(work, path)), { recursive: true });
  await Deno.writeTextFile(join(work, path), content);
  await git(work, "add", "-A");
  await git(work, "commit", "-m", message);
}

/** A work repo with three tagged engine versions, a bare remote, and a superproject at the first version. */
async function createFixture(): Promise<IFixture> {
  const root = await Deno.makeTempDir({ prefix: "deploy_unslop_ts_" });
  const work = join(root, "work");
  const remote = join(root, "remote.git");
  const superproject = join(root, "super");
  await Deno.mkdir(work);
  await git(work, "init", "-q", "-b", "main");
  await commitFile(work, "tests/ok_test.ts", PASSING_TEST, "engine 1.0.0");
  await git(work, "tag", "v1.0.0");
  await commitFile(work, "CHANGELOG.md", "# changes\n", "add changelog for 1.1.0");
  await git(work, "tag", "v1.1.0");
  await commitFile(work, "tests/broken_test.ts", FAILING_TEST, "engine 2.0.0 breaks the catalog");
  await git(work, "tag", "v2.0.0");
  await git(root, "clone", "-q", "--bare", work, remote);
  await Deno.mkdir(superproject);
  await git(superproject, "init", "-q", "-b", "main");
  await git(superproject, "submodule", "add", "-q", remote, SUBMODULE);
  await git(join(superproject, SUBMODULE), "checkout", "-q", "--detach", "v1.0.0");
  await Deno.mkdir(join(superproject, "packages/lint-policy/tests"), { recursive: true });
  await Deno.writeTextFile(join(superproject, COMPAT_TEST), PASSING_TEST);
  await git(superproject, "add", "-A");
  await git(superproject, "commit", "-q", "-m", "embed the engine at 1.0.0");
  return { root, superproject, work, remote };
}

async function withFixture<T>(body: (fixture: IFixture) => Promise<T>): Promise<T> {
  const fixture = await createFixture();
  try {
    return await body(fixture);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
}

function deploy(cwd: string, ...args: string[]): Promise<IRun> {
  return run(Deno.execPath(), ["run", "-A", SCRIPT, ...args], cwd);
}

function submoduleHead(superproject: string): Promise<string> {
  return git(join(superproject, SUBMODULE), "rev-parse", "HEAD");
}

Deno.test("a ref that is neither a version tag nor a commit hash exits 2 with usage", async () => {
  await withFixture(async ({ superproject }) => {
    const before = await submoduleHead(superproject);
    for (const args of [["--ref=main"], ["--ref=v1.0"], ["--ref=v1.0.0; rm"], []]) {
      const result = await deploy(superproject, ...args);
      assertEquals(result.code, USAGE_EXIT, `${args.join(" ")}: ${result.stderr}`);
      assertStringIncludes(result.stderr, "Usage:");
      assertStringIncludes(result.stderr, "--yes");
    }
    assertEquals(await submoduleHead(superproject), before);
  });
});

Deno.test("a dirty submodule worktree exits 1 and leaves the pointer unchanged", async () => {
  await withFixture(async ({ superproject }) => {
    const before = await submoduleHead(superproject);
    await Deno.writeTextFile(join(superproject, SUBMODULE, "scratch.txt"), "local edit\n");
    const result = await deploy(superproject, "--ref=v1.1.0");
    assertEquals(result.code, FAILURE_EXIT, result.stderr);
    assertStringIncludes(result.stderr, "not clean");
    assertEquals(await submoduleHead(superproject), before);
  });
});

Deno.test("a commit that exists only locally exits 1 because the remote does not hold it", async () => {
  await withFixture(async ({ superproject }) => {
    const submodule = join(superproject, SUBMODULE);
    await git(submodule, "commit", "-q", "--allow-empty", "-m", "local only");
    const localOnly = await git(submodule, "rev-parse", "--short=10", "HEAD");
    const result = await deploy(superproject, `--ref=${localOnly}`);
    assertEquals(result.code, FAILURE_EXIT, result.stderr);
    assertStringIncludes(result.stderr, "not published");
  });
});

Deno.test("a published tag moves the pointer, stages it, prints the incoming log, and commits nothing", async () => {
  await withFixture(async ({ superproject }) => {
    const commitsBefore = await git(superproject, "rev-list", "--count", "HEAD");
    const result = await deploy(superproject, "--ref=v1.1.0", "--yes");
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "add changelog for 1.1.0");
    assertEquals(await git(superproject, "diff", "--cached", "--name-only"), SUBMODULE);
    assertEquals(
      await submoduleHead(superproject),
      await git(join(superproject, SUBMODULE), "rev-parse", "v1.1.0^{commit}"),
    );
    assertEquals(await git(superproject, "rev-list", "--count", "HEAD"), commitsBefore);
  });
});

Deno.test("a tag whose tests fail exits 1 and restores the previous pointer", async () => {
  await withFixture(async ({ superproject }) => {
    const before = await submoduleHead(superproject);
    const result = await deploy(superproject, "--ref=v2.0.0", "--yes");
    assertEquals(result.code, FAILURE_EXIT, result.stdout + result.stderr);
    assertStringIncludes(result.stderr, "compatibility check failed");
    assertEquals(await submoduleHead(superproject), before);
    assertEquals(await git(superproject, "diff", "--cached", "--name-only"), "");
  });
});

Deno.test("a non-interactive deploy without --yes stops after the incoming log and changes nothing", async () => {
  await withFixture(async ({ superproject }) => {
    const before = await submoduleHead(superproject);
    const result = await deploy(superproject, "--ref=v2.0.0");
    assertEquals(result.code, FAILURE_EXIT, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, "engine 2.0.0 breaks the catalog");
    assertStringIncludes(result.stderr, "--yes");
    assertEquals(result.stdout.includes("passed"), false, "no test may run before approval");
    assertEquals(await submoduleHead(superproject), before);
    assertEquals(await git(superproject, "diff", "--cached", "--name-only"), "");
  });
});

Deno.test("only y and yes approve a deploy, in any case", () => {
  for (const answer of ["y", "Y", "yes", " YES "]) assertEquals(isApprovalAnswer(answer), true, answer);
  for (const answer of ["", "n", "no", "yep", null]) assertEquals(isApprovalAnswer(answer), false, String(answer));
});

Deno.test("--init checks out the recorded pointer in a clone without the submodule", async () => {
  await withFixture(async ({ root, superproject }) => {
    const clone = join(root, "clone");
    await git(root, "clone", "-q", superproject, clone);
    assertFalse((await Deno.stat(join(clone, SUBMODULE, "tests")).catch(() => null)) !== null);
    const result = await deploy(clone, "--init");
    assertEquals(result.code, 0, result.stdout + result.stderr);
    assertEquals(await submoduleHead(clone), await submoduleHead(superproject));
  });
});

Deno.test("the compatibility check runs with scoped permissions and never with full or network access", () => {
  const args = compatCommandArgs("/repo", "/tmp/scratch");
  assertEquals(args[0], "test");
  for (const forbidden of ["-A", "--allow-all", "--allow-net"]) {
    assertFalse(args.some((arg) => arg === forbidden || arg.startsWith(`${forbidden}=`)), forbidden);
  }
  assertEquals(args.filter((arg) => arg.startsWith("--allow-read=")), ["--allow-read=/repo,/tmp/scratch"]);
  assertEquals(args.filter((arg) => arg.startsWith("--allow-write=")), ["--allow-write=/tmp/scratch"]);
  assertEquals(args.filter((arg) => arg.startsWith("--allow-run=")), ["--allow-run=deno,git"]);
});

Deno.test("the compatibility check environment drops loader variables and keeps the rest", () => {
  const env = compatEnv({
    PATH: "/bin",
    LD_LIBRARY_PATH: "/lib",
    LD_PRELOAD: "x.so",
    DYLD_LIBRARY_PATH: "/d",
    HOME: "/h",
  });
  assertEquals(env, { PATH: "/bin", HOME: "/h" });
});

Deno.test("the deploy script never commits or pushes", async () => {
  const source = await Deno.readTextFile(SCRIPT);
  assertFalse(/["'`](commit|push)["'`]/.test(source), "the script must not pass commit or push to git");
  assertStringIncludes(source, "[--yes]");
  assertStringIncludes(source, "not a hostile ref");
});

Deno.test("deploy_compatibility_uses_exact_scoped_grants", () => {
  const args = compatCommandArgs("/repo", "/tmp/scratch");
  assertEquals(args.slice(0, 6), [
    "test",
    "--allow-read=/repo,/tmp/scratch",
    "--allow-write=/tmp/scratch",
    "--allow-run=deno,git",
    "--allow-env=" + args[4].slice("--allow-env=".length),
    args[5],
  ]);
  assertEquals(args[1], "--allow-read=/repo,/tmp/scratch");
  assertEquals(args[2], "--allow-write=/tmp/scratch");
  assertEquals(args[3], "--allow-run=deno,git");
  assertStringIncludes(args[4], "DEMO_LINT_RULES");
  const env = compatEnv({ HOME: "/home/test", LD_PRELOAD: "bad.so", DYLD_LIBRARY_PATH: "bad" });
  assertEquals(env, { HOME: "/home/test" });
});
