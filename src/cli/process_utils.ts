/**
 * @module ProcessUtils
 * @path src/cli/process_utils.ts
 * @description Provides standalone CLI process helpers for Unix-like environments, such as PID liveness checks using signal sending.
 * @architectural-layer CLI
 * * @related-files [src/cli/daemon_commands.ts]
 */

/**
 * Check whether a PID appears alive by using `kill -0`.
 *
 * NOTE: This is POSIX-specific; Exaix's CLI currently assumes a Unix-like environment.
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
