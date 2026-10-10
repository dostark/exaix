/**
 * @module DaemonConfigHelper
 * @path tests/integration/helpers/daemon_config.ts
 * @description Shared daemon TOML config builder for integration tests.
 *
 * Phase 137: TOML is bootstrap-only — only system.root is strictly needed.
 * Additional sections below preserve backward compatibility for tests that
 * read paths/configs from the parsed TOML. New tests should use the
 * adapter pattern (DirectConfigAdapter.set()) instead.
 */

import { dirname, join } from "@std/path";
import { Database } from "@db/sqlite";
import type { Opt, Reason } from "@exaix/core/types";

/** How a daemon process ended, with its stderr tail for diagnosis. */
export interface IDaemonExit {
  /** Null when the transport reports only that the child closed, as the stdio transport does. */
  code: number | null;
  stderrTail: string;
}

/** The running daemon as seen from inside a boot callback. */
export interface IRunningDaemon {
  /** Resolves once `check` holds, or rejects if the daemon exits first. There is no clock. */
  until(check: () => boolean | Promise<boolean>, awaiting: string): Promise<void>;
}

/**
 * Options for {@link bootRealDaemon}. `midFlight` runs after `daemon.ready`.
 * It must await its own effects. `waitForAfterInject` polls until it holds.
 * A daemon exit fails either wait first.
 */
export interface IRealDaemonBootOptions {
  /** Explicit child permissions for tests that prove network confinement. */
  denoPermissions?: string[];
  extraEnv?: Record<string, string>;
  /** Runs once the daemon journals ready. It must await work through `daemon.until`. */
  midFlight?: (daemon: IRunningDaemon) => void | Promise<void>;
  /** Resolves true once the expected journaled effect is observable. */
  waitForAfterInject?: () => boolean | Promise<boolean>;
}

/** The booted daemon's process id, and how it ended once the teardown awaited its exit. */
export interface IDaemonBootResult {
  pid: number;
  exit: IDaemonExit;
}

/** Repo root, from `tests/integration/helpers/` — the source of `migrations/` and `deno.json`. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

/** Migrates a workspace's `.exa/journal.db` via `scripts/setup_db.ts` before daemon boot — unmigrated, a Team daemon dies at startup with `no such table: model_benchmark`. Idempotent. */
export async function migrateDaemonWorkspace(root: string): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), join(REPO_ROOT, "scripts", "setup_db.ts")],
    cwd: root,
    env: { EXA_MIGRATIONS_DIR: join(REPO_ROOT, "migrations") },
  }).output();
  // Fatal, not a warning: a daemon booting on an unmigrated database fails later on whichever
  // table it happens to touch first, which reads as an unrelated defect. Fail here instead.
  if (!result.success) {
    throw new Error(
      `setup_db.ts exited ${result.code} for workspace ${root}; the daemon database would be unmigrated.\n` +
        new TextDecoder().decode(result.stderr),
    );
  }
}

export function writeDaemonConfig(
  configPath: string,
  root: string,
  allowNetLine = "allow_net = []",
): void {
  const cfg = daemonConfigSections(root, allowNetLine).join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Portal dir must be separate from the daemon root, or the git audit flags the daemon's own runtime writes (.exa/*.db, logs/, ...) as unauthorized changes. */
export function writePortalDir(root: string): string {
  const portalDir = join(root, "portal-repo");
  Deno.mkdirSync(portalDir, { recursive: true });
  return portalDir;
}

export function daemonConfigSections(root: string, allowNetLine = "allow_net = []"): string[] {
  return [
    "[system]",
    `root = "${root}"`,
    allowNetLine,
    "",
    "[paths]",
    'workspace = "./Workspace"',
    'blueprints = "./Blueprints"',
    'runtime = "./.exa"',
    'memory = "./Memory"',
    'portals = "./Portals"',
  ];
}

/** Bootstrap TOML config with a mock (non-networked) AI provider, for daemon-boot tests that don't need real network calls. The `[models.mock]` entry and `agents.default_model` pin the boot provider to mock so it cannot silently resolve to a billable provider. */
export function writeDaemonConfigWithMockAi(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[agents]",
    'default_model = "mock"',
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
    "[models.mock]",
    'provider = "mock"',
    'model = "test"',
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Reads a daemon.pid and asserts it's a live PID — used by leak-guard tests to capture the PID before a deliberate failure, to later confirm teardown killed it. */
export async function readDaemonPid(pidPath: string): Promise<number> {
  const pid = parseInt((await Deno.readTextFile(pidPath)).trim(), 10);
  if (Number.isNaN(pid)) {
    throw new Error(`daemon.pid at ${pidPath} did not contain a numeric PID`);
  }
  return pid;
}

/** Asserts a previously-captured PID is dead. `Deno.kill(pid, "SIGCONT")` is a harmless liveness probe — throws `NotFound` if dead, succeeds silently if alive. */
export function assertDaemonPidIsDead(pid: number): void {
  let stillAlive = true;
  try {
    Deno.kill(pid, "SIGCONT");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      stillAlive = false;
    } else {
      throw e;
    }
  }
  if (stillAlive) {
    throw new Error(`daemon PID ${pid} must not survive a failed assertion mid-lifecycle`);
  }
}

/** How often a waiter re-reads the journal. This is a read cadence, not a deadline. */
const DAEMON_EVENT_POLL_MS = 100;
/** Tail of daemon stderr kept for the failure message when the daemon exits early. */
const DAEMON_STDERR_TAIL_CHARS = 2000;

/**
 * Resolves once `check` holds. Rejects when the daemon exits first, naming the awaited event.
 * No wall-clock budget is used. A fixed budget encodes machine speed. A daemon that stays alive
 * and never journals the event keeps the wait open. Only the CI job limit ends that case.
 */
export async function waitForDaemonEvent(
  check: () => boolean | Promise<boolean>,
  exited: Promise<IDaemonExit>,
  awaiting: string,
): Promise<void> {
  for (;;) {
    if (await check()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), DAEMON_EVENT_POLL_MS);
    });
    const outcome = await Promise.race([tick, exited]);
    clearTimeout(timer);
    if (outcome === undefined) continue;
    // The event may have been journaled just before the exit.
    if (await check()) return;
    const how = outcome.code === null ? "process exited" : `process exited with code ${outcome.code}`;
    throw new Error(`${how} before ${awaiting}:\n${outcome.stderrTail}`);
  }
}

/** Reads a child's stderr to EOF and keeps only its last characters. Drained so the pipe never blocks the child. */
async function collectStderrTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) {
    tail = (tail + decoder.decode(chunk, { stream: true })).slice(-DAEMON_STDERR_TAIL_CHARS);
  }
  return tail + decoder.decode();
}

/**
 * Resolves with a child's exit code and the tail of its stderr. A child whose stderr is piped
 * is drained as it runs, so a full pipe can never block it. A child with no piped stderr gets an empty tail.
 */
export function watchChildExit(proc: Deno.ChildProcess): Promise<IDaemonExit> {
  // Deno throws on reading `stderr` when it was not piped, so the check is a try, not a null test.
  let stderr: ReadableStream<Uint8Array> | undefined;
  try {
    stderr = proc.stderr;
  } catch {
    stderr = undefined;
  }
  const stderrTail = stderr ? collectStderrTail(stderr) : Promise.resolve("");
  return proc.status.then(async (status) => ({ code: status.code, stderrTail: await stderrTail }));
}

/** Max activity rowid in the workspace journal, or 0 when the DB or table is absent. Read
 *  before a boot so a repeated boot in one workspace waits for a NEW daemon.ready row. */
function journalMaxRowid(journalPath: string): number {
  try {
    const db = new Database(journalPath, { readonly: true });
    try {
      const row = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS maxRowid FROM activity").get() as
        | { maxRowid: number }
        | undefined;
      return row?.maxRowid ?? 0;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

/** Journal actions that end a request in failure. Waits include them, so a failed run fails at once. */
export const REQUEST_FAILURE_ACTIONS: readonly string[] = [
  "request.processing.error",
  "request.failed",
  "request.invalid",
];

/** Journal actions that end a request's processing, on success. */
export const REQUEST_SUCCESS_ACTIONS: readonly string[] = ["request.processing.duration"];

/** Every journal action that ends a request, success or failure. */
export const REQUEST_OUTCOME_ACTIONS: readonly string[] = [...REQUEST_SUCCESS_ACTIONS, ...REQUEST_FAILURE_ACTIONS];

/** True once the journal holds a row with any of `actions`. Pass `traceId` to scope to one request. */
export function daemonJournalHasAny(
  configPath: string,
  actions: readonly string[],
  traceId?: Opt<string, Reason.OptionalInput>,
): boolean {
  const journalPath = join(dirname(configPath), ".exa", "journal.db");
  try {
    const db = new Database(journalPath, { readonly: true });
    try {
      const marks = actions.map(() => "?").join(", ");
      const scoped = traceId === undefined ? "" : " AND trace_id = ?";
      const params = traceId === undefined ? [...actions] : [...actions, traceId];
      const row = db.prepare(
        `SELECT 1 AS found FROM activity WHERE action_type IN (${marks})${scoped} LIMIT 1`,
      ).get(...params);
      return row !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Rowid of the first journal row with this action whose payload contains `text`, or undefined. Lets a barrier find its own row. */
export function daemonJournalRowidWithText(configPath: string, action: string, text: string): number | undefined {
  const journalPath = join(dirname(configPath), ".exa", "journal.db");
  try {
    const db = new Database(journalPath, { readonly: true });
    try {
      const row = db.prepare(
        "SELECT rowid FROM activity WHERE action_type = ? AND instr(payload, ?) > 0 ORDER BY rowid LIMIT 1",
      ).get<{ rowid: number }>(action, text);
      return row?.rowid;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** True once the journal holds a row with this exact action and target. Use it to observe one specific rejection. */
export function daemonJournalHasEvent(configPath: string, action: string, target: string): boolean {
  const journalPath = join(dirname(configPath), ".exa", "journal.db");
  try {
    const db = new Database(journalPath, { readonly: true });
    try {
      const row = db.prepare("SELECT 1 AS found FROM activity WHERE action_type = ? AND target = ? LIMIT 1")
        .get(action, target);
      return row !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** True once a daemon.ready row newer than `afterRowid` exists. That event fires once every
 *  watcher is listening, so it is the daemon's authoritative readiness signal. */
function daemonReadySince(journalPath: string, afterRowid: number): boolean {
  try {
    const db = new Database(journalPath, { readonly: true });
    try {
      const row = db.prepare(
        "SELECT rowid FROM activity WHERE action_type = 'daemon.ready' AND rowid > ? ORDER BY rowid LIMIT 1",
      ).get(afterRowid);
      return row !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Boots the real daemon and waits for its `daemon.ready` event.
 * Then runs the optional mid-flight input and waits for its effect.
 * Finally sends SIGTERM and awaits the exit on every path. Migrates the workspace first (see {@link migrateDaemonWorkspace}).
 */
export async function bootRealDaemon(
  configPath: string,
  options: IRealDaemonBootOptions = {},
): Promise<IDaemonBootResult> {
  const workspaceRoot = dirname(configPath);
  await migrateDaemonWorkspace(workspaceRoot);
  const journalPath = join(workspaceRoot, ".exa", "journal.db");
  const readyBaseline = journalMaxRowid(journalPath);
  const proc = new Deno.Command("deno", {
    args: [
      "run",
      "--config",
      join(REPO_ROOT, "deno.json"),
      ...(options.denoPermissions ?? ["--allow-all"]),
      join(REPO_ROOT, "apps", "daemon", "main.ts"),
    ],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1", ...options.extraEnv },
  }).spawn();
  const exited = watchChildExit(proc);
  let exit: IDaemonExit = { code: null, stderrTail: "" };
  try {
    await waitForDaemonEvent(() => daemonReadySince(journalPath, readyBaseline), exited, "daemon.ready");
    const daemon: IRunningDaemon = {
      until: (check, awaiting) => waitForDaemonEvent(check, exited, awaiting),
    };
    if (options.midFlight) await options.midFlight(daemon);
    if (options.waitForAfterInject) {
      await waitForDaemonEvent(options.waitForAfterInject, exited, "the expected journaled effect");
    }
  } finally {
    try {
      Deno.kill(proc.pid, "SIGTERM");
    } catch { /* already dead */ }
    exit = await exited;
  }
  return { pid: proc.pid, exit };
}
