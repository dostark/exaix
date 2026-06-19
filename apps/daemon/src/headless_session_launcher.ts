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
 * @architectural-layer Services
 * @dependencies [@exaix/session, @exaix/schemas, @std/path]
 * @related-files [packages/session/src/supervised_launch.ts, packages/session/src/session_adapter_registry.ts]
 */

import { join } from "@std/path";
import { assertBinaryAllowed, sanitizeChildEnv } from "@exaix/session/supervised_launch.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { SESSION_GATE_DECISIONS, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionDecision, SessionReturn } from "@exaix/schemas/session_delegate.ts";

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
/** OpenCode JSON event type strings — used by tryReadStdoutAndSynthesize. */
const OPENCODE_EVENT_TEXT = "text";
const OPENCODE_EVENT_STEP_FINISH = "step_finish";

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
    if (await this.tryReadStdoutAndSynthesize(child, traceId, returnPath)) {
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
   * Returns true when synthesis succeeded.
   * Fail-safe: catches all errors (incl. mock ChildProcess with no real stdout).
   */
  /** @internal Visible for testing — parses opencode --format json stdout. */
  async tryReadStdoutAndSynthesize(
    child: Deno.ChildProcess,
    traceId: string,
    returnPath: string,
  ): Promise<boolean> {
    let raw: string;
    try {
      const reader = child.stdout.getReader();
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stdout timeout")), 100));
      const { value, done } = await Promise.race([reader.read(), timeout]);
      reader.releaseLock();
      if (done || !value) return false;
      raw = new TextDecoder().decode(value);
    } catch {
      return false;
    }
    if (!raw.trim()) return false;

    const { lastText, tokens, hasJsonEvents } = this.parseJsonEvents(raw);
    if (!hasJsonEvents) return false;

    // Read the brief to determine gate and trace info
    const briefPath = join(this.deps.sessionDir, traceId, "brief.json");
    let briefGate: string;
    let briefTraceId: string;
    let briefResumeToken: string;
    try {
      const raw = await Deno.readTextFile(briefPath);
      const parsed = JSON.parse(raw);
      briefGate = parsed.gate;
      briefTraceId = parsed.trace_id;
      briefResumeToken = parsed.resume_token;
    } catch {
      return false;
    }

    const gate = briefGate as SessionDecision;
    const decision =
      (SESSION_GATE_DECISIONS[gate as keyof typeof SESSION_GATE_DECISIONS]?.[0] ?? "abandoned") as SessionDecision;

    const sessionReturn: SessionReturn = SessionReturnSchema.parse({
      trace_id: briefTraceId,
      resume_token: briefResumeToken,
      decision,
      summary: lastText || `Session tool completed the ${gate} task.`,
      paths_touched: [],
      token_stats: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        total_tokens: tokens.total,
      },
    });

    await Deno.mkdir(join(this.deps.sessionDir, traceId), { recursive: true });
    const tmp = `${returnPath}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(sessionReturn, null, 2));
    await Deno.rename(tmp, returnPath);
    return true;
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

  /**
   * Parse a stream of newline-delimited JSON events (e.g. opencode --format json)
   * and extract the last text response and token stats.
   */
  private parseJsonEvents(raw: string): {
    lastText: string;
    tokens: { input: number; output: number; total: number };
    hasJsonEvents: boolean;
  } {
    let lastText = "";
    let tokens = { input: 0, output: 0, total: 0 };
    let hasJsonEvents = false;

    // Try single JSON object format (Claude Code --output-format json)
    const singleResult = this.tryParseSingleJsonResult(raw);
    if (singleResult) return singleResult;

    // Newline-delimited JSON events format (OpenCode --format json)
    const trimmed = raw.trim();
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (typeof event !== "object" || !event.type) continue;
        hasJsonEvents = true;
        if (event.type === OPENCODE_EVENT_TEXT && event.part?.text) {
          lastText = event.part.text;
        }
        if (event.type === OPENCODE_EVENT_STEP_FINISH && event.part?.tokens) {
          tokens = {
            input: event.part.tokens.input ?? 0,
            output: event.part.tokens.output ?? 0,
            total: event.part.tokens.total ?? 0,
          };
        }
      } catch {
        // Not a JSON line — skip
      }
    }
    return { lastText, tokens, hasJsonEvents };
  }

  /**
   * Try to parse a single JSON result object (Claude Code --output-format json).
   * Returns parsed data or null if the format doesn't match.
   */
  private tryParseSingleJsonResult(raw: string): {
    lastText: string;
    tokens: { input: number; output: number; total: number };
    hasJsonEvents: boolean;
  } | null {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type !== "result" || typeof obj.result !== "string") return null;
      const tokens = obj.usage
        ? {
          input: obj.usage.input_tokens ?? 0,
          output: obj.usage.output_tokens ?? 0,
          total: (obj.usage.input_tokens ?? 0) + (obj.usage.output_tokens ?? 0),
        }
        : { input: 0, output: 0, total: 0 };
      return { lastText: obj.result, tokens, hasJsonEvents: true };
    } catch {
      return null;
    }
  }
}
