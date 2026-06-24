/**
 * @module ScenarioFrameworkMain
 * @path tests/scenario_framework/runner/main.ts
 * @description CLI entry point for the scenario framework runner.
 * Implements the CLI interface defined in Contract 7 and 8.
 */

import { Command, EnumType } from "@cliffy/command";
import { resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type IRuntimeConfig, resolveRuntimeConfigForExecution, ScenarioCiProfile } from "./config.ts";
import { ScenarioExecutionMode } from "../schema/step_schema.ts";
import { type IScenarioCatalogEntry, loadScenarioCatalog } from "./scenario_catalog.ts";
import { runSyntheticScenario } from "./synthetic_runner.ts";
import type { IRunManifest } from "./evidence_collector.ts";
import { reportScenarioFailure } from "./reporter.ts";
import { selectScenariosForExecution } from "./modes.ts";
import { writeEvalHistoryEntry } from "./history_writer.ts";
import { EvalSqliteStore } from "@exaix/eval-history";

const modeType = new EnumType(ScenarioExecutionMode);
const profileType = new EnumType(ScenarioCiProfile);

await new Command()
  .name("scenario-runner")
  .version("0.1.0")
  .description("Exaix Scenario Test Framework Runner")
  .type("mode", modeType)
  .type("profile", profileType)
  .option("-c, --config <path:string>", "Path to the runtime configuration YAML or JSON file")
  .option("-w, --workspace <path:string>", "Workspace under test (overrides config file value)")
  .option("-o, --output <path:string>", "Output directory for evidence and manifests (overrides config)")
  .option("-m, --mode <mode:mode>", "Execution mode (overrides config)")
  .option("-p, --profile <profile:profile>", "CI profile filter")
  .option("-s, --scenario <id:string>", "Run a single named scenario (repeatable)", { collect: true })
  .option("-P, --pack <name:string>", "Run all scenarios in a named pack (repeatable)", { collect: true })
  .option("-t, --tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
  .option("-d, --dry-run", "Validate configuration and scenario definitions without executing any steps")
  .option("-v, --verbose", "Show full CLI commands executed in each step")
  .option("--eval-mode", "Enable eval history writing for evaluation runs")
  .option("--score-threshold <threshold:number>", "Minimum suite score to pass (default: 0.5)")
  .option("--trials <n:number>", "Number of trials per scenario (default: 1)")
  .option("--history-format <format:string>", "History storage format: sqlite+jsonl or jsonl (default: sqlite+jsonl)")
  .action(async (options) => {
    // 1. Resolve framework home (directory containing the runner entry point)
    const frameworkHome = resolve(new URL(".", import.meta.url).pathname, "..");

    // 2. Load file-based config if provided or default exists
    let fileConfig: Partial<IRuntimeConfig> = {};
    const effectiveConfigPath = options.config ?? resolve(frameworkHome, "runtime_config.json");
    try {
      const configText = await Deno.readTextFile(effectiveConfigPath);
      if (effectiveConfigPath.endsWith(".yaml") || effectiveConfigPath.endsWith(".yml")) {
        fileConfig = parseYaml(configText) as Partial<IRuntimeConfig>;
      } else {
        fileConfig = JSON.parse(configText);
      }
    } catch (error) {
      if (options.config) {
        throw error;
      }
      // If none provided and default doesn't exist, proceed with empty fileConfig
    }

    // 3. Resolve runtime configuration
    const runtimeConfig = resolveRuntimeConfigForExecution({
      executionDirectory: frameworkHome,
      fileConfig,
      cliFlags: {
        workspace: options.workspace,
        output: options.output,
        mode: options.mode as ScenarioExecutionMode,
        profile: options.profile as ScenarioCiProfile,
        verbose: options.verbose,
      },
    });

    if (options.dryRun) {
      console.log("Runtime Configuration (Resolved):");
      console.log(JSON.stringify(runtimeConfig, null, 2));
    }

    // 4. Load catalog
    const catalog = await loadScenarioCatalog({ frameworkHome });

    // 5. Resolve and apply scenario selection (including profile filtering)
    const selectedEntries = selectScenariosForExecution({
      scenarios: catalog,
      explicitScenarioIds: options.scenario,
      explicitPacks: options.pack,
      explicitTags: options.tag,
      profile: runtimeConfig.profile,
    }) as IScenarioCatalogEntry[];

    if (selectedEntries.length === 0) {
      console.error("No scenarios selected.");
      Deno.exit(1);
    }

    if (options.dryRun) {
      console.log("\nSelected Scenarios:");
      selectedEntries.forEach((s) => console.log(`- ${s.id} (${s.scenario_path})`));
      Deno.exit(0);
    }

    // 7. Execute scenarios
    console.log(`Executing ${selectedEntries.length} scenarios...`);
    let hasFailure = false;
    const manifests = new Map<string, IRunManifest>();

    for (const entry of selectedEntries) {
      console.log(`\nScenario: ${entry.id}`);
      try {
        const result = await runSyntheticScenario({
          frameworkHome,
          scenarioPath: entry.scenario_path,
          workspaceRoot: runtimeConfig.workspace_path,
          outputDir: runtimeConfig.output_dir,
          mode: runtimeConfig.mode,
          interactiveAllowed: runtimeConfig.mode !== ScenarioExecutionMode.AUTO,
          verbose: runtimeConfig.verbose,
          exactlExecutable: Deno.env.get("EXA_BIN_PATH")
            ? `${Deno.env.get("EXA_BIN_PATH")}/exactl`
            : resolve(frameworkHome, "bin/exactl"),
        });

        manifests.set(entry.id, result.manifest);

        console.log(`Outcome: ${result.manifest.outcome}`);
        if (result.manifest.outcome !== "success" && result.manifest.outcome !== "paused") {
          reportScenarioFailure(result);
          hasFailure = true;
          if (runtimeConfig.mode === ScenarioExecutionMode.AUTO && !options.evalMode) {
            console.error(`Scenario ${entry.id} failed in AUTO mode. Halting.`);
            break;
          }
        }
      } catch (error) {
        console.error(`Error executing scenario ${entry.id}:`, error);
        hasFailure = true;
        if (runtimeConfig.mode === ScenarioExecutionMode.AUTO) {
          break;
        }
      }
    }

    // 8. Write eval history entries if in eval mode
    if (options.evalMode) {
      const historyFormat = options.historyFormat ?? "sqlite+jsonl";
      let sqliteStore: EvalSqliteStore | undefined;
      if (historyFormat !== "jsonl") {
        const dbPath = resolve(Deno.cwd(), ".exa", "eval.db");
        sqliteStore = new EvalSqliteStore(dbPath);
        try {
          sqliteStore.initialize();
        } catch (error) {
          console.error("Failed to initialize SQLite history store:", error);
          sqliteStore = undefined;
        }
      }

      for (const [scenarioId, manifest] of manifests) {
        try {
          const entry = await writeEvalHistoryEntry({
            outputDir: runtimeConfig.output_dir,
            scenarioId,
            manifest,
          });

          if (sqliteStore) {
            try {
              sqliteStore.writeRun(
                entry,
                manifest.steps.map((s) => ({
                  stepId: s.stepId,
                  stepType: s.stepType,
                  score: s.score ?? computeStepScoreFromCriterionResults(s.criterionResults, s.executionStatus),
                  executionStatus: s.executionStatus,
                })),
              );
            } catch (error) {
              console.error(`Failed to write SQLite history for ${scenarioId}:`, error);
            }
          }
        } catch (error) {
          console.error(`Failed to write eval history for ${scenarioId}:`, error);
        }
      }

      if (sqliteStore) {
        sqliteStore.close();
      }
    }

    if (hasFailure) {
      Deno.exit(1);
    } else {
      console.log("\nAll scenarios completed successfully.");
      Deno.exit(0);
    }
  })
  .parse(Deno.args);

function computeStepScoreFromCriterionResults(
  results: { status: string; score_weight?: number }[],
  executionStatus?: string,
): number {
  // Execution failures score 0 regardless of criteria
  if (executionStatus === "execution-failed") return 0;
  if (results.length === 0) return 1.0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of results) {
    const w = r.score_weight ?? 1.0;
    totalWeight += w;
    if (r.status === "passed") weightedSum += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0.0;
}
