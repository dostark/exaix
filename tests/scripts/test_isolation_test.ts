/**
 * @module TestIsolationTest
 * @path tests/scripts/test_isolation_test.ts
 * @description Verifies the dev-test image provider (`ensureDevTestImage`) and the
 *   `dev-test` Dockerfile stage / `.dockerignore` build-context contract.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  buildWorkerContainerLaunch,
  type IContainerTestEntry,
  type IRunBatch2Options,
  type IWorkerContainer,
  parseWorkerResultLine,
  runBatch2InContainers,
} from "../../scripts/test_isolation.ts";
import { killActiveChildGroups, trackChild, untrackChild } from "../../scripts/test_parallel.ts";
import { type IContainerRunResult, TEST_CONTAINER_RESULT_PREFIX } from "../../scripts/test_container_driver.ts";
import { ensureDevTestImage } from "../../scripts/test_isolation.ts";

const DOCKERFILE = await Deno.readTextFile(new URL("../../Dockerfile", import.meta.url));
const DOCKERIGNORE = await Deno.readTextFile(new URL("../../.dockerignore", import.meta.url));

/** The `dev-test` stage block: from its `FROM … AS dev-test` line to the next `FROM`. */
function devTestStage(dockerfile: string): string {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => line.includes("AS dev-test"));
  if (start === -1) throw new Error("no `AS dev-test` stage in Dockerfile");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("FROM "));
  return lines.slice(start, end === -1 ? undefined : start + 1 + end).join("\n");
}

Deno.test("dev-test image provider builds only when the image is absent", async () => {
  let builtWhenAbsent = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(false),
    build: () => {
      builtWhenAbsent++;
      return Promise.resolve(0);
    },
  });
  assertEquals(builtWhenAbsent, 1);

  let builtWhenPresent = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(true),
    build: () => {
      builtWhenPresent++;
      return Promise.resolve(0);
    },
  });
  assertEquals(builtWhenPresent, 0);
});

Deno.test("ensureDevTestImage surfaces a build failure", async () => {
  await assertRejects(
    () =>
      ensureDevTestImage("exaix-dev-test:test", {
        dockerOnPath: () => true,
        imageExists: () => Promise.resolve(false),
        build: () => Promise.resolve(1),
      }),
    Error,
    "dev-test image build failed",
  );
});

Deno.test("ensureDevTestImage is a no-op when the docker binary is absent", async () => {
  let probed = false;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => false,
    imageExists: () => {
      probed = true;
      return Promise.resolve(false);
    },
  });
  assertEquals(probed, false);
});

Deno.test("dev-test stage inherits builder and adds git without reinstalling the delegate CLIs", () => {
  const stage = devTestStage(DOCKERFILE);
  assert(stage.startsWith("FROM builder AS dev-test"), stage);
  assert(stage.includes("git"), "the dev-test stage installs git");
  assert(!stage.includes("npm install -g"), "the dev-test stage must not reinstall the delegate CLIs");
});

Deno.test("the dev-test stage installs procps so pkill is available to the driver", () => {
  assert(devTestStage(DOCKERFILE).includes("procps"), "dev-test installs procps");
});

Deno.test("the dev-test stage makes /deno-dir writable for an arbitrary uid", () => {
  assert(
    devTestStage(DOCKERFILE).includes("chmod -R a+rwX /deno-dir"),
    "dev-test makes /deno-dir uid-writable",
  );
});

Deno.test("the dev-test stage copies scripts/ and caches the driver entrypoint, not the whole scripts/ tree", () => {
  const stage = devTestStage(DOCKERFILE);
  assert(stage.includes("COPY scripts/ scripts/"), "dev-test copies scripts/");
  assert(stage.includes("scripts/test_container_driver.ts"), "dev-test caches the driver entrypoint");
});

Deno.test("the build context un-excludes tests/ for the dev-test image", () => {
  assert(
    DOCKERIGNORE.split("\n").includes("!tests/"),
    ".dockerignore un-excludes tests/ for the dev-test image",
  );
});

// --- Step 2: worker-container launcher and host scheduler ---

function baseRunOptions(startWorker: IRunBatch2Options["startWorker"]): IRunBatch2Options {
  return {
    repoRoot: "/repo",
    image: "exaix-dev-test:dev",
    jobs: 2,
    env: {},
    network: "none",
    pidsLimit: 512,
    memory: "2g",
    cpus: "2.0",
    watchdogMs: 60_000,
    startWorker,
  };
}

function resultFor(file: string, exitCode = 0): IContainerRunResult {
  return { testFile: file, passed: 1, failed: 0, ignored: 0, durationSec: 0, exitCode, failureDetail: null };
}

interface IFakeWorker extends IWorkerContainer {
  sent: string[];
}

function makeFakeWorker(name: string, resolve: (file: string) => IContainerRunResult | null): IFakeWorker {
  const pending: string[] = [];
  const sent: string[] = [];
  return {
    name,
    sent,
    send(file: string): Promise<void> {
      sent.push(file);
      pending.push(file);
      return Promise.resolve();
    },
    next(): Promise<IContainerRunResult | null> {
      const file = pending.shift();
      return Promise.resolve(file === undefined ? null : resolve(file));
    },
    kill(): Promise<void> {
      return Promise.resolve();
    },
  };
}

Deno.test("buildWorkerContainerLaunch isolates HOME, EXA_HOME and DENO_DIR, defaults to --network none, passes --init, and never forwards DENO_JOBS", () => {
  const launch = buildWorkerContainerLaunch({
    repoRoot: "/repo",
    image: "exaix-dev-test:dev",
    workerName: "exaix-test-worker-0",
    network: "none",
    env: { PATH: "/usr/bin", DENO_JOBS: "8" },
    pidsLimit: 512,
    memory: "2g",
    cpus: "2.0",
    watchdogMs: 60_000,
  });
  const joined = launch.args.join(" ");
  assert(launch.args.includes("--init"), "--init present");
  assert(launch.args.includes("-i"), "-i present");
  assert(joined.includes("--name exaix-test-worker-0"), "--name present");
  assert(joined.includes("HOME=/tmp/home"), "HOME isolated");
  assert(joined.includes("EXA_HOME=/tmp/exa"), "EXA_HOME isolated");
  assert(joined.includes("DENO_DIR=/deno-dir"), "DENO_DIR isolated");
  assert(joined.includes("--network none"), "network none by default");
  assert(joined.includes("--pids-limit 512"), "pids-limit wired");
  assert(!joined.includes("DENO_JOBS"), "DENO_JOBS must never be forwarded");
  assert(joined.includes("scripts/test_container_driver.ts"), "runs the driver");
});

Deno.test("parseWorkerResultLine parses a result line and ignores non-prefixed or malformed stdout", () => {
  const result = resultFor("a_test.ts");
  assertEquals(parseWorkerResultLine(`${TEST_CONTAINER_RESULT_PREFIX}${JSON.stringify(result)}`), result);
  assertEquals(parseWorkerResultLine("plain test output"), null);
  assertEquals(parseWorkerResultLine(`${TEST_CONTAINER_RESULT_PREFIX}not json`), null);
});

Deno.test("runBatch2InContainers starts exactly jobs workers and dispatches every non-network file", async () => {
  let started = 0;
  const options = baseRunOptions(() => {
    started++;
    return makeFakeWorker(`w${started}`, (file) => resultFor(file));
  });
  const entries: IContainerTestEntry[] = [{ file: "a_test.ts" }, { file: "b_test.ts" }, { file: "c_test.ts" }];
  const results = await runBatch2InContainers(entries, options);
  assertEquals(started, 2);
  assertEquals(results.map((r) => r.testFile).sort(), ["a_test.ts", "b_test.ts", "c_test.ts"]);
});

Deno.test("runBatch2InContainers skips network-flagged entries", async () => {
  const options = baseRunOptions(() => makeFakeWorker("w", (file) => resultFor(file)));
  const entries: IContainerTestEntry[] = [{ file: "a_test.ts" }, { file: "live_test.ts", network: true }];
  const results = await runBatch2InContainers(entries, options);
  assertEquals(results.map((r) => r.testFile), ["a_test.ts"]);
});

Deno.test("runBatch2InContainers requeues an in-flight file when a worker exits, then terminates", async () => {
  let started = 0;
  const seen: Record<string, number> = {};
  const options = baseRunOptions(() => {
    started++;
    return makeFakeWorker(`w${started}`, (file) => {
      seen[file] = (seen[file] ?? 0) + 1;
      return file === "a_test.ts" && seen[file] === 1 ? null : resultFor(file);
    });
  });
  const results = await runBatch2InContainers([{ file: "a_test.ts" }], options);
  assertEquals(results.map((r) => r.testFile), ["a_test.ts"]);
  assert(started >= 2, "a replacement worker was started");
});

Deno.test("runBatch2InContainers never runs two serializedOutput files concurrently", async () => {
  let serializedActive = 0;
  let maxSerialized = 0;
  const serializedFiles = new Set(["s1_test.ts", "s2_test.ts"]);
  const options = baseRunOptions(undefined);
  options.startWorker = () => {
    const worker = makeFakeWorker("w", (file) => resultFor(file));
    let lastFile = "";
    return {
      name: worker.name,
      async send(file: string) {
        lastFile = file;
        if (serializedFiles.has(file)) {
          serializedActive++;
          maxSerialized = Math.max(maxSerialized, serializedActive);
        }
        await worker.send(file);
      },
      async next() {
        const result = await worker.next();
        if (serializedFiles.has(lastFile)) serializedActive--;
        return result;
      },
      async kill() {
        await worker.kill();
      },
    };
  };
  await runBatch2InContainers(
    [
      { file: "s1_test.ts", serializedOutput: true },
      { file: "s2_test.ts", serializedOutput: true },
      { file: "n_test.ts" },
    ],
    options,
  );
  assert(maxSerialized <= 1, `at most one serializedOutput in flight, saw ${maxSerialized}`);
});

Deno.test("a worker running several files under the per-file timeout is not killed by the inactivity watchdog", async () => {
  let killed = 0;
  const options = baseRunOptions(undefined);
  options.jobs = 1;
  options.watchdogMs = 1000;
  options.startWorker = () => {
    const worker = makeFakeWorker("w", (file) => resultFor(file));
    return {
      name: worker.name,
      send: (file: string) => worker.send(file),
      next: () => worker.next(),
      kill: async () => {
        killed++;
        await worker.kill();
      },
    };
  };
  const results = await runBatch2InContainers(
    [{ file: "a_test.ts" }, { file: "b_test.ts" }, { file: "c_test.ts" }],
    options,
  );
  assertEquals(results.length, 3);
  assertEquals(killed, 0);
});

Deno.test("a wedged worker is killed by name and its in-flight file is marked failed, then replaced", async () => {
  let started = 0;
  let killed = 0;
  const options = baseRunOptions(undefined);
  options.jobs = 1;
  options.watchdogMs = 5;
  options.startWorker = () => {
    started++;
    return {
      name: `w${started}`,
      send(): Promise<void> {
        return Promise.resolve();
      },
      next(): Promise<IContainerRunResult | null> {
        return new Promise<IContainerRunResult | null>(() => {});
      },
      kill(): Promise<void> {
        killed++;
        return Promise.resolve();
      },
    };
  };
  const results = await runBatch2InContainers([{ file: "wedged_test.ts" }], options);
  assertEquals(results.length, 1);
  assertEquals(results[0].exitCode, 1);
  assertEquals(results[0].failureDetail, "timeout");
  assert(killed >= 1, "the wedged worker was killed");
  assert(started >= 2, "a replacement worker was started");
});

Deno.test("a registered worker pid is signaled by killActiveChildGroups on shutdown", () => {
  trackChild(4242);
  const signaled: number[] = [];
  killActiveChildGroups(undefined, (pid) => signaled.push(pid));
  assert(signaled.includes(-4242), "registered pid is signaled as a process group");
  untrackChild(4242);
  const afterUntrack: number[] = [];
  killActiveChildGroups(undefined, (pid) => afterUntrack.push(pid));
  assert(!afterUntrack.includes(-4242), "untracked pid is not signaled");
});
