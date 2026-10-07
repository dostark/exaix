#!/usr/bin/env -S deno run -A
/**
 * @module TestIsolation
 * @path scripts/test_isolation.ts
 * @description Host-side test-isolation tooling for the Batch-2 container path. It ensures
 *   the `dev-test` image exists, builds the worker-container launch, starts workers that run
 *   `scripts/test_container_driver.ts`, and dispatches files from a work-stealing queue.
 * Usage:
 *   Imported as a library by `scripts/test_parallel.ts` (Step 4). No standalone CLI yet.
 *   `ensureDevTestImage(image)` builds the image only when `docker image inspect` misses it.
 * @architectural-layer Tooling
 * @dependencies [@std/path, @std/streams, tests/scenario_framework/runner/matrix_expander.ts, scripts/test_parallel.ts, scripts/test_container_driver.ts]
 * @related-files [Dockerfile, .dockerignore, tests/scripts/test_isolation_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import { TextLineStream } from "@std/streams";
import type { Opt, Reason } from "@exaix/core/types";
import { buildJailLaunch, dockerProbeSkipReason } from "../tests/scenario_framework/runner/matrix_expander.ts";
import { trackChild, untrackChild } from "./test_parallel.ts";
import {
  type IContainerRunResult,
  TEST_CONTAINER_DONE_SENTINEL,
  TEST_CONTAINER_RESULT_PREFIX,
} from "./test_container_driver.ts";

/** Network mode for a worker container. */
export type TestContainerNetwork = "none" | "bridge";

/** Injectable seams for `ensureDevTestImage`. Every field defaults to the real docker call. */
export interface IEnsureDevTestImageOptions {
  /** True when the `docker` binary is on PATH. Defaults to the shared `dockerProbeSkipReason`. */
  dockerOnPath?: Opt<() => boolean, Reason.SensibleDefault>;
  /** True when `image` is present in the local image store. Defaults to `docker image inspect`. */
  imageExists?: Opt<(image: string) => Promise<boolean>, Reason.SensibleDefault>;
  /** Exit code of the image build. Defaults to `docker build --target dev-test`. */
  build?: Opt<(image: string) => Promise<number>, Reason.SensibleDefault>;
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

export interface IWorkerContainerLaunch {
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

/** One Batch-2 entry the scheduler consumes (a subset of the Step 3 classification). */
export interface IContainerTestEntry {
  file: string;
  /** true ⇒ at most one such file may be in flight across all workers. */
  serializedOutput?: boolean;
  /** true ⇒ run host-serial, never in a worker container. */
  network?: boolean;
  /** Internal retry counter: a wedged or exited worker requeues a file at most once. */
  attempts?: number;
}

/** Factory used to start a worker. injectable so the scheduler is testable without Docker. */
export type StartWorkerContainer = (
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

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");

const DOCKER_BIN = "docker";
const DOCKER_IMAGE_SUBCOMMAND = "image";
const DOCKER_INSPECT_SUBCOMMAND = "inspect";
const DOCKER_BUILD_SUBCOMMAND = "build";
const DOCKER_TARGET_FLAG = "--target";
const DEV_TEST_TARGET = "dev-test";
const DOCKER_TAG_FLAG = "-t";
const DOCKER_BUILD_CONTEXT = ".";
const DOCKER_KILL_SUBCOMMAND = "kill";
const DOCKER_RM_SUBCOMMAND = "rm";
const DOCKER_RM_FORCE_FLAG = "-f";

const DENO_JOBS_ENV = "DENO_JOBS";
const WORKER_MOUNT_DEST = "/workspaces/exaix";
/** The in-container driver the worker runs. */
export const TEST_CONTAINER_DRIVER_SCRIPT = "scripts/test_container_driver.ts";
/** Per-file inactivity watchdog. it resets on every dispatch and result, not worker lifetime. */
export const DEFAULT_TEST_CONTAINER_WATCHDOG_MS = 15 * 60 * 1000;
/** A wedged or exited worker requeues a file at most this many times before it is failed. */
const MAX_WORKER_RETRIES = 1;

/** True when `image` is present in the local docker image store. */
async function defaultImageExists(image: string): Promise<boolean> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, image],
    stdout: "null",
    stderr: "null",
  }).output();
  return out.success;
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
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return out.code;
}

/** Ensure the `dev-test` image exists, building it once when absent. It is a no-op when the
 *  `docker` binary is missing, so the caller falls back to the serial path. A failed build
 *  throws, so a broken image is never silently used. */
export async function ensureDevTestImage(
  image: string,
  options: Opt<IEnsureDevTestImageOptions, Reason.SensibleDefault> = {},
): Promise<void> {
  const dockerOnPath = options.dockerOnPath ?? (() => dockerProbeSkipReason() === null);
  if (!dockerOnPath()) return;

  const imageExists = options.imageExists ?? defaultImageExists;
  if (await imageExists(image)) return;

  const build = options.build ?? defaultBuildImage;
  const exitCode = await build(image);
  if (exitCode !== 0) {
    throw new Error(`dev-test image build failed with exit code ${exitCode}`);
  }
}

/** Build the worker-container `docker run` argv by reusing the hardened `buildJailLaunch`
 *  shape. The worker runs the driver with a piped stdin/stdout protocol. */
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
      extraEnv: { HOME: "/tmp/home", EXA_HOME: "/tmp/exa", DENO_DIR: "/deno-dir", ...env },
      network: options.network,
      pidsLimit: options.pidsLimit,
      memory: options.memory,
      cpus: options.cpus,
      containerName: options.workerName,
      image: options.image,
      init: true,
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
  let workerSeq = 0;

  const workerOptions = (): IWorkerContainerLaunchOptions => ({
    repoRoot: options.repoRoot,
    image: options.image,
    workerName: `exaix-test-worker-${workerSeq++}`,
    network: options.network,
    env: options.env,
    pidsLimit: options.pidsLimit,
    memory: options.memory,
    cpus: options.cpus,
    watchdogMs: options.watchdogMs,
  });

  const takeNext = (): IContainerTestEntry | undefined => {
    const index = queue.findIndex((entry) => !(entry.serializedOutput && serializedInFlight > 0));
    if (index === -1) return undefined;
    const entry = queue.splice(index, 1)[0];
    if (entry.serializedOutput) serializedInFlight++;
    return entry;
  };

  const releaseSerialized = (entry: IContainerTestEntry): void => {
    if (entry.serializedOutput) serializedInFlight--;
  };

  const runWorker = async (initial: IWorkerContainer): Promise<void> => {
    let worker = initial;
    while (true) {
      const entry = takeNext();
      if (!entry) return;
      await worker.send(entry.file);
      const outcome = await nextWithWatchdog(worker, options.watchdogMs);
      releaseSerialized(entry);
      if (outcome === "timeout") {
        await worker.kill();
        liveWorkers.delete(worker);
      }
      if (outcome === "timeout" || outcome === null) {
        // The worker wedged or exited mid-flight: requeue once, then mark the file failed.
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

  await Promise.all(
    [...liveWorkers].map((worker) => worker.send(TEST_CONTAINER_DONE_SENTINEL)),
  );

  return results;
}
