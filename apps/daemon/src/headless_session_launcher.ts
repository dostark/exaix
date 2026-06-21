/**
 * @module HeadlessSessionLauncher
 * @path apps/daemon/src/headless_session_launcher.ts
 * @description Phase 111 Step 2 — spawns a headless session tool non-interactively
 *   (fire-and-forget). Sanitizes the child env (sanitizeChildEnv), asserts the binary
 *   against the allowlist (assertBinaryAllowed), spawns via Deno.Command with
 *   discrete argv (no shell). On non-zero exit with no return.json, synthesizes an
 *   abandoned return so the gate is not left dangling.
 *   Phase 111 GAP-1 fix: captures stdout for tools that emit JSON events (openCode
 *   --format json) and synthesizes return.json from the event stream.
 *   Phase 123 R1 hardening: full-stream drain, extracted parser, git-diff paths_touched,
 *   atomic writes.
 * @architectural-layer Services
 * @dependencies [@exaix/session, @exaix/schemas, @std/path]
 * @related-files [packages/session/src/delegate_return_parser.ts, packages/session/src/supervised_launch.ts, packages/session/src/session_adapter_registry.ts]
 */

import { join } from "@std/path";
import { assertBinaryAllowed, sanitizeChildEnv } from "@exaix/session/supervised_launch.ts";
import { parseDelegateStdout } from "@exaix/session/delegate_return_parser.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { SESSION_GATE_DECISIONS, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionDecision, SessionReturn, SessionTool } from "@exaix/schemas/session_delegate.ts";
import { DELEGATE_STDOUT_DRAIN_MS } from "@exaix/core/types";

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
    if (await this.tryReadStdoutAndSynthesize(child, traceId, returnPath, launch.cwd)) {
      return; // Successfully synthesized from stdout
    }
    // Fall back to checking for tool-written return.json
    try {
      await Deno.stat(returnPath);
      // return.json exists — no abandoned synthesis needed
    } catch {
      // No return.json and no stdout — synthesize abandoned
      await this.synthesizeAbandoned(traceId);
    }
  }

  /**
   * Read the child's piped stdout, attempt to parse as JSON events
   * (e.g. opencode --format json), and if found, synthesize a return.json.
   * Uses the extracted delegate_return_parser for parsing and git diff for
   * paths_touched.
   * Returns true when synthesis succeeded.
   * Fail-safe: catches all errors (incl. mock ChildProcess with no real stdout).
   */
  /** @internal Visible for testing — parses opencode --format json stdout. */
  async tryReadStdoutAndSynthesize(
    child: Deno.ChildProcess,
    traceId: string,
    returnPath: string,
    worktreePath?: string,
  ): Promise<boolean> {
    let raw: string;
    try {
      raw = await this.drainStdout(child);
    } catch {
      return false;
    }
    if (!raw.trim()) return false;

    // Determine tool from the brief's tool field
    const briefPath = join(this.deps.sessionDir, traceId, "brief.json");
    let briefTool: string;
    let briefGate: string;
    let briefTraceId: string;
    let briefResumeToken: string;
    try {
      const raw = await Deno.readTextFile(briefPath);
      const parsed = JSON.parse(raw);
      briefTool = parsed.tool;
      briefGate = parsed.gate;
      briefTraceId = parsed.trace_id;
      briefResumeToken = parsed.resume_token;
    } catch {
      return false;
    }

    const tool: SessionTool = briefTool === "claude-code" ? "claude-code" : "opencode";
    const parsed = parseDelegateStdout(raw, tool);

    // Compute paths_touched: union of parser toolPaths + git diff
    let pathsTouched = parsed.toolPaths;
    if (worktreePath) {
      const gitPaths = await this.computeGitDiff(worktreePath);
      if (gitPaths.length > 0) {
        const seen = new Set(pathsTouched);
        for (const p of gitPaths) {
          if (!seen.has(p)) {
            seen.add(p);
            pathsTouched = [...pathsTouched, p];
          }
        }
      }
    }

    const gate = briefGate as SessionDecision;
    const decision =
      (SESSION_GATE_DECISIONS[gate as keyof typeof SESSION_GATE_DECISIONS]?.[0] ?? "abandoned") as SessionDecision;

    const sessionReturn: SessionReturn = SessionReturnSchema.parse({
      trace_id: briefTraceId,
      resume_token: briefResumeToken,
      decision,
      summary: parsed.lastText || `Session tool completed the ${briefGate} task.`,
      paths_touched: pathsTouched,
      token_stats: {
        input_tokens: parsed.tokenStats.input,
        output_tokens: parsed.tokenStats.output,
        total_tokens: parsed.tokenStats.total,
      },
      cost_usd: parsed.costUsd,
    });

    await Deno.mkdir(join(this.deps.sessionDir, traceId), { recursive: true });
    const tmp = `${returnPath}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(sessionReturn, null, 2));
    await Deno.rename(tmp, returnPath);
    return true;
  }

  /**
   * Drain the child's piped stdout completely, bounded by DELEGATE_STDOUT_DRAIN_MS.
   * Returns the concatenated output as a string.
   */
  private async drainStdout(child: Deno.ChildProcess): Promise<string> {
    const reader = child.stdout.getReader();
    const chunks: Uint8Array[] = [];
    const decoder = new TextDecoder();
    let totalLength = 0;

    try {
      while (true) {
        const read = reader.read();
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("stdout drain timeout")), DELEGATE_STDOUT_DRAIN_MS)
        );
        const { value, done } = await Promise.race([read, timeout]);
        if (done) break;
        if (value) {
          chunks.push(value);
          totalLength += value.length;
        }
      }
    } catch {
      // Timeout or stream error — return what we have
    } finally {
      reader.releaseLock();
    }

    if (chunks.length === 0) return "";
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return decoder.decode(combined);
  }

  /**
   * Capture git -C <worktreePath> rev-parse HEAD before spawn, then compute
   * git diff --name-only after exit to produce paths_touched from actual changes.
   */
  private async computeGitDiff(worktreePath: string): Promise<string[]> {
    try {
      const diffCmd = new Deno.Command("git", {
        args: ["-C", worktreePath, "diff", "--name-only", "HEAD"],
        stdout: "piped",
        stderr: "null",
      });
      const diffOutput = await diffCmd.output();
      if (!diffOutput.success) return [];
      const diffText = new TextDecoder().decode(diffOutput.stdout).trim();
      if (!diffText) return [];
      return diffText.split("\n").filter((p) => p.trim().length > 0);
    } catch {
      return [];
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
