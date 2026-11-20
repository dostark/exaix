/**
 * @module CheckpointTest
 * @path tests/compat/checkpoint_test.ts
 * @description Verifies that the host can observe and act while a sandbox script waits at a checkpoint.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CandidateKind, COMPAT_SCHEMA_VERSION } from "./harness/compat_types.ts";
import type { ICandidateBinding } from "./harness/compat_types.ts";
import { BWRAP_USABLE, SANDBOX_COPY_ROOT, SANDBOX_HOME } from "./harness/sandbox.ts";
import { runSession } from "./harness/session.ts";

const STATE_FILE = "state";

const BINDING: ICandidateBinding = {
  schemaVersion: COMPAT_SCHEMA_VERSION,
  label: "test-session",
  kind: CandidateKind.GO_STANDALONE,
  sourceRevision: "test",
  toolchain: "test",
  executables: [],
  companions: [],
  trees: [],
  env: { PATH: "/usr/bin", HOME: SANDBOX_HOME },
};

interface IScratch {
  dir: string;
  copyDir: string;
  homeDir: string;
}

async function makeScratch(): Promise<IScratch> {
  const dir = await Deno.makeTempDir({ prefix: "compat-session-" });
  const copyDir = join(dir, "copy");
  const homeDir = join(dir, "home");
  await Deno.mkdir(copyDir);
  await Deno.mkdir(homeDir);
  return { dir, copyDir, homeDir };
}

Deno.test({
  name: "checkpoint: a checkpoint observation is taken while the script waits",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch();
    try {
      const seen: string[] = [];
      const result = await runSession({
        binding: BINDING,
        copyDir: scratch.copyDir,
        homeDir: scratch.homeDir,
        script: [
          `echo before > ${SANDBOX_COPY_ROOT}/${STATE_FILE}`,
          "compat_checkpoint first",
          `echo after >> ${SANDBOX_COPY_ROOT}/${STATE_FILE}`,
          'echo "reply=$COMPAT_REPLY"',
        ].join("\n"),
        onCheckpoint: async (label) => {
          seen.push(`${label}:${await Deno.readTextFile(join(scratch.copyDir, STATE_FILE))}`);
          return "granted";
        },
      });

      assertEquals(seen, ["first:before\n"]);
      assertEquals(result.observation.exitCode, 0, result.observation.stderr);
      assertStringIncludes(result.observation.stdout, "reply=granted");
      assertEquals(await Deno.readTextFile(join(scratch.copyDir, STATE_FILE)), "before\nafter\n");
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "checkpoint: the script continues after each observation, in order",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch();
    try {
      const labels: string[] = [];
      const result = await runSession({
        binding: BINDING,
        copyDir: scratch.copyDir,
        homeDir: scratch.homeDir,
        script: "compat_checkpoint one\ncompat_checkpoint two\ncompat_checkpoint three\necho done",
        expectedCheckpoints: ["one", "two", "three"],
        onCheckpoint: (label) => {
          labels.push(label);
          return Promise.resolve("");
        },
      });

      assertEquals(labels, ["one", "two", "three"]);
      assertEquals(result.checkpoints, ["one", "two", "three"]);
      assertStringIncludes(result.observation.stdout, "done");
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "checkpoint: a script that exits without reaching a declared checkpoint fails",
  ignore: !BWRAP_USABLE,
  fn: async () => {
    const scratch = await makeScratch();
    try {
      await assertRejects(
        () =>
          runSession({
            binding: BINDING,
            copyDir: scratch.copyDir,
            homeDir: scratch.homeDir,
            script: "exit 0",
            expectedCheckpoints: ["never"],
            onCheckpoint: () => Promise.resolve(""),
          }),
        Error,
        "never",
      );
    } finally {
      await Deno.remove(scratch.dir, { recursive: true });
    }
  },
});
