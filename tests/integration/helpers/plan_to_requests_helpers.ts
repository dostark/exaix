/**
 * @module PlanToRequestsHelpers
 * @path tests/integration/helpers/plan_to_requests_helpers.ts
 * @description Shared paths, generator subprocess runner, and fake-worktree builder for the
 *   plan_to_requests integration and security tests.
 * @architectural-layer Test
 * @related-files [tests/integration/plan_to_requests_test.ts, tests/integration/plan_to_requests_security_test.ts]
 */

import { join } from "@std/path";

export const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
export const FIXTURES_DIR = join(REPO_ROOT, "tests", "integration", "fixtures");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
export const CONTEXT_FIXTURE_PATH = join(FIXTURES_DIR, "phase-nn-fixture-with-context.md");
export const CONTEXT_SLUG = "phase-nn-fixture-with-context";

export async function runGenerator(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      SCRIPT_PATH,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

/** Minimal stand-in for a delegate worktree: a directory optionally containing a
 *  `.git/` tree, a pre-seeded `.git/info/exclude`, and a tracked `.gitignore`. */
export async function makeFakeWorktree(
  opts: { withGit: boolean; gitignore?: string },
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "plan-to-req-wt-" });
  if (opts.withGit) {
    await Deno.mkdir(join(root, ".git", "info"), { recursive: true });
  }
  if (opts.gitignore !== undefined) {
    await Deno.writeTextFile(join(root, ".gitignore"), opts.gitignore);
  }
  return root;
}
