/**
 * @module IngestTerminalBenchTest
 * @path tests/scripts/ingest_terminal_bench_test.ts
 * @description Validates ingestTerminalBenchTask against a frozen synthetic upstream
 *   Terminal-Bench-shaped fixture: exact contract mapping (TASK.md byte-parity, source
 *   block, synthetic base_ref, environment-file copy, oracle-derived reference.patch),
 *   task-id path-traversal rejection (GAP-3), and license-ineligible skip semantics
 *   (GAP-10). Phase 144 Step 1.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scenario_framework/schema/task_schema.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathTraversalError } from "@exaix/tool-runtime";
import { ingestTerminalBenchTask } from "../../scripts/ingest_terminal_bench.ts";

const FIXTURES_ROOT = new URL("./fixtures/terminal_bench_upstream", import.meta.url).pathname;
const ALLOWLISTED_LICENSE_TEXT = "MIT License\n\nPermission is hereby granted, free of charge...";
const DISALLOWED_LICENSE_TEXT = "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007";
const BENCHMARK_VERSION = "d28711d0da2675d0bb1d56de45ae5df6082438a3";
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;

async function withTempDirs<T>(fn: (outFixturesDir: string, outPortalsDir: string) => Promise<T>): Promise<T> {
  const outFixturesDir = await Deno.makeTempDir({ prefix: "exaix-tb-fixtures-" });
  const outPortalsDir = await Deno.makeTempDir({ prefix: "exaix-tb-portals-" });
  try {
    return await fn(outFixturesDir, outPortalsDir);
  } finally {
    await Deno.remove(outFixturesDir, { recursive: true });
    await Deno.remove(outPortalsDir, { recursive: true });
  }
}

Deno.test("[IngestTerminalBench] ingests a fixture task dir to an exact expected contract", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    const result = await ingestTerminalBenchTask({
      sourceDir: join(FIXTURES_ROOT, "fixture-task"),
      taskId: "fixture-task",
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      outFixturesDir,
      outPortalsDir,
    });

    assertEquals(result.skipped, false);
    assert(FULL_SHA_PATTERN.test(result.baseRef), `base_ref must be a full SHA, got ${result.baseRef}`);

    const taskMd = await Deno.readTextFile(join(result.contractDir, "TASK.md"));
    assert(
      taskMd.includes("Write the sum of all integers to /app/total.txt."),
      "TASK.md must carry the verbatim instruction",
    );

    const taskJsonRaw = await Deno.readTextFile(join(result.contractDir, "task.json"));
    const taskJson = JSON.parse(taskJsonRaw);
    assertEquals(taskJson.base_ref, result.baseRef);
    assertEquals(taskJson.family, "task:data-processing");
    assertEquals(taskJson.difficulty, "S");
    assertEquals(taskJson.portal, "external/terminal_bench/fixture-task");
    assertEquals(taskJson.source, {
      benchmark: "terminal-bench",
      version: BENCHMARK_VERSION,
      task_id: "fixture-task",
    });

    const referencePatch = await Deno.readTextFile(join(result.contractDir, "reference.patch"));
    assert(referencePatch.includes("total.txt"), "reference.patch must show total.txt created");
    assert(referencePatch.includes("+15"), "reference.patch must show the correct computed sum (3+5+7=15)");

    const envFile = await Deno.readTextFile(join(result.portalDir, "data", "numbers.txt"));
    assertEquals(envFile, "3\n5\n7\n");

    assertEquals(
      taskJson.scoped_test_cmd,
      "curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh -s -- -q && " +
        "/tmp/.local/bin/uv venv /tmp/.venv -q && . /tmp/.venv/bin/activate && " +
        "/tmp/.local/bin/uv pip install -q pytest==8.4.1 && cd /app && " +
        "pytest /oracle_tests/test_outputs.py -rA",
      "scoped_test_cmd must be self-contained (pytest bootstrap inline), never reference " +
        "$HOME/$PATH (host-substituted by the scenario framework before reaching the " +
        "container), and target the hidden oracle-tests mount",
    );

    const oracleTest = await Deno.readTextFile(join(result.contractDir, "oracle_tests", "test_outputs.py"));
    assert(
      oracleTest.includes('total_path.read_text().strip() == "15"'),
      "the hidden oracle test must be vendored verbatim into the contract dir",
    );
  });
});

Deno.test("[IngestTerminalBench] a hanging oracle solution is killed at the timeout, not left to run forever", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    const sourceDir = await Deno.makeTempDir({ prefix: "exaix-tb-hanging-source-" });
    try {
      await Deno.mkdir(join(sourceDir, "data"));
      await Deno.writeTextFile(join(sourceDir, "data", "numbers.txt"), "1\n2\n3\n");
      await Deno.mkdir(join(sourceDir, "tests"));
      await Deno.writeTextFile(
        join(sourceDir, "tests", "test_outputs.py"),
        "def test_total():\n    assert True\n",
      );
      await Deno.writeTextFile(
        join(sourceDir, "task.yaml"),
        "instruction: |-\n  Sum numbers.\nauthor_name: Test Fixture\nauthor_email: fixture@example.com\n" +
          "difficulty: easy\ncategory: data-processing\ntags:\n  - data-processing\n",
      );
      await Deno.writeTextFile(join(sourceDir, "run-tests.sh"), "#!/bin/bash\nuv pip install pytest==8.4.1\n");
      // Sleeps far longer than the test's timeout — a stand-in for a genuinely hung or
      // pathologically slow oracle script (Phase 144 Step 5: batch ingest must never let one
      // bad upstream task block the whole release).
      await Deno.writeTextFile(join(sourceDir, "solution.sh"), "#!/bin/bash\nsleep 30\n");

      const start = performance.now();
      await assertRejects(
        () =>
          ingestTerminalBenchTask({
            sourceDir,
            taskId: "hanging-task",
            benchmarkVersion: BENCHMARK_VERSION,
            rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
            outFixturesDir,
            outPortalsDir,
            oracleSolutionTimeoutMs: 300,
          }),
        Error,
        "timed out",
      );
      const elapsedMs = performance.now() - start;
      assert(
        elapsedMs < 5000,
        `must abort near the 300ms timeout, not wait out the full 30s sleep (took ${elapsedMs}ms)`,
      );
    } finally {
      await Deno.remove(sourceDir, { recursive: true });
    }
  });
});

Deno.test("[IngestTerminalBench] reference.patch preserves binary file content — git apply reconstructs it exactly", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    const sourceDir = await Deno.makeTempDir({ prefix: "exaix-tb-binary-source-" });
    try {
      await Deno.mkdir(join(sourceDir, "tests"));
      await Deno.writeTextFile(
        join(sourceDir, "tests", "test_outputs.py"),
        "def test_binary():\n    assert True\n",
      );
      await Deno.writeTextFile(
        join(sourceDir, "task.yaml"),
        "instruction: |-\n  Produce a binary artifact.\nauthor_name: Test Fixture\n" +
          "author_email: fixture@example.com\ndifficulty: easy\ncategory: data-processing\ntags:\n  - data-processing\n",
      );
      await Deno.writeTextFile(join(sourceDir, "run-tests.sh"), "#!/bin/bash\nuv pip install pytest==8.4.1\n");
      // The oracle solution writes a file containing a NUL byte — git treats any file with a
      // NUL byte as binary; `git diff` (no --binary) only emits "Binary files differ", which
      // `git apply` cannot reconstruct from (found via a real controls-sweep run across the
      // pinned Terminal-Bench release, Phase 144 Step 5 — ~10 real tasks fail their reference
      // control this exact way).
      await Deno.writeTextFile(
        join(sourceDir, "solution.sh"),
        String.raw`#!/bin/bash` + "\n" + String.raw`printf 'AB\x00CD' > /app/artifact.bin` + "\n",
      );

      const result = await ingestTerminalBenchTask({
        sourceDir,
        taskId: "binary-task",
        benchmarkVersion: BENCHMARK_VERSION,
        rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
        outFixturesDir,
        outPortalsDir,
      });
      assertEquals(result.skipped, false);

      const referencePatch = await Deno.readTextFile(join(result.contractDir, "reference.patch"));
      assert(
        referencePatch.includes("GIT binary patch") || referencePatch.includes("literal "),
        "reference.patch must embed the actual binary content (git diff --binary), not just " +
          '"Binary files differ" — a patch without embedded content cannot be applied',
      );

      // Prove the patch is actually applicable: apply it to a fresh clone of the portal and
      // confirm the binary artifact reconstructs byte-for-byte.
      const applyTarget = await Deno.makeTempDir({ prefix: "exaix-tb-binary-apply-" });
      try {
        await Deno.mkdir(applyTarget, { recursive: true });
        for await (const entry of Deno.readDir(result.portalDir)) {
          await Deno.copyFile(join(result.portalDir, entry.name), join(applyTarget, entry.name)).catch(() => {});
        }
        const initCmd = new Deno.Command("git", { args: ["init", "-q"], cwd: applyTarget });
        await initCmd.output();
        const patchPath = join(applyTarget, ".test-reference.patch");
        await Deno.writeTextFile(patchPath, referencePatch);
        const applyCmd = new Deno.Command("git", { args: ["apply", patchPath], cwd: applyTarget, stderr: "piped" });
        const applyOutput = await applyCmd.output();
        assert(
          applyOutput.success,
          `git apply must succeed on the vendored reference.patch: ${new TextDecoder().decode(applyOutput.stderr)}`,
        );
        const reconstructed = await Deno.readFile(join(applyTarget, "artifact.bin"));
        assertEquals(
          new TextDecoder().decode(reconstructed),
          "AB\x00CD",
          "the reconstructed binary file must match the oracle solution's output exactly",
        );
      } finally {
        await Deno.remove(applyTarget, { recursive: true });
      }
    } finally {
      await Deno.remove(sourceDir, { recursive: true });
    }
  });
});

Deno.test("[IngestTerminalBench] sanitizes the task-id and rejects a path-traversal attempt", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    await assertRejects(
      () =>
        ingestTerminalBenchTask({
          sourceDir: join(FIXTURES_ROOT, "fixture-task"),
          taskId: "../../evil",
          benchmarkVersion: BENCHMARK_VERSION,
          rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
          outFixturesDir,
          outPortalsDir,
        }),
      PathTraversalError,
    );
  });
});

Deno.test("[IngestTerminalBench] a license-ineligible task is skipped, not vendored", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    const result = await ingestTerminalBenchTask({
      sourceDir: join(FIXTURES_ROOT, "ineligible-task"),
      taskId: "ineligible-task",
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      outFixturesDir,
      outPortalsDir,
    });

    assertEquals(result.skipped, true);
    assertEquals(result.eligibility.eligible, false);
    assert(result.reason !== undefined, "a skipped result must carry a reason");

    let contractDirExists = true;
    try {
      await Deno.stat(join(outFixturesDir, "ineligible-task"));
    } catch {
      contractDirExists = false;
    }
    assertEquals(contractDirExists, false, "an ineligible task must not be vendored to disk");
  });
});

Deno.test("[IngestTerminalBench] disallowed root license (DISALLOWED_LICENSE_TEXT) skips the whole run", async () => {
  await withTempDirs(async (outFixturesDir, outPortalsDir) => {
    const result = await ingestTerminalBenchTask({
      sourceDir: join(FIXTURES_ROOT, "fixture-task"),
      taskId: "fixture-task",
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: DISALLOWED_LICENSE_TEXT,
      outFixturesDir,
      outPortalsDir,
    });
    assertEquals(result.skipped, true);
  });
});
