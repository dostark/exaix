/**
 * @module HeadlessSessionLauncher
 * @path apps/daemon/src/headless_session_launcher.ts
 * @description Phase 111 Step 2 — spawns a headless session tool non-interactively
 *   (fire-and-forget). Sanitizes the child env (sanitizeChildEnv), asserts the binary
 *   against the allowlist (assertBinaryAllowed), spawns via Deno.Command with
 *   discrete argv (no shell). On non-zero exit with no return.json, synthesizes an
 *   abandoned return so the gate is not left dangling.
 * @architectural-layer Services
 * @dependencies [@exaix/session, @exaix/schemas, @std/path]
 * @related-files [packages/session/src/supervised_launch.ts, apps/daemon/src/session_return_watcher.ts]
 */

import { join } from "@std/path";
import { assertBinaryAllowed, sanitizeChildEnv } from "@exaix/session/supervised_launch.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";

/** Args forwarded to the (injectable) spawn function, for testability. */
export interface ISpawnArgs {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface IHeadlessSessionLauncherDeps {
  /** Absolute Session/ directory under which {traceId}/return.json is expected. */
  sessionDir: string;
  /** Set of absolute binary paths or binary names permitted to spawn. */
  allowlist: ReadonlySet<string>;
  /**
   * Injectable spawn function. Defaults to `(args) => new Deno.Command(args.command, { ... }).spawn()`.
   * Override in tests under `DENO_TEST` to avoid real subprocess execution.
   */
  spawn?: (args: ISpawnArgs) => Deno.ChildProcess;
}

const RETURN_FILE = "return.json";

/**
 * Fire-and-forget headless session launcher. Spawns the binary, waits for exit in
 * a detached promise, and synthesizes an abandoned return on exit-without-return.
 */
export class HeadlessSessionLauncher {
  constructor(private readonly deps: IHeadlessSessionLauncherDeps) {}

  /**
   * Spawn a headless session tool. Returns once the process has been spawned
   * (fire-and-forget); exit handling and abandoned synthesis happen asynchronously.
   */
  async launch(launch: ISessionLaunch, traceId: string): Promise<void> {
    const parentEnv = Deno.env.toObject();
    const sanitizedEnv = sanitizeChildEnv(launch.env, parentEnv);
    assertBinaryAllowed(launch.command, this.deps.allowlist);

    const spawn = this.deps.spawn ?? ((args: ISpawnArgs) =>
      new Deno.Command(args.command, {
        args: args.args,
        cwd: args.cwd,
        env: args.env,
        stdout: "piped",
        stderr: "piped",
      }).spawn());

    const child = spawn({ command: launch.command, args: launch.args, cwd: launch.cwd, env: sanitizedEnv });
    await child.status;

    const returnPath = join(this.deps.sessionDir, traceId, RETURN_FILE);
    try {
      await Deno.stat(returnPath);
      // return.json exists — no abandoned synthesis needed
    } catch {
      // No return.json — synthesize abandoned
      await this.synthesizeAbandoned(traceId);
    }
  }

  private async synthesizeAbandoned(traceId: string): Promise<void> {
    const dir = join(this.deps.sessionDir, traceId);
    const returnPath = join(dir, RETURN_FILE);
    const abandoned = SessionReturnSchema.parse({
      trace_id: traceId,
      resume_token: "synthesized-abandoned",
      decision: "abandoned",
      summary: "Session tool exited without producing a return.json — marked abandoned.",
      paths_touched: [],
      token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });
    await Deno.mkdir(dir, { recursive: true });
    const tmp = `${returnPath}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(abandoned, null, 2));
    await Deno.rename(tmp, returnPath);
  }
}
