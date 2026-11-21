/**
 * @module GoCheckoutFixture
 * @path tests/scripts/helpers/go_checkout_fixture.ts
 * @description Provides disposable Go checkout copies and command helpers for script tests.
 * @architectural-layer Test
 */
import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";

export interface IRun {
  code: number;
  text: string;
}

export const GO = Deno.env.get("GO_BIN") ?? "go";
export const GO_PATH = GO.includes("/") ? `${dirname(GO)}:${Deno.env.get("PATH") ?? ""}` : Deno.env.get("PATH") ?? "";
export const TARGETS = ["linux/amd64", "linux/arm64", "darwin/arm64", "windows/amd64"];

export async function run(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<IRun> {
  const gitEnv: Record<string, string> = command === "git"
    ? {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    }
    : {};
  const result = await new Deno.Command(command, {
    cwd,
    args,
    env: { ...gitEnv, ...env, LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, text: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

export function git(cwd: string, ...args: string[]): Promise<IRun> {
  return run(cwd, "git", args, { PATH: GO_PATH });
}

export function make(cwd: string, target: string, env: Record<string, string> = {}): Promise<IRun> {
  return run(cwd, "make", [target, `GO=${GO}`], { PATH: GO_PATH, ...env });
}

export async function copyCheckout(source: string, dir: string): Promise<string> {
  const dest = join(dir, "exaix-go");
  const result = await run(dir, "cp", ["-a", source, dest]);
  assertEquals(result.code, 0, result.text);
  await Deno.remove(join(dest, ".git")).catch(() => {});
  return dest;
}

export async function commitBase(repo: string): Promise<void> {
  assertEquals((await git(repo, "init", "-q")).code, 0);
  assertEquals((await git(repo, "add", "-A")).code, 0);
  assertEquals((await git(repo, "commit", "-q", "-m", "base")).code, 0);
}
