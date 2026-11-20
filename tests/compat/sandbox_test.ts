/**
 * @module SandboxTest
 * @path tests/compat/sandbox_test.ts
 * @description Verifies the bubblewrap profile, the Go-standalone refusal rules and the sandbox probe.
 */

import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { basename, join } from "@std/path";
import { CandidateKind, COMPAT_SCHEMA_VERSION } from "./harness/compat_types.ts";
import type { IBoundExecutable, ICandidateBinding } from "./harness/compat_types.ts";
import {
  assertBindingAllowed,
  buildBwrapArgs,
  BWRAP_USABLE,
  probeBwrap,
  runInSandbox,
  SANDBOX_COPY_ROOT,
  SANDBOX_DENODIR,
  SANDBOX_HOME,
  SANDBOX_LIB,
  SANDBOX_REF,
} from "./harness/sandbox.ts";

const SHELL = "/bin/sh";
const FAKE_SHA = "0".repeat(64);
const TS_HASH = "a".repeat(64);
const DECLARED_NAMES = ["exactl", "exaix"];
const TS_FROZEN_BINDING_PATH = "exaix-dev-docs/evidence/go-port/pending_review/binding_ts_frozen.json";
const SNAPSHOT_MANIFEST_PATH = "exaix-dev-docs/evidence/go-port/snapshot_manifest.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface IScratch {
  dir: string;
  copyDir: string;
  homeDir: string;
  executables: IBoundExecutable[];
}

async function makeScratch(names: IBoundExecutable["name"][]): Promise<IScratch> {
  const dir = await Deno.makeTempDir({ prefix: "compat-sandbox-" });
  const copyDir = join(dir, "copy");
  const homeDir = join(dir, "home");
  await Deno.mkdir(copyDir);
  await Deno.mkdir(homeDir);
  const executables: IBoundExecutable[] = [];
  for (const name of names) {
    const path = join(dir, `${name}.sh`);
    await Deno.writeTextFile(path, `#!${SHELL}\necho "${name} \$@"\n`, { mode: 0o755 });
    executables.push({ name, sourcePath: path, sha256: FAKE_SHA, argvPrefix: [name] });
  }
  return { dir, copyDir, homeDir, executables };
}

function bindingOf(
  kind: CandidateKind,
  executables: IBoundExecutable[],
  env: Record<string, string> = {},
): ICandidateBinding {
  return {
    schemaVersion: COMPAT_SCHEMA_VERSION,
    label: `test-${kind}`,
    kind,
    sourceRevision: "test",
    toolchain: "test",
    executables,
    companions: [],
    trees: [],
    env: { PATH: "/compat/bin:/usr/bin", HOME: SANDBOX_HOME, ...env },
  };
}

function setenvPairs(args: string[]): Record<string, string> {
  const pairs: Record<string, string> = {};
  args.forEach((arg, index) => {
    if (arg === "--setenv") pairs[args[index + 1]] = args[index + 2];
  });
  return pairs;
}

function boundTargets(args: string[], flag: string): string[] {
  const targets: string[] = [];
  args.forEach((arg, index) => {
    if (arg === flag) targets.push(args[index + 2]);
  });
  return targets;
}

Deno.test("sandbox: the environment is exactly the binding env", async () => {
  const scratch = await makeScratch(["exactl"]);
  try {
    const binding = bindingOf(CandidateKind.TS_FROZEN, scratch.executables, { TZ: "UTC", EXA_LLM_PROVIDER: "mock" });
    const args = buildBwrapArgs(binding, scratch.copyDir, scratch.homeDir);

    assertEquals(setenvPairs(args), binding.env);
    assertArrayIncludes(args, ["--clearenv", "--unshare-net", "--unshare-pid", "--die-with-parent"]);
  } finally {
    await Deno.remove(scratch.dir, { recursive: true });
  }
});

Deno.test("sandbox: only declared executables are bound under the compat bin", async () => {
  const scratch = await makeScratch(["exactl", "exaix"]);
  try {
    const binding = bindingOf(CandidateKind.GO_STANDALONE, scratch.executables);
    const args = buildBwrapArgs(binding, scratch.copyDir, scratch.homeDir);
    const bound = boundTargets(args, "--ro-bind").filter((target) => target.startsWith("/compat/bin/")).sort();

    assertEquals(bound, DECLARED_NAMES.map((name) => `/compat/bin/${name}`).sort());
    assertArrayIncludes(boundTargets(args, "--bind"), [SANDBOX_COPY_ROOT]);
  } finally {
    await Deno.remove(scratch.dir, { recursive: true });
  }
});

Deno.test("sandbox: a go-standalone binding with a TS fallback is refused", () => {
  const exactl: IBoundExecutable = { name: "exactl", sourcePath: "/x/exactl", sha256: FAKE_SHA, argvPrefix: [] };
  const refused: Array<[string, ICandidateBinding]> = [
    ["a deno executable", bindingOf(CandidateKind.GO_STANDALONE, [exactl, { ...exactl, name: "deno" }])],
    [
      "a /compat/ref tree",
      {
        ...bindingOf(CandidateKind.GO_STANDALONE, [exactl]),
        trees: [{ sourcePath: "/x/ref", mountPath: "/compat/ref", writable: false, contentHash: FAKE_SHA }],
      },
    ],
    [
      "a /compat/denodir tree",
      {
        ...bindingOf(CandidateKind.GO_STANDALONE, [exactl]),
        trees: [{ sourcePath: "/x/cache", mountPath: "/compat/denodir", writable: true, contentHash: FAKE_SHA }],
      },
    ],
    [
      "a DENO_SQLITE_PATH companion",
      {
        ...bindingOf(CandidateKind.GO_STANDALONE, [exactl], { DENO_SQLITE_PATH: "/compat/lib/libsqlite3.so" }),
        companions: [{ path: "/x/libsqlite3.so", sha256: FAKE_SHA, envVar: "DENO_SQLITE_PATH" }],
      },
    ],
    ["a DENO_DIR entry", bindingOf(CandidateKind.GO_STANDALONE, [exactl], { DENO_DIR: "/compat/denodir" })],
    [
      "an EXA_DAEMON_SCRIPT entry",
      bindingOf(CandidateKind.GO_STANDALONE, [exactl], { EXA_DAEMON_SCRIPT: "/compat/ref/x.ts" }),
    ],
  ];

  for (const [reason, binding] of refused) {
    assertThrows(() => assertBindingAllowed(binding, new Set()), Error, "go-standalone", reason);
  }
  assertEquals(assertBindingAllowed(bindingOf(CandidateKind.GO_STANDALONE, [exactl]), new Set()), undefined);
});

Deno.test("sandbox: a go-standalone executable matching a TS hash is refused", () => {
  const exactl: IBoundExecutable = { name: "exactl", sourcePath: "/x/exactl", sha256: TS_HASH, argvPrefix: [] };

  assertThrows(
    () => assertBindingAllowed(bindingOf(CandidateKind.GO_STANDALONE, [exactl]), new Set([TS_HASH])),
    Error,
    "recorded TS binary",
  );
  assertEquals(assertBindingAllowed(bindingOf(CandidateKind.TS_FROZEN, [exactl]), new Set([TS_HASH])), undefined);
});

Deno.test("sandbox: probeBwrap reports false for a missing or failing command", async () => {
  assertEquals(await probeBwrap("/nonexistent/bwrap"), false);
  assertEquals(await probeBwrap("/bin/false"), false);
});

Deno.test({
  name: "sandbox: only declared executables are visible",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch(["exactl", "exaix"]);
    try {
      const binding = bindingOf(CandidateKind.GO_STANDALONE, scratch.executables);
      const args = buildBwrapArgs(binding, scratch.copyDir, scratch.homeDir);
      const listing = await runInSandbox(args, [SHELL, "-c", "ls /compat/bin; command -v deno || echo no-deno"]);

      assertEquals(listing.exitCode, 0, listing.stderr);
      assertEquals(listing.stdout.trim().split("\n"), ["exactl", "exaix", "no-deno"]);

      const run = await runInSandbox(args, ["exactl", "--version"]);
      assertEquals(run.stdout.trim(), "exactl --version");
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "sandbox: the host home is not visible and the copy is writable at the canonical root",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch(["exactl"]);
    try {
      const binding = bindingOf(CandidateKind.TS_FROZEN, scratch.executables);
      const args = buildBwrapArgs(binding, scratch.copyDir, scratch.homeDir);
      const result = await runInSandbox(args, [
        SHELL,
        "-c",
        `test ! -e /home && echo no-home; echo written > ${SANDBOX_COPY_ROOT}/marker; pwd`,
      ]);

      assertStringIncludes(result.stdout, "no-home");
      assertStringIncludes(result.stdout, SANDBOX_COPY_ROOT);
      assertEquals(await Deno.readTextFile(join(scratch.copyDir, "marker")), "written\n");
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "sandbox: the network is unshared and only the declared variables are set",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch(["exactl"]);
    try {
      const binding = bindingOf(CandidateKind.TS_FROZEN, scratch.executables, { TZ: "UTC" });
      const args = buildBwrapArgs(binding, scratch.copyDir, scratch.homeDir);
      const net = await runInSandbox(args, [SHELL, "-c", "cat /proc/net/dev"]);
      const interfaces = net.stdout.split("\n").slice(2).map((line) => line.split(":")[0].trim()).filter(Boolean);
      assertEquals(interfaces, ["lo"]);

      const env = await runInSandbox(args, ["/usr/bin/env"]);
      const names = env.stdout.trim().split("\n").map((line) => line.split("=")[0]).sort();
      assertEquals(names.filter((name) => name !== "PWD" && name !== "OLDPWD" && name !== "SHLVL" && name !== "_"), [
        "HOME",
        "PATH",
        "TZ",
      ]);
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});

Deno.test("sandbox: the probe result is a boolean decided once per run", () => {
  assert(typeof BWRAP_USABLE === "boolean");
});

interface ISnapshotManifest {
  parent: string;
}

Deno.test("sandbox: the committed ts-frozen binding is complete and consistent", async () => {
  const text = await Deno.readTextFile(TS_FROZEN_BINDING_PATH);
  const binding: ICandidateBinding = JSON.parse(text);
  const manifest: ISnapshotManifest = JSON.parse(await Deno.readTextFile(SNAPSHOT_MANIFEST_PATH));

  assertEquals(binding.kind, CandidateKind.TS_FROZEN);
  assertEquals(binding.sourceRevision, manifest.parent);
  assertEquals(binding.executables.map((executable) => executable.name).sort(), ["deno", "exaix", "exactl"].sort());
  assertEquals(binding.trees.map((tree) => tree.mountPath).sort(), [SANDBOX_DENODIR, SANDBOX_REF]);
  for (
    const hash of [
      ...binding.executables.map((executable) => executable.sha256),
      ...binding.companions.map((companion) => companion.sha256),
      ...binding.trees.map((tree) => tree.contentHash),
    ]
  ) {
    assertMatch(hash, SHA256_PATTERN);
  }
  for (const companion of binding.companions) {
    assertEquals(binding.env[companion.envVar], `${SANDBOX_LIB}/${basename(companion.path)}`);
  }
  assertEquals(binding.env.EXA_DAEMON_SCRIPT, `${SANDBOX_REF}/apps/daemon/main.ts`);
  assertEquals(binding.env.DENO_DIR, SANDBOX_DENODIR);
  assertEquals(binding.env.EXA_LLM_PROVIDER, "mock");
  assertEquals(assertBindingAllowed(binding, new Set()), undefined);
  assertEquals(text.indexOf(Deno.env.get("HOME") ?? "/nonexistent-home"), -1, "the binding holds a host path");

  assertThrows(
    () => assertBindingAllowed({ ...binding, kind: CandidateKind.GO_STANDALONE }, new Set()),
    Error,
    "go-standalone",
  );
});
