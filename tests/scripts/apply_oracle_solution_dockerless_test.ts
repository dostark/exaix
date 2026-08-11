/**
 * @module ApplyOracleSolutionDockerlessTest
 * @path tests/scripts/apply_oracle_solution_dockerless_test.ts
 * @description RED-first test, Phase 144 post-gap remediation (GAP-4 / Step 10).
 *   `applyOracleSolutionDockerless` spawns its child with piped stdout/stderr and previously
 *   awaited `child.status` without ever reading those streams while the process ran — the
 *   standard OS pipe-buffer deadlock: once combined stdout+stderr exceeds the pipe capacity
 *   (~64KiB on Linux) before exit, the child blocks on its own write() call and never
 *   completes on its own, spuriously tripping the timeout on a verbose-but-correct solution.
 *   Exercised through `ingestOneBatchTask` (the production caller), since
 *   `applyOracleSolutionDockerless` itself is not exported.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { batchIngestTerminalBench, LICENSE_ALLOWLIST } from "../../scripts/ingest_terminal_bench.ts";

const APACHE_LICENSE_TEXT = "                                 Apache License\n" +
  "                           Version 2.0, January 2004\n" +
  "                        http://www.apache.org/licenses/\n";

async function withTempDirs<T>(
  fn: (dirs: { upstreamRoot: string; outFixturesDir: string; outPortalsDir: string }) => Promise<T>,
): Promise<T> {
  const upstreamRoot = await Deno.makeTempDir({ prefix: "exaix-tb-oracle-upstream-" });
  const outFixturesDir = await Deno.makeTempDir({ prefix: "exaix-tb-oracle-fixtures-" });
  const outPortalsDir = await Deno.makeTempDir({ prefix: "exaix-tb-oracle-portals-" });
  try {
    return await fn({ upstreamRoot, outFixturesDir, outPortalsDir });
  } finally {
    await Deno.remove(upstreamRoot, { recursive: true }).catch(() => {});
    await Deno.remove(outFixturesDir, { recursive: true }).catch(() => {});
    await Deno.remove(outPortalsDir, { recursive: true }).catch(() => {});
  }
}

Deno.test("[ApplyOracleSolutionDockerless] a verbose-but-correct oracle solution (more stdout than the OS pipe buffer) completes without a false timeout", async () => {
  await withTempDirs(async ({ upstreamRoot, outFixturesDir, outPortalsDir }) => {
    const taskDir = join(upstreamRoot, "verbose-task");
    await Deno.mkdir(join(taskDir, "tests"), { recursive: true });
    await Deno.writeTextFile(
      join(taskDir, "task.yaml"),
      "instruction: Do the thing.\ncategory: general\ndifficulty: easy\n",
    );
    await Deno.writeTextFile(join(taskDir, "run-tests.sh"), "uv pip install pytest==8.4.1\n");
    await Deno.writeTextFile(join(taskDir, "tests", "test_outputs.py"), "def test_ok():\n    assert True\n");
    await Deno.writeTextFile(join(taskDir, "docker-compose.yaml"), "services:\n  client:\n    image: ubuntu:24.04\n");
    // Writes ~200KiB of stdout — well past the ~64KiB OS pipe buffer capacity — before exiting 0.
    await Deno.writeTextFile(
      join(taskDir, "solution.sh"),
      `#!/bin/sh\ni=0\nwhile [ "$i" -lt 4000 ]; do echo "line $i padding padding padding padding padding"; i=$((i+1)); done\nexit 0\n`,
    );
    await Deno.mkdir(taskDir, { recursive: true });

    const start = Date.now();
    const manifest = await batchIngestTerminalBench({
      upstreamRoot,
      benchmarkVersion: "test-version",
      rootLicenseText: APACHE_LICENSE_TEXT,
      outFixturesDir,
      outPortalsDir,
      outScenariosDir: await Deno.makeTempDir({ prefix: "exaix-tb-oracle-scenarios-" }),
      outRequestsDir: await Deno.makeTempDir({ prefix: "exaix-tb-oracle-requests-" }),
    });
    const elapsedMs = Date.now() - start;

    assert(LICENSE_ALLOWLIST.includes("Apache-2.0"));
    assertEquals(manifest.tasks.length, 1);
    assertEquals(
      manifest.tasks[0].class,
      "supported",
      `a verbose-but-correct solution must not be misclassified ingest-error: ${JSON.stringify(manifest.tasks[0])}`,
    );
    assert(
      elapsedMs < 20_000,
      `must complete quickly, not stall for anywhere near the oracle-solution timeout: took ${elapsedMs}ms`,
    );
  });
});
