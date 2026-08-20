/**
 * @module RunJailedTest
 * @path tests/scenario_framework/tests/unit/run_jailed_test.ts
 * @description Tests for run_jailed.ts's pure argv-parsing and jail-launch construction —
 *   the framework wrapper that replaced external_bench_task's raw `docker run` scenario steps
 *   (GitHub issue #4). No real docker daemon involved: `buildRunJailedLaunch` only builds the
 *   args array `buildJailLaunch` would hand to `Deno.Command`, never spawns it.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/run_jailed.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { buildRunJailedLaunch, parseRunJailedArgs, stageCredentials } from "../../scripts/run_jailed.ts";

Deno.test("[RunJailed] parses required flags and the inner args after --", () => {
  const options = parseRunJailedArgs([
    "--mount-source",
    "/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--bin",
    "bash",
    "--",
    "-c",
    "pytest -rA",
  ]);
  assertEquals(options.mountSource, "/portal");
  assertEquals(options.mountDest, "/app");
  assertEquals(options.workdir, "/app");
  assertEquals(options.bin, "bash");
  assertEquals(options.innerArgs, ["-c", "pytest -rA"]);
  assertEquals(options.extraMounts, []);
  assertEquals(options.credentialBin, undefined);
});

Deno.test("[RunJailed] collects repeated --extra-mount flags in order", () => {
  const options = parseRunJailedArgs([
    "--mount-source",
    "/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--extra-mount",
    "type=bind,src=/a,dst=/x,ro",
    "--extra-mount",
    "type=bind,src=/b,dst=/y,ro",
    "--bin",
    "bash",
    "--",
  ]);
  assertEquals(options.extraMounts, ["type=bind,src=/a,dst=/x,ro", "type=bind,src=/b,dst=/y,ro"]);
});

Deno.test("[RunJailed] parses credential-bin and credential-staging-dir together", () => {
  const options = parseRunJailedArgs([
    "--mount-source",
    "/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--credential-bin",
    "opencode",
    "--credential-staging-dir",
    "/staged/opencode",
    "--bin",
    "opencode",
    "--",
    "run",
  ]);
  assertEquals(options.credentialBin, "opencode");
  assertEquals(options.credentialStagingDir, "/staged/opencode");
});

Deno.test("[RunJailed] an inner arg that starts with '-' after -- is never mistaken for a flag", () => {
  // Proves the -- separator design: a real Terminal-Bench oracle test command or a delegate
  // flag like "-c" or "-rA" must pass through untouched, not be parsed as run_jailed's own flag.
  const options = parseRunJailedArgs([
    "--mount-source",
    "/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--bin",
    "bash",
    "--",
    "-c",
    "cd /app && pytest tests/test_outputs.py -rA",
  ]);
  assertEquals(options.innerArgs, ["-c", "cd /app && pytest tests/test_outputs.py -rA"]);
});

Deno.test("[RunJailed] the request fixture content sentinel survives as its own discrete inner arg", () => {
  const options = parseRunJailedArgs([
    "--mount-source",
    "/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--bin",
    "opencode",
    "--",
    "run",
    "--format",
    "json",
    "$REQUEST_FIXTURE_CONTENT",
  ]);
  assertEquals(options.innerArgs.at(-1), "$REQUEST_FIXTURE_CONTENT");
});

Deno.test("[RunJailed] missing -- separator throws", () => {
  assertThrows(
    () => parseRunJailedArgs(["--mount-source", "/portal", "--bin", "bash"]),
    Error,
    "'--' separator",
  );
});

Deno.test("[RunJailed] a missing required flag throws, naming it", () => {
  assertThrows(
    () => parseRunJailedArgs(["--mount-dest", "/app", "--workdir", "/app", "--bin", "bash", "--"]),
    Error,
    "--mount-source",
  );
});

Deno.test("[RunJailed] --credential-bin without --credential-staging-dir throws", () => {
  assertThrows(
    () =>
      parseRunJailedArgs([
        "--mount-source",
        "/portal",
        "--mount-dest",
        "/app",
        "--workdir",
        "/app",
        "--credential-bin",
        "opencode",
        "--bin",
        "opencode",
        "--",
      ]),
    Error,
    "--credential-staging-dir",
  );
});

Deno.test("[RunJailed] an unknown flag throws, naming it", () => {
  assertThrows(
    () => parseRunJailedArgs(["--not-a-real-flag", "x", "--"]),
    Error,
    "--not-a-real-flag",
  );
});

Deno.test("[RunJailed] stageCredentials returns [] for a bin with no known credential store", async () => {
  const mounts = await stageCredentials("bash", await Deno.makeTempDir());
  assertEquals(mounts, []);
});

Deno.test("[RunJailed] stageCredentials returns [] when the live credential file does not exist", async () => {
  const fakeHome = await Deno.makeTempDir({ prefix: "run-jailed-no-creds-" });
  const previousHome = Deno.env.get("HOME");
  Deno.env.set("HOME", fakeHome);
  try {
    const mounts = await stageCredentials("opencode", await Deno.makeTempDir());
    assertEquals(mounts, []);
  } finally {
    if (previousHome !== undefined) Deno.env.set("HOME", previousHome);
  }
});

Deno.test("[RunJailed] stageCredentials copies a real live credential into the staging dir and returns its mount", async () => {
  const fakeHome = await Deno.makeTempDir({ prefix: "run-jailed-creds-" });
  const stagingDir = await Deno.makeTempDir({ prefix: "run-jailed-staged-" });
  await Deno.mkdir(`${fakeHome}/.local/share/opencode`, { recursive: true });
  await Deno.writeTextFile(`${fakeHome}/.local/share/opencode/auth.json`, `{"token":"fake"}`);
  const previousHome = Deno.env.get("HOME");
  Deno.env.set("HOME", fakeHome);
  try {
    const mounts = await stageCredentials("opencode", stagingDir);
    assertEquals(mounts, ["--mount", `type=bind,src=${stagingDir},dst=/tmp/.local`]);
    const staged = await Deno.readTextFile(`${stagingDir}/share/opencode/auth.json`);
    assertEquals(staged, `{"token":"fake"}`);
  } finally {
    if (previousHome !== undefined) Deno.env.set("HOME", previousHome);
  }
});

Deno.test("[RunJailed] buildRunJailedLaunch produces a hardened docker launch with no credential mount when none is requested", async () => {
  const launch = await buildRunJailedLaunch({
    mountSource: "/some/portal",
    mountDest: "/app",
    workdir: "/app",
    extraMounts: [],
    bin: "bash",
    innerArgs: ["-c", "pytest -rA"],
  });
  assertEquals(launch.bin, "docker");
  assert(launch.args.includes("--cap-drop=ALL"));
  assert(launch.args.includes("--security-opt=no-new-privileges"));
  assert(launch.args.includes("bash"));
  assert(launch.args.includes("-c"));
  assert(launch.args.includes("pytest -rA"));
  assert(!launch.args.some((a) => a.startsWith("type=bind") && a.includes("/tmp/.local")));
});

Deno.test("[RunJailed] buildRunJailedLaunch includes extraMounts verbatim", async () => {
  const launch = await buildRunJailedLaunch({
    mountSource: "/some/portal",
    mountDest: "/app",
    workdir: "/app",
    extraMounts: ["type=bind,src=/oracle,dst=/oracle_tests,ro"],
    bin: "bash",
    innerArgs: ["-c", "true"],
  });
  assert(launch.args.includes("type=bind,src=/oracle,dst=/oracle_tests,ro"));
});

Deno.test("[RunJailed] buildRunJailedLaunch stages and mounts credentials when credentialBin is set", async () => {
  const fakeHome = await Deno.makeTempDir({ prefix: "run-jailed-launch-creds-" });
  const stagingDir = await Deno.makeTempDir({ prefix: "run-jailed-launch-staged-" });
  await Deno.mkdir(`${fakeHome}/.local/share/opencode`, { recursive: true });
  await Deno.writeTextFile(`${fakeHome}/.local/share/opencode/auth.json`, `{"token":"fake"}`);
  const previousHome = Deno.env.get("HOME");
  Deno.env.set("HOME", fakeHome);
  try {
    const launch = await buildRunJailedLaunch({
      mountSource: "/some/portal",
      mountDest: "/app",
      workdir: "/app",
      extraMounts: [],
      credentialBin: "opencode",
      credentialStagingDir: stagingDir,
      bin: "opencode",
      innerArgs: ["run", "--format", "json"],
    });
    assert(launch.args.includes(`type=bind,src=${stagingDir},dst=/tmp/.local`));
  } finally {
    if (previousHome !== undefined) Deno.env.set("HOME", previousHome);
  }
});
