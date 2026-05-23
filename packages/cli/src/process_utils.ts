/**
 * @module ProcessUtils
 * @path packages/cli/src/process_utils.ts
 * @related-files []
 * @description Provides standalone CLI process helpers for Unix-like environments, such as PID liveness checks using signal sending.
 * @architectural-layer CLI
 * @ungrounded
 */

export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    const cmd = new Deno.Command("kill", {
      args: ["-0", pid.toString()],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    return result.success;
  } catch {
    return false;
  }
}
