/**
 * @module TestIsolationTest
 * @path tests/scripts/test_isolation_test.ts
 * @description Verifies the dev-test image provider (`ensureDevTestImage`) and the
 *   `dev-test` Dockerfile stage / `.dockerignore` build-context contract.
 */

import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import {
  buildWorkerContainerLaunch,
  DEFAULT_TEST_CONTAINER_CPUS,
  DEFAULT_TEST_CONTAINER_IMAGE,
  DEFAULT_TEST_CONTAINER_JOBS,
  DEFAULT_TEST_CONTAINER_MEMORY,
  DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
  dockerDaemonReachable,
  ensureDevTestImage,
  type IContainerTestEntry,
  type IRunBatch2Options,
  isContainerModeEnabled,
  type IWorkerContainer,
  type IWorkerContainerLaunchOptions,
  linkedWorktreeGitMounts,
  MIN_TEST_CONTAINER_JOBS,
  parseDockerTimestamp,
  parseWorkerResultLine,
  resolveContainerResourceBounds,
  resolveDockerBuildEnv,
  runBatch2InContainers,
  selectBatch2Strategy,
  startWorkerContainer,
  TEST_CONTAINER_IMAGE_ENV,
} from "../../scripts/test_isolation.ts";
import {
  buildContainerEnv,
  containerResultFailureBlock,
  killActiveChildGroups,
  parseDotReporterCounts,
  parseSummaryLine,
  SEQUENTIAL_TESTS,
  trackChild,
  untrackChild,
} from "../../scripts/test_parallel.ts";
import {
  type IContainerRunResult,
  TEST_CONTAINER_DONE_SENTINEL,
  TEST_CONTAINER_RESULT_PREFIX,
} from "../../scripts/test_container_driver.ts";

const DOCKERFILE = await Deno.readTextFile(new URL("../../Dockerfile", import.meta.url));
const DOCKERIGNORE = await Deno.readTextFile(new URL("../../.dockerignore", import.meta.url));

/** The block of one named Dockerfile stage: from its `FROM … AS <name>` line to the next `FROM`. */
function dockerStage(dockerfile: string, name: string): string {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => line.includes(`AS ${name}`));
  if (start === -1) throw new Error(`no \`AS ${name}\` stage in Dockerfile`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("FROM "));
  return lines.slice(start, end === -1 ? undefined : start + 1 + end).join("\n");
}

/** The `dev-test` stage block: from its `FROM … AS dev-test` line to the next `FROM`. */
function devTestStage(dockerfile: string): string {
  return dockerStage(dockerfile, "dev-test");
}

const DELEGATE_CLI_INSTALL = "npm install -g node-gyp @anthropic-ai/claude-code";

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
    imageCreatedAt: () => Promise.resolve(new Date()),
    buildInputsModifiedAt: () => Promise.resolve(new Date(0)),
    build: () => {
      builtWhenPresent++;
      return Promise.resolve(0);
    },
  });
  assertEquals(builtWhenPresent, 0);
});

Deno.test("dev-test image provider rebuilds a present image older than its build inputs", async () => {
  let built = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(true),
    imageCreatedAt: () => Promise.resolve(new Date("2026-10-13T12:00:00Z")),
    buildInputsModifiedAt: () => Promise.resolve(new Date("2026-10-16T09:00:00Z")),
    build: () => {
      built++;
      return Promise.resolve(0);
    },
  });
  assertEquals(built, 1);
});

Deno.test("dev-test image provider keeps a present image newer than its build inputs", async () => {
  let built = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(true),
    imageCreatedAt: () => Promise.resolve(new Date("2026-10-17T12:00:00Z")),
    buildInputsModifiedAt: () => Promise.resolve(new Date("2026-10-16T09:00:00Z")),
    build: () => {
      built++;
      return Promise.resolve(0);
    },
  });
  assertEquals(built, 0);
});

Deno.test("dev-test image provider keeps a present image whose creation time is unreadable", async () => {
  let built = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(true),
    imageCreatedAt: () => Promise.resolve(undefined),
    buildInputsModifiedAt: () => Promise.resolve(new Date("2026-10-16T09:00:00Z")),
    build: () => {
      built++;
      return Promise.resolve(0);
    },
  });
  assertEquals(built, 0);
});

Deno.test("docker build env keeps an explicit BUILDX_CONFIG", () => {
  const env = resolveDockerBuildEnv({ BUILDX_CONFIG: "/chosen" }, () => false, () => "/tmp/fallback");
  assertEquals(env.BUILDX_CONFIG, "/chosen");
});

Deno.test("docker build env keeps a writable docker config", () => {
  const env = resolveDockerBuildEnv(
    { DOCKER_CONFIG: "/writable/docker", HOME: "/home/dev" },
    () => true,
    () => "/tmp/fallback",
  );
  assertEquals(env.BUILDX_CONFIG, undefined);
  assertEquals(env.DOCKER_CONFIG, "/writable/docker");
});

Deno.test("docker build env falls back when the buildx state directory is read-only", () => {
  const env = resolveDockerBuildEnv({ HOME: "/home/dev" }, () => false, () => "/tmp/fallback");
  assertEquals(env.BUILDX_CONFIG, "/tmp/fallback");
  assertEquals(env.DOCKER_CONFIG, "/tmp/fallback");
});

Deno.test("docker build env falls back when no docker config home is known", () => {
  const env = resolveDockerBuildEnv({}, () => true, () => "/tmp/fallback");
  assertEquals(env.BUILDX_CONFIG, "/tmp/fallback");
});

Deno.test("parseDockerTimestamp reads docker's nanosecond RFC 3339 timestamp", () => {
  assertEquals(
    parseDockerTimestamp("2026-10-13T14:56:00.392629629+02:00")?.toISOString(),
    "2026-10-13T12:56:00.392Z",
  );
  assertEquals(parseDockerTimestamp("not a time"), undefined);
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

Deno.test("the builder stage no longer installs the delegate CLIs, so the test image never waits on them", () => {
  assertFalse(dockerStage(DOCKERFILE, "builder").includes(DELEGATE_CLI_INSTALL), "builder installs no delegate CLIs");
});

Deno.test("each delegate CLI installs in its own stage at a pinned version", () => {
  const npmPins: Record<string, string> = {
    "cli-opencode": "opencode-ai@1.19.3",
    "cli-codex": "@openai/codex@0.163.0",
  };
  for (const [stageName, spec] of Object.entries(npmPins)) {
    const stage = dockerStage(DOCKERFILE, stageName);
    assert(stage.startsWith(`FROM builder AS ${stageName}`), stage);
    assert(stage.includes(`--prefix /opt/cli/${stageName.replace("cli-", "")} `) && stage.includes(` ${spec}`), stage);
  }
  const claude = dockerStage(DOCKERFILE, "cli-claude");
  assert(claude.startsWith("FROM builder AS cli-claude"), claude);
  assert(
    claude.includes("https://claude.ai/install.sh | HOME=/opt/cli/claude bash -s 2.1.302"),
    "cli-claude pins the curl-installed version",
  );
  assert(claude.includes("HOME=/opt/cli/claude"), "cli-claude installs into its own prefix");
  assert(!claude.includes("npm install"), "cli-claude no longer installs through npm");
});

Deno.test("the npm-installed delegate CLI stages cache npm downloads in a BuildKit cache mount", () => {
  for (const stageName of ["cli-opencode", "cli-codex"]) {
    assert(
      dockerStage(DOCKERFILE, stageName).includes("--mount=type=cache,target=/root/.npm"),
      `${stageName} caches npm downloads`,
    );
  }
});

Deno.test("each delegate CLI install gives up on a stalled npm fetch and retries", () => {
  for (const stageName of ["cli-opencode", "cli-codex"]) {
    const stage = dockerStage(DOCKERFILE, stageName);
    assert(stage.includes("--fetch-timeout="), `${stageName} sets an npm fetch timeout`);
    assert(stage.includes("--fetch-retries="), `${stageName} sets npm fetch retries`);
  }
});

Deno.test("the devcontainer copies the CLI prefixes from their own stages and puts them on PATH", () => {
  const stage = dockerStage(DOCKERFILE, "devcontainer");
  assert(stage.startsWith("FROM builder AS devcontainer"), stage);
  assert(stage.includes("COPY --from=cli-claude /opt/cli/claude /opt/cli/claude"), stage);
  assert(stage.includes("COPY --from=cli-opencode /opt/cli/opencode /opt/cli/opencode"), stage);
  assert(stage.includes("COPY --from=cli-codex /opt/cli/codex /opt/cli/codex"), stage);
  assert(stage.includes("/opt/cli/claude/.local/bin"), "the devcontainer puts the CLIs on PATH");
});

Deno.test("the eval-jail stage copies the pinned delegate CLIs instead of installing them", () => {
  const stage = dockerStage(DOCKERFILE, "eval-jail");
  assert(stage.includes("COPY --from=cli-claude /opt/cli/claude /opt/cli/claude"), stage);
  assert(stage.includes("COPY --from=cli-opencode /opt/cli/opencode /opt/cli/opencode"), stage);
  assertFalse(stage.includes("npm install -g @anthropic-ai/claude-code"), "eval-jail installs claude unpinned");
});

Deno.test("the image no longer pipes an install script into a shell", () => {
  assertFalse(DOCKERFILE.includes("opencode.ai/install"), "the OpenCode installer is curl-piped into bash");
});

Deno.test("the devcontainer config targets the devcontainer stage", async () => {
  // devcontainer.json is JSONC (it carries comments), so the target is matched in the text.
  const config = await Deno.readTextFile(new URL("../../.devcontainer/devcontainer.json", import.meta.url));
  assert(/"target"\s*:\s*"devcontainer"/.test(config), "devcontainer.json targets the devcontainer stage");
});

Deno.test("the builder stage persists its deno module cache in a BuildKit cache mount", () => {
  const stage = dockerStage(DOCKERFILE, "builder");
  assert(stage.includes("--mount=type=cache"), "builder mounts a persistent cache for deno");
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

// --- worker-container launcher and host scheduler ---

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

Deno.test("buildWorkerContainerLaunch isolates HOME, EXA_HOME and DENO_DIR, defaults to --network none, adds no second init, and never forwards DENO_JOBS", () => {
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
  assertFalse(launch.args.includes("--init"), "the image entrypoint already runs tini as PID 1");
  assert(launch.args.includes("-i"), "-i present");
  assert(joined.includes("--name exaix-test-worker-0"), "--name present");
  assert(joined.includes("HOME=/tmp/home"), "HOME isolated");
  assert(joined.includes("EXA_HOME=/tmp/exa"), "EXA_HOME isolated");
  assert(joined.includes("DENO_DIR=/deno-dir"), "DENO_DIR isolated");
  assert(joined.includes("--network none"), "network none by default");
  assert(joined.includes("--pids-limit 512"), "pids-limit wired");
  assert(joined.includes("--sysctl net.ipv6.conf.all.disable_ipv6=1"), "IPv6 disabled for deterministic loopback");
  assert(!joined.includes("DENO_JOBS"), "DENO_JOBS must never be forwarded");
  assert(joined.includes("scripts/test_container_driver.ts"), "runs the driver");
});

/** Writes a linked-worktree layout: a `.git` file in the checkout that points into the common git directory. */
async function writeLinkedWorktree(root: string): Promise<{ checkout: string; commonDir: string }> {
  const commonDir = join(root, "primary", ".git");
  const worktreeGitDir = join(commonDir, "worktrees", "wt");
  const checkout = join(root, "linked");
  await Deno.mkdir(worktreeGitDir, { recursive: true });
  await Deno.mkdir(checkout, { recursive: true });
  await Deno.writeTextFile(join(worktreeGitDir, "commondir"), "../..\n");
  await Deno.writeTextFile(join(checkout, ".git"), `gitdir: ${worktreeGitDir}\n`);
  return { checkout, commonDir };
}

Deno.test("a linked worktree mounts its common git directory read-only at the host path", async () => {
  await withTempDir(async (root) => {
    const { checkout, commonDir } = await writeLinkedWorktree(root);
    assertEquals(linkedWorktreeGitMounts(checkout), [`type=bind,src=${commonDir},dst=${commonDir},readonly`]);
  });
});

Deno.test("a normal checkout or a directory without git needs no extra git mount", async () => {
  await withTempDir(async (root) => {
    const normal = join(root, "normal");
    await Deno.mkdir(join(normal, ".git"), { recursive: true });
    assertEquals(linkedWorktreeGitMounts(normal), []);
    const bare = join(root, "bare");
    await Deno.mkdir(bare, { recursive: true });
    assertEquals(linkedWorktreeGitMounts(bare), []);
  });
});

Deno.test("a .git file that does not point to a git directory adds no mount", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".git"), "not a gitdir pointer\n");
    assertEquals(linkedWorktreeGitMounts(root), []);
  });
});

Deno.test("buildWorkerContainerLaunch adds the git mount for a linked worktree and only then", async () => {
  await withTempDir(async (root) => {
    const { checkout, commonDir } = await writeLinkedWorktree(root);
    const base = {
      image: "exaix-dev-test:dev",
      workerName: "exaix-test-worker-0",
      network: "none" as const,
      env: {},
      pidsLimit: 512,
      memory: "2g",
      cpus: "2.0",
      watchdogMs: 60_000,
    };
    const linked = buildWorkerContainerLaunch({ ...base, repoRoot: checkout }).args.join(" ");
    assert(
      linked.includes(`--mount type=bind,src=${commonDir},dst=${commonDir},readonly`),
      "git dir mounted read-only",
    );
    const plain = buildWorkerContainerLaunch({ ...base, repoRoot: "/repo" }).args.join(" ");
    assertFalse(plain.includes("readonly"), "no extra mount for a plain checkout");
  });
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

Deno.test("a worker that exits mid-flight and whose stdin rejects is requeued, not fatal", async () => {
  let started = 0;
  const options = baseRunOptions(() => {
    const index = started++;
    if (index === 0) {
      let sends = 0;
      return {
        name: "w0",
        send(): Promise<void> {
          sends++;
          return sends === 1 ? Promise.resolve() : Promise.reject(new Error("BrokenPipe: Broken pipe (os error 32)"));
        },
        next(): Promise<IContainerRunResult | null> {
          return Promise.resolve(null);
        },
        kill(): Promise<void> {
          return Promise.resolve();
        },
      };
    }
    return makeFakeWorker(`w${index}`, (file) => resultFor(file));
  });
  options.jobs = 1;
  const results = await runBatch2InContainers([{ file: "a_test.ts" }], options);
  assertEquals(results.map((r) => r.testFile), ["a_test.ts"]);
  assertEquals(results[0].exitCode, 0);
});

Deno.test("the DONE sentinel is never written to an exited worker", async () => {
  const doneSentTo: number[] = [];
  let started = 0;
  const options = baseRunOptions(() => {
    const index = started++;
    if (index === 0) {
      return {
        name: "w0",
        send(file: string): Promise<void> {
          if (file === TEST_CONTAINER_DONE_SENTINEL) doneSentTo.push(index);
          return Promise.resolve();
        },
        next(): Promise<IContainerRunResult | null> {
          return Promise.resolve(null);
        },
        kill(): Promise<void> {
          return Promise.resolve();
        },
      };
    }
    return makeFakeWorker(`w${index}`, (file) => resultFor(file));
  });
  options.jobs = 1;
  await runBatch2InContainers([{ file: "a_test.ts" }], options);
  assertEquals(doneSentTo, []);
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

Deno.test("the host rejects a dispatched path that escapes the repo root", async () => {
  const sent: string[] = [];
  const options = baseRunOptions(() => {
    const worker = makeFakeWorker("w", (file) => resultFor(file));
    return {
      name: worker.name,
      send(file: string): Promise<void> {
        sent.push(file);
        return worker.send(file);
      },
      next: () => worker.next(),
      kill: () => worker.kill(),
    };
  });
  options.jobs = 1;
  const results = await runBatch2InContainers(
    [{ file: "../escape_test.ts" }, { file: "ok_test.ts" }],
    options,
  );
  const escape = results.find((r) => r.testFile === "../escape_test.ts");
  assert(escape, "the escaping entry produced a result");
  assertEquals(escape.exitCode, 1);
  assertEquals(escape.failureDetail, "invalid test file path");
  assert(!sent.includes("../escape_test.ts"), "the escaping path was never sent to a worker");
  assert(sent.includes("ok_test.ts"), "the valid path was dispatched");
});

Deno.test("at most one shared-path writer runs concurrently in the worker pool", async () => {
  let concurrent = 0;
  let exclusiveActive = false;
  let overlap = false;
  const options = baseRunOptions(undefined);
  options.jobs = 3;
  options.startWorker = () => {
    let lastFile = "";
    return {
      name: "w",
      send(file: string): Promise<void> {
        if (file === TEST_CONTAINER_DONE_SENTINEL) return Promise.resolve();
        lastFile = file;
        concurrent++;
        if (file === "shared_test.ts") exclusiveActive = true;
        if (exclusiveActive && concurrent > 1) overlap = true;
        if (file !== "shared_test.ts" && exclusiveActive) overlap = true;
        return Promise.resolve();
      },
      next(): Promise<IContainerRunResult | null> {
        const wasExclusive = lastFile === "shared_test.ts";
        concurrent--;
        if (wasExclusive) exclusiveActive = false;
        return Promise.resolve(resultFor(lastFile));
      },
      kill(): Promise<void> {
        return Promise.resolve();
      },
    };
  };
  const entries: IContainerTestEntry[] = [
    { file: "shared_test.ts", exclusive: true },
    { file: "a_test.ts" },
    { file: "b_test.ts" },
  ];
  const results = await runBatch2InContainers(entries, options);
  assertEquals(results.length, 3);
  assertEquals(overlap, false, "no entry may overlap an exclusive entry");
});

Deno.test("shared-path entries are exclusive so a shared-path writer never overlaps another entry", () => {
  const sharedPathPool = SEQUENTIAL_TESTS.filter(
    (test) => test.reasons.includes("shared-path") && !test.network,
  );
  assertEquals(sharedPathPool.map((test) => test.file), [
    "tests/integration/agent/mcp_handshake_test.ts",
    "packages/lint-policy/tests/unslop_cli_integration_test.ts",
    "packages/lint-policy/tests/lint_policy_move_equivalence_test.ts",
  ]);
  for (const test of sharedPathPool) {
    assertEquals(test.exclusive, true, `${test.file} must be exclusive`);
  }
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

// --- Batch-2 strategy selection ---

const dockerReachable = () => Promise.resolve(true);
const dockerUnreachable = () => Promise.resolve(false);

Deno.test("selectBatch2Strategy lets the CLI jobs override win over EXA_TEST_CONTAINER_JOBS and the default", async () => {
  const strategy = await selectBatch2Strategy(
    { EXA_TEST_CONTAINERS: "1", EXA_TEST_CONTAINER_JOBS: "3" },
    dockerReachable,
    { jobs: 6 },
  );
  assertEquals(strategy.mode, "container");
  assertEquals(strategy.jobs, Math.min(6, navigator.hardwareConcurrency));
  assert(strategy.reason.includes("flag"));
});

Deno.test("selectBatch2Strategy clamps jobs to [MIN_TEST_CONTAINER_JOBS, navigator.hardwareConcurrency]", async () => {
  const high = await selectBatch2Strategy(
    { EXA_TEST_CONTAINERS: "1", EXA_TEST_CONTAINER_JOBS: "9999" },
    dockerReachable,
  );
  assertEquals(high.jobs, navigator.hardwareConcurrency);
  const low = await selectBatch2Strategy(
    { EXA_TEST_CONTAINERS: "1" },
    dockerReachable,
    { jobs: MIN_TEST_CONTAINER_JOBS },
  );
  assertEquals(low.jobs, MIN_TEST_CONTAINER_JOBS);
});

Deno.test("the default worker count is 4", () => {
  assertEquals(DEFAULT_TEST_CONTAINER_JOBS, 4);
  assert(DEFAULT_TEST_CONTAINER_JOBS >= MIN_TEST_CONTAINER_JOBS);
});

Deno.test("selectBatch2Strategy defaults to container mode when EXA_TEST_CONTAINERS is unset", async () => {
  const strategy = await selectBatch2Strategy({}, dockerReachable);
  assertEquals(strategy.mode, "container");
});

Deno.test("selectBatch2Strategy opts into serial when EXA_TEST_CONTAINERS is 0", async () => {
  const strategy = await selectBatch2Strategy({ EXA_TEST_CONTAINERS: "0" }, dockerReachable);
  assertEquals(strategy.mode, "serial");
});

Deno.test("selectBatch2Strategy opts into serial when --test-serial is passed", async () => {
  const strategy = await selectBatch2Strategy({ EXA_TEST_CONTAINERS: "1" }, dockerReachable, { serial: true });
  assertEquals(strategy.mode, "serial");
});

Deno.test("selectBatch2Strategy falls back to serial when the docker probe fails", async () => {
  const strategy = await selectBatch2Strategy({ EXA_TEST_CONTAINERS: "1" }, dockerUnreachable);
  assertEquals(strategy.mode, "serial");
  assertEquals(strategy.jobs, DEFAULT_TEST_CONTAINER_JOBS);
});

Deno.test("isContainerModeEnabled is true only for an explicit EXA_TEST_CONTAINERS=1", () => {
  assert(isContainerModeEnabled({ EXA_TEST_CONTAINERS: "1" }));
  assert(!isContainerModeEnabled({ EXA_TEST_CONTAINERS: "0" }));
  assert(!isContainerModeEnabled({}));
});

// --- Batch-2 migration and parity ---

Deno.test("runBatch2InContainers never drops a non-network Batch-2 file (no silent downgrade)", async () => {
  const entries: IContainerTestEntry[] = SEQUENTIAL_TESTS.map((test) => ({
    file: test.file,
    serializedOutput: test.serializedOutput,
    network: test.network,
  }));
  const dispatched: string[] = [];
  const options = baseRunOptions(() =>
    makeFakeWorker("w", (file) => {
      dispatched.push(file);
      return resultFor(file);
    })
  );
  const results = await runBatch2InContainers(entries, options);
  const expected = SEQUENTIAL_TESTS.filter((test) => !test.network).map((test) => test.file).sort();
  assertEquals(results.map((r) => r.testFile).sort(), expected);
  assertEquals(dispatched.sort(), expected);
});

// Real-Docker integration. Skipped when Docker is unavailable. The parity test uses a
// representative subset of isolation reasons and the loopback and exactl surfaces.
// The entry-point run covers the full suite.

const DOCKER_READY = await dockerDaemonReachable();
// The Docker-backed integration tests are opt-in. They build the dev-test image, so a plain
// suite run must never reach them. Require an explicit EXA_TEST_CONTAINERS=1 to run them.
const INTEGRATION_IGNORE = !DOCKER_READY || !isContainerModeEnabled(Deno.env.toObject());
const IT_IMAGE = Deno.env.get(TEST_CONTAINER_IMAGE_ENV) ?? DEFAULT_TEST_CONTAINER_IMAGE;
const IT_REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url)).replace(/\/$/, "");
let itWorkerSeq = 0;

let imageReady: Promise<void> | undefined;
function ensureImageOnce(): Promise<void> {
  imageReady ??= ensureDevTestImage(IT_IMAGE);
  return imageReady;
}

function itWorkerOptions(): IWorkerContainerLaunchOptions {
  return {
    repoRoot: IT_REPO_ROOT,
    image: IT_IMAGE,
    workerName: `exaix-test-it-${Deno.pid}-${itWorkerSeq++}`,
    network: "none",
    env: buildContainerEnv(),
    pidsLimit: DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
    memory: DEFAULT_TEST_CONTAINER_MEMORY,
    cpus: DEFAULT_TEST_CONTAINER_CPUS,
    watchdogMs: 120_000,
  };
}

function itRunOptions(jobs: number): IRunBatch2Options {
  return {
    repoRoot: IT_REPO_ROOT,
    image: IT_IMAGE,
    jobs,
    env: buildContainerEnv(),
    network: "none",
    pidsLimit: DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
    memory: DEFAULT_TEST_CONTAINER_MEMORY,
    cpus: DEFAULT_TEST_CONTAINER_CPUS,
    watchdogMs: 600_000,
  };
}

/** Write a throwaway fixture under tests/scripts/, run `fn`, then delete it. */
async function withTempTestFile(
  name: string,
  content: string,
  fn: (rel: string) => Promise<void>,
): Promise<void> {
  const rel = `tests/scripts/__phase207_${name}_${Deno.pid}.ts`;
  const abs = join(IT_REPO_ROOT, rel);
  await Deno.writeTextFile(abs, content);
  try {
    await fn(rel);
  } finally {
    await Deno.remove(abs).catch(() => {});
  }
}

async function runOneFile(rel: string): Promise<IContainerRunResult> {
  const worker = startWorkerContainer(itWorkerOptions());
  try {
    await worker.send(rel);
    const result = await worker.next();
    if (result === null) throw new Error(`worker exited without a result for ${rel}`);
    return result;
  } finally {
    await worker.send(TEST_CONTAINER_DONE_SENTINEL).catch(() => {});
    await worker.kill();
  }
}

async function serialCounts(
  file: string,
): Promise<{ passed: number; failed: number; ignored: number; exitCode: number }> {
  const env = { ...Deno.env.toObject() };
  delete env["DENO_JOBS"];
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-all", "--reporter=dot", file],
    cwd: IT_REPO_ROOT,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  const summary = parseSummaryLine(text);
  const counts = summary.passed === 0 && summary.failed === 0
    ? parseDotReporterCounts(text, summary.durationSec)
    : summary;
  return { passed: counts.passed, failed: counts.failed, ignored: counts.ignored, exitCode: out.code };
}

const LOOPBACK_FIXTURE = [
  'Deno.test("loopback", async () => {',
  '  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, () => new Response("pong"));',
  "  try {",
  "    const res = await fetch(`http://127.0.0.1:${server.addr.port}/`);",
  '    if ((await res.text()) !== "pong") throw new Error("bad body");',
  "  } finally {",
  "    await server.shutdown();",
  "  }",
  "});",
].join("\n");

const STDERR_BURST_FIXTURE = [
  'Deno.test("burst", () => {',
  '  const chunk = new TextEncoder().encode("x".repeat(1024) + "\\n");',
  "  for (let i = 0; i < 256; i++) Deno.stderr.writeSync(chunk);",
  "});",
].join("\n");

Deno.test({
  name: "[integration] a daemon test binds and serves over loopback under --network none",
  ignore: INTEGRATION_IGNORE,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    await withTempTestFile("loopback", LOOPBACK_FIXTURE, async (rel) => {
      const result = await runOneFile(rel);
      assertEquals(result.exitCode, 0, result.failureDetail ?? "loopback test failed");
      assertEquals(result.passed, 1);
    });
  },
});

Deno.test({
  name: "[integration] the host drains worker stderr continuously and does not deadlock on a large burst",
  ignore: INTEGRATION_IGNORE,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    await withTempTestFile("stderr_burst", STDERR_BURST_FIXTURE, async (rel) => {
      const result = await runOneFile(rel);
      assertEquals(result.exitCode, 0, result.failureDetail ?? "stderr burst failed");
      assertEquals(result.passed, 1);
    });
  },
});

Deno.test({
  name: "[integration] two real Batch-2 files run green through one worker container",
  ignore: INTEGRATION_IGNORE,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    const files = ["packages/core/tests/child_env_test.ts", "tests/scripts/check_commit_msg_test.ts"];
    const results = await runBatch2InContainers(files.map((file) => ({ file })), itRunOptions(1));
    assertEquals(results.length, 2);
    for (const result of results) {
      assertEquals(result.exitCode, 0, result.failureDetail ?? `${result.testFile} failed`);
    }
  },
});

Deno.test({
  name: "[integration] files run through a worker container do not leak process env between files",
  ignore: INTEGRATION_IGNORE,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    const leakA = [
      'Deno.env.set("EXA_PHASE207_LEAK_A", "1");',
      'Deno.test("a", () => {',
      '  if (Deno.env.get("EXA_PHASE207_LEAK_B") !== undefined) throw new Error("leaked B into A");',
      "});",
    ].join("\n");
    const leakB = [
      'Deno.env.set("EXA_PHASE207_LEAK_B", "1");',
      'Deno.test("b", () => {',
      '  if (Deno.env.get("EXA_PHASE207_LEAK_A") !== undefined) throw new Error("leaked A into B");',
      "});",
    ].join("\n");
    const relA = `tests/scripts/__phase207_leaka_${Deno.pid}.ts`;
    const relB = `tests/scripts/__phase207_leakb_${Deno.pid}.ts`;
    await Deno.writeTextFile(join(IT_REPO_ROOT, relA), leakA);
    await Deno.writeTextFile(join(IT_REPO_ROOT, relB), leakB);
    try {
      const results = await runBatch2InContainers([{ file: relA }, { file: relB }], itRunOptions(1));
      assertEquals(results.length, 2);
      for (const result of results) {
        assertEquals(result.exitCode, 0, result.failureDetail ?? `${result.testFile} failed`);
      }
    } finally {
      await Deno.remove(join(IT_REPO_ROOT, relA)).catch(() => {});
      await Deno.remove(join(IT_REPO_ROOT, relB)).catch(() => {});
    }
  },
});

const PARITY_SUBSET = [
  "packages/core/tests/child_env_test.ts",
  "tests/scripts/db_cache_schema_upgrade_test.ts",
  "tests/scenario_framework/tests/integration/flow_step_model_bindings_test.ts",
  "tests/integration/mcp_server_spec_compliance_cutover_test.ts",
  "tests/integration/agent/mcp_handshake_test.ts",
];

Deno.test({
  name: "[integration] Containered Batch parity for six isolation reasons (opt-in via EXA_TEST_CUTOVER)",
  ignore: INTEGRATION_IGNORE || Deno.env.get("EXA_TEST_CUTOVER") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    const entries = PARITY_SUBSET.map((file) => ({ file }));
    const containerResults = await runBatch2InContainers(entries, { ...itRunOptions(2), memory: "1.5g" });
    const byFile = new Map(containerResults.map((result) => [result.testFile, result]));
    const mismatches: string[] = [];
    for (const entry of entries) {
      const container = byFile.get(entry.file);
      assert(container, `container produced no result for ${entry.file}`);
      const serial = await serialCounts(entry.file);
      const containerCounts = {
        passed: container.passed,
        failed: container.failed,
        ignored: container.ignored,
      };
      const serialCounts_ = { passed: serial.passed, failed: serial.failed, ignored: serial.ignored };
      if (
        containerCounts.passed !== serialCounts_.passed ||
        containerCounts.failed !== serialCounts_.failed ||
        containerCounts.ignored !== serialCounts_.ignored
      ) {
        mismatches.push(
          `${entry.file}: container=${JSON.stringify(containerCounts)} serial=${JSON.stringify(serialCounts_)}`,
        );
      }
    }
    assertEquals(mismatches, [], `parity mismatches:\n${mismatches.join("\n")}`);
  },
});

// --- resource bounds and CI ---

Deno.test("buildWorkerContainerLaunch applies pids/memory/cpus bounds from the named constants and env overrides", () => {
  const defaults = resolveContainerResourceBounds({});
  assertEquals(defaults, {
    pidsLimit: DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
    memory: DEFAULT_TEST_CONTAINER_MEMORY,
    cpus: DEFAULT_TEST_CONTAINER_CPUS,
  });
  const overridden = resolveContainerResourceBounds({
    EXA_TEST_CONTAINER_PIDS_LIMIT: "1024",
    EXA_TEST_CONTAINER_MEMORY: "4g",
    EXA_TEST_CONTAINER_CPUS: "3.0",
  });
  assertEquals(overridden, { pidsLimit: 1024, memory: "4g", cpus: "3.0" });
  const launch = buildWorkerContainerLaunch({
    repoRoot: "/repo",
    image: "exaix-dev-test:dev",
    workerName: "exaix-test-worker-bounds",
    network: "none",
    env: {},
    ...overridden,
    watchdogMs: 60_000,
  });
  const joined = launch.args.join(" ");
  assert(joined.includes("--pids-limit 1024"), "--pids-limit override applied");
  assert(joined.includes("--memory 4g"), "--memory override applied");
  assert(joined.includes("--cpus 3.0"), "--cpus override applied");
});

Deno.test("resolveContainerResourceBounds falls back on invalid memory and cpus overrides", () => {
  const invalid = resolveContainerResourceBounds({
    EXA_TEST_CONTAINER_MEMORY: "bogus",
    EXA_TEST_CONTAINER_CPUS: "abc",
  });
  assertEquals(invalid, {
    pidsLimit: DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
    memory: DEFAULT_TEST_CONTAINER_MEMORY,
    cpus: DEFAULT_TEST_CONTAINER_CPUS,
  });
  const valid = resolveContainerResourceBounds({
    EXA_TEST_CONTAINER_MEMORY: "4g",
    EXA_TEST_CONTAINER_CPUS: "3.0",
  });
  assertEquals(valid, {
    pidsLimit: DEFAULT_TEST_CONTAINER_PIDS_LIMIT,
    memory: "4g",
    cpus: "3.0",
  });
});

Deno.test("resolveContainerResourceBounds falls back to the named defaults on an invalid pids override", () => {
  const nonNumeric = resolveContainerResourceBounds({ EXA_TEST_CONTAINER_PIDS_LIMIT: "not-a-number" });
  assertEquals(nonNumeric.pidsLimit, DEFAULT_TEST_CONTAINER_PIDS_LIMIT);
  const zero = resolveContainerResourceBounds({ EXA_TEST_CONTAINER_PIDS_LIMIT: "0" });
  assertEquals(zero.pidsLimit, DEFAULT_TEST_CONTAINER_PIDS_LIMIT);
});

const FAILING_FIXTURE = [
  'Deno.test("fails", () => {',
  '  throw new Error("seeded failure");',
  "});",
].join("\n");

Deno.test({
  name: "[integration] the CI job command exits non-zero on a seeded failing file",
  ignore: INTEGRATION_IGNORE,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureImageOnce();
    await withTempTestFile("failing", FAILING_FIXTURE, async (rel) => {
      const results = await runBatch2InContainers([{ file: rel }], itRunOptions(1));
      assertEquals(results.length, 1);
      const result = results[0];
      assert(result.exitCode !== 0, "a failing file must report a non-zero exit code");
      assert(containerResultFailureBlock(result) !== null, "a failing file must produce a failure block");
      const batchExitCode = results.some((entry) => entry.exitCode !== 0) ? 1 : 0;
      assertEquals(batchExitCode, 1, "the batch exit code must be non-zero");
    });
  },
});
