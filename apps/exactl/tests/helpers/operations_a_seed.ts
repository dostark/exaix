/**
 * @module OperationsASeed
 * @path apps/exactl/tests/helpers/operations_a_seed.ts
 * @description Turns a temporary exactl workspace into a git repository for the git leaves.
 * @architectural-layer Test
 * @related-files [apps/exactl/tests/output_contract_operations_a_test.ts]
 */

/** Runs `git init` in `root`, so the git leaves read a real repository. */
export async function seedOperationsA(root: string): Promise<void> {
  const { success, stderr } = await new Deno.Command("git", {
    args: ["init", "--quiet", root],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!success) throw new Error(`git init failed: ${new TextDecoder().decode(stderr)}`);
}
