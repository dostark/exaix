/**
 * @module ModelRegistryCliRoundTripTest
 * @path tests/integration/model_registry_cli_round_trip_test.ts
 * @description Phase 135 Step 9 (Action 2) — CLI round-trip: `exactl models list
 *   --benchmark` run as a REAL subprocess against a Config DB seeded with a
 *   model_benchmark row (as a live Team daemon's refresh/benchmark scheduler would
 *   write), proving the CLI process's benchmark reader (constructed independently in
 *   apps/exactl/src/init.ts, edition-gated) reads real DB-backed benchmark data, not a
 *   mock. `config model` (Solo curated-candidates) and `models refresh` (a static
 *   guidance message, no daemon interaction) are already exhaustively covered by
 *   in-process unit tests in apps/exactl/tests/model_commands_test.ts — this test
 *   covers only the genuinely new claim a live process boundary can prove.
 * @architectural-layer Test
 * @related-files [apps/exactl/main.ts, apps/exactl/src/init.ts, apps/exactl/src/commands/model_commands.ts]
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

// The Solo floor's registry default for the anthropic provider (packages/ai-anthropic's
// ProviderDefaultsRegistry entry) — models list always shows this exact row, so seeding
// the benchmark for THIS pair is what makes the score column render deterministically.
const SOLO_FLOOR_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const SEEDED_SCORE = 0.611;

function writeCliConfig(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[model_registry]",
    "enabled = true",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Seed one model_benchmark row — what the daemon's benchmark scheduler would write. */
function seedBenchmarkRow(root: string): void {
  const db = new Database(join(root, ".exa", "journal.db"));
  try {
    db.exec(
      "INSERT INTO model_benchmark (provider, model, benchmark, score, provenance, measured_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
      ["anthropic", SOLO_FLOOR_ANTHROPIC_MODEL, "swe_bench_verified", SEEDED_SCORE, "static", Date.now()],
    );
  } finally {
    db.close();
  }
}

async function runExactl(
  configPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", `${REPO_ROOT}apps/exactl/main.ts`, ...args],
    env: { EXA_CONFIG_PATH: configPath, EXAIX_EDITION: "team" },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const { code, stdout, stderr } = await proc.output();
  return { stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr), code };
}

Deno.test({
  name:
    "[step135.9] real exactl subprocess: models list --benchmark reads a live DB-seeded score through the Team-gated benchmark reader",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "model-registry-cli-round-trip-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      writeCliConfig(configPath, tempDir);
      seedBenchmarkRow(tempDir);

      const result = await runExactl(configPath, ["models", "list", "--benchmark", "swe_bench_verified"]);

      if (result.code !== 0) {
        throw new Error(`exactl exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      assertStringIncludes(
        result.stdout,
        SOLO_FLOOR_ANTHROPIC_MODEL,
        "the anthropic floor model must appear in the row list",
      );
      assertStringIncludes(
        result.stdout,
        String(SEEDED_SCORE),
        "the seeded DB score must render (proves the CLI subprocess's edition-gated " +
          "benchmark reader reads real DB-backed data through model_benchmark, not a mock)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
