#!/usr/bin/env -S deno run -A
/**
 * @module TestIsolation
 * @path scripts/test_isolation.ts
 * @description Host-side test-isolation tooling for the Batch-2 container path. It ensures
 *   the `dev-test` image exists, builds the worker-container launch, starts workers that run
 *   `scripts/test_container_driver.ts`, and dispatches files from a work-stealing queue.
 * Usage:
 *   Imported as a library by `scripts/test_parallel.ts`. No standalone CLI yet.
 *   `ensureDevTestImage(image)` builds the image only when `docker image inspect` misses it.
 *   The build redirects buildx state to a temporary directory when the docker config is read-only.
 * @architectural-layer Tooling
 * @dependencies [@std/path, @std/streams, tests/scenario_framework/runner/matrix_expander.ts, scripts/test_parallel.ts, scripts/test_container_driver.ts]
 * @related-files [Dockerfile, .dockerignore, tests/scripts/test_isolation_test.ts]
 */

import { fromFileUrl, join, resolve } from "@std/path";
import { TextLineStream } from "@std/streams";
import type { Opt, Reason } from "@exaix/core/types";
import { buildJailLaunch, dockerProbeSkipReason } from "../tests/scenario_framework/runner/matrix_expander.ts";
import { trackChild, untrackChild } from "./test_parallel.ts";
import {
  type IContainerRunResult,
  isRepoRelativeTestFile,
  TEST_CONTAINER_DONE_SENTINEL,
  TEST_CONTAINER_RESULT_PREFIX,
} from "./test_container_driver.ts";

/** Network mode for a worker container. */
type TestContainerNetwork = "none" | "bridge";

/** Injectable seams for `ensureDevTestImage`. Every field defaults to the real docker call. */
interface IEnsureDevTestImageOptions {
  /** True when the `docker` binary is on PATH. Defaults to the shared `dockerProbeSkipReason`. */
  dockerOnPath?: Opt<() => boolean, Reason.SensibleDefault>;
  /** True when `image` is present in the local image store. Defaults to `docker image inspect`. */
  imageExists?: Opt<(image: string) => Promise<boolean>, Reason.SensibleDefault>;
  /** Exit code of the image build. Defaults to `docker build --target dev-test`. */
  build?: Opt<(image: string) => Promise<number>, Reason.SensibleDefault>;
  /** Creation time of `image`, or undefined when it cannot be read. Defaults to `docker image inspect`. */
  imageCreatedAt?: Opt<(image: string) => Promise<Date | undefined>, Reason.SensibleDefault>;
  /** Newest modification time among the image's build inputs. Defaults to the files in `DEV_TEST_BUILD_INPUTS`. */
  buildInputsModifiedAt?: Opt<() => Promise<Date>, Reason.SensibleDefault>;
}

/** One long-lived worker container: it runs the driver and pulls files one at a time. */
export interface IWorkerContainerLaunchOptions {
  repoRoot: string;
  image: string;
  /** Deterministic `docker --name` so a watchdog can `docker kill`/`docker rm -f` the worker. */
  workerName: string;
  /** "none" isolates ports. "bridge" is opt-in for egress/network tests. */
  network: TestContainerNetwork;
  /** Minimal env. It must never include `DENO_JOBS` (the Batch-2 skipInParallel contract). */
  env: Record<string, string>;
  /** Resource bounds mirrored from `compose.sandbox.yaml`. */
  pidsLimit: number;
  memory: string;
  cpus: string;
  /** Per-file inactivity watchdog. the per-file timeout is enforced inside the driver. */
  watchdogMs: number;
}

interface IWorkerContainerLaunch {
  bin: "docker";
  args: string[];
}

/** A running worker the host dispatches to. */
export interface IWorkerContainer {
  name: string;
  /** Write the next repo-relative test file, or the DONE sentinel, to the driver's stdin. */
  send(file: string): Promise<void>;
  /** Resolve with the next per-file result, or null when the worker exits. */
  next(): Promise<IContainerRunResult | null>;
  /** Kill the container by name and reap it. */
  kill(): Promise<void>;
}

/** One Batch-2 entry the scheduler consumes (a subset of the classification). */
export interface IContainerTestEntry {
  file: string;
  /** true ⇒ at most one such file may be in flight across all workers. */
  serializedOutput?: boolean;
  /** true ⇒ this file runs alone, and no other entry is in flight while it runs. */
  exclusive?: boolean;
  /** true ⇒ run host-serial, never in a worker container. */
  network?: boolean;
  /** Internal retry counter: a wedged or exited worker requeues a file at most once. */
  attempts?: number;
}

/** Factory used to start a worker. injectable so the scheduler is testable without Docker. */
type StartWorkerContainer = (
  options: IWorkerContainerLaunchOptions,
) => IWorkerContainer | Promise<IWorkerContainer>;

/** Options for `runBatch2InContainers`. */
export interface IRunBatch2Options {
  repoRoot: string;
  image: string;
  jobs: number;
  env: Record<string, string>;
  network: TestContainerNetwork;
  pidsLimit: number;
  memory: string;
  cpus: string;
  watchdogMs: number;
  /** Injectable worker factory. defaults to the real `startWorkerContainer`. */
  startWorker?: Opt<StartWorkerContainer, Reason.OptionalInput>;
}

/** Batch-2 execution mode. */
type Batch2Mode = "container" | "serial";

/** The chosen Batch-2 strategy plus a one-line reason for the log. */
interface IBatch2Strategy {
  mode: Batch2Mode;
  jobs: number;
  reason: string;
}

/** CLI overrides for the strategy. The CLI flag wins over the env var. */
interface IStrategyOverrides {
  /** Worker-container count from `--test-container-jobs` (already validated positive). */
  jobs?: Opt<number, Reason.OptionalInput>;
  /** true when `--test-serial` requests the serial path explicitly. */
  serial?: Opt<boolean, Reason.OptionalInput>;
}

/** Async probe: true when the docker daemon is reachable. */
type IContainerRuntimeProbe = () => Promise<boolean>;

/** Resource bounds applied to each worker container. */
interface IContainerResourceBounds {
  pidsLimit: number;
  memory: string;
  cpus: string;
}

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");

const DOCKER_BIN = "docker";
const DOCKER_IMAGE_SUBCOMMAND = "image";
const DOCKER_INSPECT_SUBCOMMAND = "inspect";
const DOCKER_BUILD_SUBCOMMAND = "build";
const DOCKER_TARGET_FLAG = "--target";
const DEV_TEST_TARGET = "dev-test";
const DOCKER_HOME_DIR = ".docker";
const DOCKER_BUILDX_STATE_DIR = "buildx";
const DOCKER_CONFIG_FILE = "config.json";
const DOCKER_BUILDX_FALLBACK_PREFIX = "exaix-buildx-";
const DOCKER_TAG_FLAG = "-t";
const DOCKER_BUILD_CONTEXT = ".";
const DOCKER_KILL_SUBCOMMAND = "kill";
const DOCKER_RM_SUBCOMMAND = "rm";
const DOCKER_RM_FORCE_FLAG = "-f";
const DOCKER_FORMAT_FLAG = "--format";
const DOCKER_CREATED_TEMPLATE = "{{.Created}}";

const DENO_JOBS_ENV = "DENO_JOBS";
const WORKER_MOUNT_DEST = "/workspaces/exaix";
/** The in-container driver the worker runs. */
const TEST_CONTAINER_DRIVER_SCRIPT = "scripts/test_container_driver.ts";
/** Per-file inactivity watchdog. it resets on every dispatch and result, not worker lifetime. */
export const DEFAULT_TEST_CONTAINER_WATCHDOG_MS = 15 * 60 * 1000;
/** A wedged or exited worker requeues a file at most this many times before it is failed. */
const MAX_WORKER_RETRIES = 1;
/** Docker `--memory` size syntax: a number with an optional b/k/m/g suffix. */
const DOCKER_MEMORY_PATTERN = /^\d+(?:\.\d+)?(?:[bkmg]b?)?$/i;
/** Docker `--cpus` value: a positive decimal number. */
const DOCKER_CPUS_PATTERN = /^\d+(?:\.\d+)?$/;

export const DEFAULT_TEST_CONTAINER_IMAGE = "exaix-dev-test:dev";
export const TEST_CONTAINER_IMAGE_ENV = "EXA_TEST_CONTAINER_IMAGE";
const TEST_CONTAINER_JOBS_ENV = "EXA_TEST_CONTAINER_JOBS";
const TEST_CONTAINERS_ENABLED_ENV = "EXA_TEST_CONTAINERS";
export const MIN_TEST_CONTAINER_JOBS = 1;
/** Default workers when no flag or env override is set. Four keeps the daemon/port tests in the
 *  Containered Batch from flaking under CPU contention (six was observed to). */
export const DEFAULT_TEST_CONTAINER_JOBS = 4;
export const DEFAULT_TEST_CONTAINER_NETWORK: TestContainerNetwork = "none";
export const DEFAULT_TEST_CONTAINER_PIDS_LIMIT = 512;
const TEST_CONTAINER_PIDS_LIMIT_ENV = "EXA_TEST_CONTAINER_PIDS_LIMIT";
export const DEFAULT_TEST_CONTAINER_MEMORY = "2g";
const TEST_CONTAINER_MEMORY_ENV = "EXA_TEST_CONTAINER_MEMORY";
export const DEFAULT_TEST_CONTAINER_CPUS = "2.0";
const TEST_CONTAINER_CPUS_ENV = "EXA_TEST_CONTAINER_CPUS";
/** Disable IPv6 in the worker so `localhost` resolves to IPv4. The host binds 127.0.0.1,
 *  but a container with IPv6 binds ::1, so a server and its client would disagree. */
const WORKER_CONTAINER_SYSCTLS: readonly string[] = ["net.ipv6.conf.all.disable_ipv6=1"];

/** True when `image` is present in the local docker image store. */
async function defaultImageExists(image: string): Promise<boolean> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, image],
    stdout: "null",
    stderr: "null",
  }).output();
  return out.success;
}

/** Files whose change makes a built `dev-test` image stale: the Dockerfile, its context filter, and the dependency pins it warms. */
const DEV_TEST_BUILD_INPUTS: readonly string[] = ["Dockerfile", ".dockerignore", "deno.json", "deno.lock"];

/** Parses a `docker image inspect` timestamp. Docker prints nanoseconds, which `Date.parse` rejects, so the fraction is cut to milliseconds. */
export function parseDockerTimestamp(raw: string): Date | undefined {
  const time = Date.parse(raw.trim().replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(time) ? undefined : new Date(time);
}

/** The image's creation time from `docker image inspect`, or undefined when it cannot be read. */
async function defaultImageCreatedAt(image: string): Promise<Date | undefined> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, DOCKER_FORMAT_FLAG, DOCKER_CREATED_TEMPLATE, image],
    stdout: "piped",
    stderr: "null",
  }).output();
  return out.success ? parseDockerTimestamp(new TextDecoder().decode(out.stdout)) : undefined;
}

/** The newest modification time among `DEV_TEST_BUILD_INPUTS`, read from the repo root. */
async function defaultBuildInputsModifiedAt(): Promise<Date> {
  let newest = 0;
  for (const name of DEV_TEST_BUILD_INPUTS) {
    const info = await Deno.stat(join(REPO_ROOT, name));
    newest = Math.max(newest, info.mtime?.getTime() ?? 0);
  }
  return new Date(newest);
}

/** The docker config directory the CLI would use, or null when no home is known. */
function dockerConfigDir(env: Readonly<Record<string, string>>): string | null {
  if (env.DOCKER_CONFIG !== undefined && env.DOCKER_CONFIG.length > 0) return env.DOCKER_CONFIG;
  const home = env.HOME;
  return home === undefined || home.length === 0 ? null : join(home, DOCKER_HOME_DIR);
}

/** Resolve a docker build environment whose buildx state can be written. */
export function resolveDockerBuildEnv(
  env: Readonly<Record<string, string>>,
  writable: (dir: string) => boolean,
  makeFallbackDir: () => string,
): Record<string, string> {
  const resolved = { ...env };
  if (env.BUILDX_CONFIG !== undefined) return resolved;
  const configDir = dockerConfigDir(env);
  if (configDir !== null && writable(join(configDir, DOCKER_BUILDX_STATE_DIR))) return resolved;
  const fallback = makeFallbackDir();
  resolved.DOCKER_CONFIG = fallback;
  resolved.BUILDX_CONFIG = fallback;
  return resolved;
}

/** True when the directory can be created and a file written inside it. */
function isWritableDirectory(dir: string): boolean {
  try {
    Deno.mkdirSync(dir, { recursive: true });
    const probe = Deno.makeTempFileSync({ dir });
    Deno.removeSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Copy the readable docker config into the fallback directory so registry auth still resolves. */
function copyDockerConfig(source: Readonly<Record<string, string>>, target: string): void {
  const sourceDir = dockerConfigDir(source);
  if (sourceDir === null) return;
  try {
    const text = Deno.readTextFileSync(join(sourceDir, DOCKER_CONFIG_FILE));
    Deno.writeTextFileSync(join(target, DOCKER_CONFIG_FILE), text);
  } catch {
    // No readable config: the build only needs public images.
  }
}

/** The environment for the image build: a writable buildx state when the docker config is read-only. */
function dockerBuildEnv(): Record<string, string> {
  const original = Deno.env.toObject();
  const resolved = resolveDockerBuildEnv(
    original,
    isWritableDirectory,
    () => Deno.makeTempDirSync({ prefix: DOCKER_BUILDX_FALLBACK_PREFIX }),
  );
  if (resolved.DOCKER_CONFIG !== original.DOCKER_CONFIG && resolved.DOCKER_CONFIG !== undefined) {
    copyDockerConfig(original, resolved.DOCKER_CONFIG);
  }
  return resolved;
}

/** Builds the `dev-test` image from the repo root and returns the process exit code. */
async function defaultBuildImage(image: string): Promise<number> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [
      DOCKER_BUILD_SUBCOMMAND,
      DOCKER_TARGET_FLAG,
      DEV_TEST_TARGET,
      DOCKER_TAG_FLAG,
      image,
      DOCKER_BUILD_CONTEXT,
    ],
    cwd: REPO_ROOT,
    env: dockerBuildEnv(),
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return out.code;
}

/** Ensure the `dev-test` image exists and is not older than its build inputs.
 *  It builds the image when it is absent or stale. It is a no-op when the `docker` binary is missing,
 *  so the caller falls back to the serial path. A failed build throws, so a broken image is never used. */
export async function ensureDevTestImage(
  image: string,
  options: Opt<IEnsureDevTestImageOptions, Reason.SensibleDefault> = {},
): Promise<void> {
  const dockerOnPath = options.dockerOnPath ?? (() => dockerProbeSkipReason() === null);
  if (!dockerOnPath()) return;

  const imageExists = options.imageExists ?? defaultImageExists;
  if (await imageExists(image)) {
    const createdAt = await (options.imageCreatedAt ?? defaultImageCreatedAt)(image);
    const inputsModifiedAt = await (options.buildInputsModifiedAt ?? defaultBuildInputsModifiedAt)();
    // An unreadable creation time keeps the image: a guess should not trigger a rebuild.
    if (createdAt === undefined || createdAt >= inputsModifiedAt) return;
    console.log(`› ${image} is older than ${DEV_TEST_BUILD_INPUTS.join(", ")}; rebuilding it.`);
  }

  const build = options.build ?? defaultBuildImage;
  const exitCode = await build(image);
  if (exitCode !== 0) {
    throw new Error(`dev-test image build failed with exit code ${exitCode}`);
  }
}

/** Default docker probe: true when the binary is on PATH and `docker info` succeeds. */
export async function dockerDaemonReachable(): Promise<boolean> {
  if (dockerProbeSkipReason() !== null) return false;
  try {
    const out = await new Deno.Command(DOCKER_BIN, {
      args: ["info"],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

/** True when worker-container mode is explicitly enabled (`EXA_TEST_CONTAINERS=1`). The
 *  Docker-backed integration tests are opt-in, so a plain suite never builds the worker image. */
export function isContainerModeEnabled(env: Record<string, string | undefined>): boolean {
  return env[TEST_CONTAINERS_ENABLED_ENV] === "1";
}

/** Resolve the worker count and its source, clamped to the minimum and hardware concurrency. */
function resolveWorkerCount(
  env: Record<string, string | undefined>,
  overrides: IStrategyOverrides,
): { jobs: number; source: string } {
  let requested = DEFAULT_TEST_CONTAINER_JOBS;
  let source = "default";
  if (overrides.jobs !== undefined) {
    requested = overrides.jobs;
    source = "flag";
  } else {
    const envValue = env[TEST_CONTAINER_JOBS_ENV];
    const parsed = envValue !== undefined ? Number(envValue) : Number.NaN;
    if (Number.isFinite(parsed)) {
      requested = parsed;
      source = "env";
    }
  }
  const ceiling = navigator.hardwareConcurrency;
  const jobs = Math.min(Math.max(Math.floor(requested), MIN_TEST_CONTAINER_JOBS), ceiling);
  return { jobs, source };
}

/** Choose the Batch-2 execution strategy from the environment and runtime probes. Container
 *  mode is the default. `--test-serial` or `EXA_TEST_CONTAINERS=0` opts out. An unreachable
 *  Docker daemon falls back to serial. */
export async function selectBatch2Strategy(
  env: Record<string, string | undefined>,
  probeDocker: IContainerRuntimeProbe = dockerDaemonReachable,
  overrides: IStrategyOverrides = {},
): Promise<IBatch2Strategy> {
  if (overrides.serial) {
    return { mode: "serial", jobs: DEFAULT_TEST_CONTAINER_JOBS, reason: "serial mode requested (--test-serial)" };
  }
  if (env[TEST_CONTAINERS_ENABLED_ENV] === "0") {
    return { mode: "serial", jobs: DEFAULT_TEST_CONTAINER_JOBS, reason: "EXA_TEST_CONTAINERS=0" };
  }
  if (!(await probeDocker())) {
    return { mode: "serial", jobs: DEFAULT_TEST_CONTAINER_JOBS, reason: "docker binary or daemon is unavailable" };
  }
  const { jobs, source } = resolveWorkerCount(env, overrides);
  return { mode: "container", jobs, reason: `container mode with ${jobs} workers (${source})` };
}

/** Resolve worker-container resource bounds from `EXA_TEST_CONTAINER_*`. Each unset or invalid
 *  value falls back to its named default, so a bad override never breaks the run. */
export function resolveContainerResourceBounds(
  env: Record<string, string | undefined>,
): IContainerResourceBounds {
  const rawPids = env[TEST_CONTAINER_PIDS_LIMIT_ENV];
  const parsedPids = rawPids !== undefined ? Number(rawPids) : Number.NaN;
  const pidsLimit = Number.isInteger(parsedPids) && parsedPids > 0 ? parsedPids : DEFAULT_TEST_CONTAINER_PIDS_LIMIT;
  const rawMemory = env[TEST_CONTAINER_MEMORY_ENV];
  const memory = rawMemory !== undefined && DOCKER_MEMORY_PATTERN.test(rawMemory)
    ? rawMemory
    : DEFAULT_TEST_CONTAINER_MEMORY;
  const rawCpus = env[TEST_CONTAINER_CPUS_ENV];
  const cpus = rawCpus !== undefined && DOCKER_CPUS_PATTERN.test(rawCpus) && Number(rawCpus) > 0
    ? rawCpus
    : DEFAULT_TEST_CONTAINER_CPUS;
  return { pidsLimit, memory, cpus };
}

const GIT_ENTRY = ".git";
const GIT_POINTER_PREFIX = "gitdir:";
const GIT_COMMON_DIR_FILE = "commondir";

/** The read-only mount that lets `git` run in a worker container on a linked worktree. */
export function linkedWorktreeGitMounts(repoRoot: string): string[] {
  try {
    const pointer = Deno.readTextFileSync(join(repoRoot, GIT_ENTRY)).trim();
    if (!pointer.startsWith(GIT_POINTER_PREFIX)) return [];
    const gitDir = resolve(repoRoot, pointer.slice(GIT_POINTER_PREFIX.length).trim());
    const commonDir = resolve(gitDir, Deno.readTextFileSync(join(gitDir, GIT_COMMON_DIR_FILE)).trim());
    return [`type=bind,src=${commonDir},dst=${commonDir},readonly`];
  } catch {
    // A normal checkout has a .git directory, and a bare directory has none: neither needs a mount.
    return [];
  }
}

/** Build the worker-container `docker run` argv by reusing the hardened `buildJailLaunch`
 *  shape. It passes no `--init`, because the image entrypoint already runs tini as PID 1.
 *  The worker runs the driver with a piped stdin/stdout protocol. */
export function buildWorkerContainerLaunch(options: IWorkerContainerLaunchOptions): IWorkerContainerLaunch {
  const env = Object.fromEntries(
    Object.entries(options.env).filter(([key]) => key !== DENO_JOBS_ENV),
  );
  const launch = buildJailLaunch(
    { bin: "deno", args: ["run", "--allow-all", TEST_CONTAINER_DRIVER_SCRIPT] },
    {
      mountSource: options.repoRoot,
      mountDest: WORKER_MOUNT_DEST,
      workdir: WORKER_MOUNT_DEST,
      extraMounts: linkedWorktreeGitMounts(options.repoRoot),
      extraEnv: { HOME: "/tmp/home", EXA_HOME: "/tmp/exa", DENO_DIR: "/deno-dir", ...env },
      network: options.network,
      pidsLimit: options.pidsLimit,
      memory: options.memory,
      cpus: options.cpus,
      sysctls: [...WORKER_CONTAINER_SYSCTLS],
      containerName: options.workerName,
      image: options.image,
      interactive: true,
    },
  );
  return { bin: DOCKER_BIN, args: launch.args };
}

/** Parse one driver stdout line. null for any line that is not a result. */
export function parseWorkerResultLine(line: string): IContainerRunResult | null {
  if (!line.startsWith(TEST_CONTAINER_RESULT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(line.slice(TEST_CONTAINER_RESULT_PREFIX.length));
    if (parsed && typeof parsed.testFile === "string") return parsed as IContainerRunResult;
  } catch {
    // malformed result line — ignore
  }
  return null;
}

/** Start one worker container and expose the stdin/stdout protocol. */
export function startWorkerContainer(options: IWorkerContainerLaunchOptions): IWorkerContainer {
  const launch = buildWorkerContainerLaunch(options);
  const child = new Deno.Command(launch.bin, {
    args: launch.args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();
  trackChild(child.pid);

  const encoder = new TextEncoder();
  const writer = child.stdin.getWriter();

  // Drain stderr continuously, or a full pipe would block the worker.
  child.stderr
    .pipeTo(
      new WritableStream({
        write(chunk) {
          try {
            Deno.stderr.writeSync(chunk);
          } catch {
            // terminal fd gone — ignore
          }
        },
      }),
    )
    .catch(() => {});

  const queue: IContainerRunResult[] = [];
  let resolveNext: (() => void) | undefined;
  let closed = false;
  const signal = () => {
    resolveNext?.();
    resolveNext = undefined;
  };

  (async () => {
    const lines = child.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream());
    for await (const line of lines) {
      const result = parseWorkerResultLine(line);
      if (result) {
        queue.push(result);
        signal();
      }
    }
  })()
    .catch(() => {})
    .finally(() => {
      closed = true;
      signal();
    });

  return {
    name: options.workerName,
    async send(file: string): Promise<void> {
      await writer.write(encoder.encode(`${file}\n`));
    },
    async next(): Promise<IContainerRunResult | null> {
      while (queue.length === 0 && !closed) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
      return queue.length > 0 ? queue.shift()! : null;
    },
    async kill(): Promise<void> {
      await runDockerQuiet([DOCKER_KILL_SUBCOMMAND, options.workerName]);
      await runDockerQuiet([DOCKER_RM_SUBCOMMAND, DOCKER_RM_FORCE_FLAG, options.workerName]);
      untrackChild(child.pid);
    },
  };
}

/** Run a docker subcommand, ignoring its exit status. */
async function runDockerQuiet(args: string[]): Promise<void> {
  try {
    await new Deno.Command(DOCKER_BIN, { args, stdout: "null", stderr: "null" }).output();
  } catch {
    // docker gone or container already removed — ignore
  }
}

/** Await `worker.next()` but kill the worker when the per-file inactivity watchdog elapses. */
async function nextWithWatchdog(
  worker: IWorkerContainer,
  watchdogMs: number,
): Promise<IContainerRunResult | null | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), watchdogMs);
  });
  try {
    return await Promise.race([worker.next(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run the non-network Batch-2 entries in `jobs` worker containers with a work-stealing queue.
 *  It never blocks on an idle worker. It never runs two `serializedOutput` files at once.
 *  It requeues an in-flight file when a worker exits, and stops when the queue drains. */
export async function runBatch2InContainers(
  entries: readonly IContainerTestEntry[],
  options: IRunBatch2Options,
): Promise<IContainerRunResult[]> {
  const queue: IContainerTestEntry[] = entries.filter((entry) => !entry.network).map((entry) => ({ ...entry }));
  const results: IContainerRunResult[] = [];
  const startWorker = options.startWorker ?? startWorkerContainer;
  const liveWorkers = new Set<IWorkerContainer>();
  let serializedInFlight = 0;
  let inFlight = 0;
  let exclusiveInFlight = 0;
  let slotWaiters: Array<() => void> = [];
  let workerSeq = 0;
  // A per-run token keeps worker names unique across runs. Two suites must not collide.
  // The name stays deterministic for the watchdog kill.
  const runToken = crypto.randomUUID().slice(0, 8);

  const workerOptions = (): IWorkerContainerLaunchOptions => ({
    repoRoot: options.repoRoot,
    image: options.image,
    workerName: `exaix-test-worker-${runToken}-${workerSeq++}`,
    network: options.network,
    env: options.env,
    pidsLimit: options.pidsLimit,
    memory: options.memory,
    cpus: options.cpus,
    watchdogMs: options.watchdogMs,
  });

  const notifySlot = (): void => {
    const waiters = slotWaiters;
    slotWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const waitForSlot = (): Promise<void> => new Promise((resolve) => slotWaiters.push(resolve));

  const takeNext = (): IContainerTestEntry | undefined => {
    if (exclusiveInFlight > 0) return undefined;
    const index = queue.findIndex((entry) =>
      !(entry.exclusive && inFlight > 0) &&
      !(entry.serializedOutput && serializedInFlight > 0)
    );
    if (index === -1) return undefined;
    const entry = queue.splice(index, 1)[0];
    inFlight++;
    if (entry.serializedOutput) serializedInFlight++;
    if (entry.exclusive) exclusiveInFlight++;
    return entry;
  };

  const release = (entry: IContainerTestEntry): void => {
    inFlight--;
    if (entry.serializedOutput) serializedInFlight--;
    if (entry.exclusive) exclusiveInFlight--;
    notifySlot();
  };

  const retire = async (worker: IWorkerContainer): Promise<void> => {
    liveWorkers.delete(worker);
    try {
      await worker.kill();
    } catch {
      // The worker already exited, or docker is gone, so nothing is left to reap.
    }
  };

  const runWorker = async (initial: IWorkerContainer): Promise<void> => {
    let worker = initial;
    while (true) {
      const entry = takeNext();
      if (!entry) {
        if (queue.length === 0) return;
        await waitForSlot();
        continue;
      }
      if (!isRepoRelativeTestFile(entry.file, options.repoRoot)) {
        release(entry);
        results.push({
          testFile: entry.file,
          passed: 0,
          failed: 1,
          ignored: 0,
          durationSec: 0,
          exitCode: 1,
          failureDetail: "invalid test file path",
        });
        continue;
      }
      let outcome: IContainerRunResult | null | "timeout" = null;
      try {
        await worker.send(entry.file);
        outcome = await nextWithWatchdog(worker, options.watchdogMs);
      } catch {
        // A closed stdin pipe means the worker exited before this file dispatched.
        outcome = null;
      }
      release(entry);
      if (outcome === "timeout" || outcome === null) {
        // The worker wedged or exited mid-flight, so retire it and requeue once.
        await retire(worker);
        const attempts = (entry.attempts ?? 0) + 1;
        if (attempts <= MAX_WORKER_RETRIES) {
          queue.unshift({ ...entry, attempts });
        } else {
          results.push({
            testFile: entry.file,
            passed: 0,
            failed: 1,
            ignored: 0,
            durationSec: 0,
            exitCode: 1,
            failureDetail: outcome === "timeout" ? "timeout" : "worker exited",
          });
        }
        if (queue.length === 0) return;
        worker = await startWorker(workerOptions());
        liveWorkers.add(worker);
        continue;
      }
      results.push(outcome);
    }
  };

  const initialWorkers = await Promise.all(
    Array.from({ length: Math.max(1, options.jobs) }, async () => {
      const worker = await startWorker(workerOptions());
      liveWorkers.add(worker);
      return worker;
    }),
  );

  await Promise.all(initialWorkers.map((worker) => runWorker(worker)));

  await Promise.allSettled(
    [...liveWorkers].map((worker) => worker.send(TEST_CONTAINER_DONE_SENTINEL)),
  );

  return results;
}
