/**
 * @module LintPolicyTestHelper
 * @path packages/testing/src/helpers/lint_policy.ts
 * @description Installs the portal lint policy directory once per test process and returns its path.
 * @architectural-layer Testing
 * @dependencies [@std/path]
 * @related-files [packages/lint-policy/src/tools/install_portal_policy.ts, packages/testing/mod.ts]
 */

import { join, resolve } from "@std/path";
import { REPO_ROOT } from "./repo_root.ts";

/** The root task that installs a policy directory from the portal configuration. */
export const LINT_POLICY_TASK = "unslop-ts:policy";

/** The policy subdirectory the installer writes under the requested directory. */
export const LINT_POLICY_DIR = "unslop";

const pending = new Map<string, Promise<string>>();

async function buildPolicy(dir: string): Promise<string> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", LINT_POLICY_TASK, "--out", dir],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(
      `the lint policy installer failed: deno task ${LINT_POLICY_TASK} exited ${result.code}: ${stderr}`,
    );
  }
  return join(dir, LINT_POLICY_DIR);
}

/** Installs `<dir>/unslop/` once per process and returns the policy directory. */
export function installLintPolicyForTest(dir: string): Promise<string> {
  const key = resolve(dir);
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const created = buildPolicy(key);
  pending.set(key, created);
  return created;
}
