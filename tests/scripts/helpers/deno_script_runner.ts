/**
 * @module DenoScriptRunner
 * @path tests/scripts/helpers/deno_script_runner.ts
 * @description Runs a Deno script with captured output for script-level tests.
 * @architectural-layer Test
 */

export interface IScriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a Deno script and capture its output. */
export async function runDenoScript(
  tool: string,
  args: readonly string[],
  cwd: string,
): Promise<IScriptResult> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", tool, ...args],
    cwd,
    env: { ...Deno.env.toObject() },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(result.stdout);
  const stderr = decoder.decode(result.stderr);
  return { code: result.code, stdout, stderr };
}
