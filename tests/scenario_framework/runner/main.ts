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
import { applySandboxCleanup, describeRetention, planSandboxCleanup, SandboxRetention } from "./sandbox_lifecycle.ts";
import { ScenarioExecutionMode } from "../schema/step_schema.ts";
import { type IScenarioCatalogEntry, loadScenarioCatalog } from "./scenario_catalog.ts";
import { runSyntheticScenario } from "./synthetic_runner.ts";
import type { IRunManifest } from "./evidence_collector.ts";
import { reportScenarioFailure, reportSuiteSummary } from "./reporter.ts";
import { selectScenariosForExecution } from "./modes.ts";
import { writeEvalHistoryEntries } from "./history_writer_dispatch.ts";
import {
  accumulateRunVerdict,
  checkScoreThreshold,
  computeMultiTrialMetrics,
  DEFAULT_EVAL_SCORE_THRESHOLD,
  DEFAULT_EVAL_TRIALS,
  type IRunVerdict,
  type IScenarioVerdict,
  RunVerdict,
} from "./scoring.ts";

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
  .option(
    "--max-step-timeout <sec:number>",
    "Cap every step's timeout_sec. Wait steps are sized for real runs (120-180s), which " +
      "dominates the loop when iterating on a failure visible in seconds. Shortens only, so a " +
      "step that would have failed cannot be made to pass.",
  )
  .option(
    "--fail-fast",
    "Stop after the first scenario that does not pass, leaving its sandbox for inspection. " +
      "A full pack takes minutes and a failure is usually visible in the first scenario, so " +
      "this is for iterating on a fix rather than for measuring a pack.",
  )
  .option("-d, --dry-run", "Validate configuration and scenario definitions without executing any steps")
  .option("-v, --verbose", "Show full CLI commands executed in each step")
  .option("--eval-mode", "Enable eval history writing for evaluation runs")
  .option("--score-threshold <threshold:number>", "Minimum suite score to pass (default: 0.5)")
  .option("--trials <n:number>", "Number of trials per scenario (default: 1)")
  .option("--history-format <format:string>", "History storage format: sqlite+jsonl or jsonl (default: sqlite+jsonl)")
  .option(
    "--cell <tool:string>",
    "Run only the matrix cell whose tool matches (e.g. claude-code, opencode) — every other cell is skipped, not run",
  )
  .option(
    "--keep-sandbox",
    "Keep the sandbox this run mints, even on success. A failing run always keeps it regardless, " +
      "and an operator-supplied --workspace is never removed.",
  )
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
    // 7. Resolve score threshold and trials (eval-mode only; defaults from configurable constants)
    const scoreThreshold = options.evalMode ? (options.scoreThreshold ?? DEFAULT_EVAL_SCORE_THRESHOLD) : undefined;
    const trials = options.evalMode ? (options.trials ?? DEFAULT_EVAL_TRIALS) : 1;

    // 8. Execute scenarios (with optional trial loop)
    console.log(`Executing ${selectedEntries.length} scenarios (trials=${trials})...`);
    const manifests = new Map<string, IRunManifest>();
    const scenarioVerdicts: IScenarioVerdict[] = [];
    const trialMetricsMap = new Map<string, {
      trials: number;
      trialScores: number[];
      suiteScoreMean: number;
      suiteScoreStdev: number;
      passAt1: number;
      passPowK: number;
    }>();
    let infraError = false;

    for (const entry of selectedEntries) {
      console.log(`\nScenario: ${entry.id}`);
      const trialScores: number[] = [];
      let trialInfraError = false;

      for (let trial = 0; trial < trials; trial++) {
        const trialLabel = trials > 1 ? `  [trial ${trial + 1}/${trials}]` : "";
        const trialOutputDir = trials > 1
          ? resolve(runtimeConfig.output_dir, `trial-${trial}`)
          : runtimeConfig.output_dir;
        const trialWorkspaceRoot = trials > 1
          ? resolve(runtimeConfig.workspace_path, `trial-${trial}`)
          : runtimeConfig.workspace_path;

        console.log(`${trialLabel} Running...`);

        try {
          const result = await runSyntheticScenario({
            frameworkHome,
            scenarioPath: entry.scenario_path,
            workspaceRoot: trialWorkspaceRoot,
            outputDir: trialOutputDir,
            mode: runtimeConfig.mode,
            interactiveAllowed: runtimeConfig.mode !== ScenarioExecutionMode.AUTO,
            verbose: runtimeConfig.verbose,
            exactlExecutable: Deno.env.get("EXA_BIN_PATH")
              ? `${Deno.env.get("EXA_BIN_PATH")}/exactl`
              : resolve(frameworkHome, "bin/exactl"),
            selectedCell: options.cell,
            maxStepTimeoutSec: options.maxStepTimeout,
          });

          const suiteScore = result.manifest.suite_score ?? 1.0;
          trialScores.push(suiteScore);

          if (trial === 0) {
            manifests.set(entry.id, result.manifest);
          }

          console.log(`${trialLabel} Outcome: ${result.manifest.outcome} (suite_score: ${suiteScore.toFixed(3)})`);

          if (result.manifest.outcome !== "success") {
            reportScenarioFailure(result);
          }
        } catch (error) {
          console.error(`${trialLabel} Error executing scenario ${entry.id}:`, error);
          trialInfraError = true;
          trialScores.push(0);
        }
      }

      if (trialInfraError) {
        infraError = true;
        if (runtimeConfig.mode === ScenarioExecutionMode.AUTO) {
          break;
        }
      }

      // Compute aggregate suite score from trial metrics
      let suiteScore: number;
      let isPassed: boolean;

      if (trials > 1) {
        const metrics = computeMultiTrialMetrics(trialScores, scoreThreshold ?? 0.5);
        suiteScore = metrics.mean;
        isPassed = scoreThreshold !== undefined ? checkScoreThreshold(suiteScore, scoreThreshold) : false;
        console.log(
          `  Aggregate: mean=${metrics.mean.toFixed(3)} pass_at_1=${metrics.pass_at_1.toFixed(3)} pass_pow_k=${
            metrics.pass_pow_k.toFixed(3)
          }`,
        );

        // Store trial metrics for history persistence
        trialMetricsMap.set(entry.id, {
          trials,
          trialScores,
          suiteScoreMean: metrics.mean,
          suiteScoreStdev: metrics.stdev,
          passAt1: metrics.pass_at_1,
          passPowK: metrics.pass_pow_k,
        });

        // Update the manifest's suite_score to the trial mean
        const manifest = manifests.get(entry.id);
        if (manifest) {
          manifest.suite_score = suiteScore;
        }
      } else {
        const manifest = manifests.get(entry.id);
        suiteScore = manifest?.suite_score ?? 1.0;
        isPassed = scoreThreshold !== undefined
          ? checkScoreThreshold(suiteScore, scoreThreshold)
          : (manifest?.outcome === "success");
      }

      scenarioVerdicts.push({
        scenarioId: entry.id,
        pack: "",
        suiteScore,
        passed: isPassed,
      });

      // --fail-fast: stop at the first failure rather than running the rest of the pack. The
      // remaining scenarios are still reported, as SKIPPED rather than passed, so a truncated
      // run cannot be mistaken for a green one.
      if (options.failFast && !isPassed) {
        const remaining = selectedEntries.slice(selectedEntries.indexOf(entry) + 1);
        console.log(
          `\n--fail-fast: stopping after ${entry.id} (${suiteScore.toFixed(3)}); ` +
            `${remaining.length} scenario(s) not run.`,
        );
        for (const skipped of remaining) {
          scenarioVerdicts.push({ scenarioId: `${skipped.id} (skipped)`, pack: "", suiteScore: 0, passed: false });
        }
        break;
      }
    }
    // 9. Compute run verdict
    const runVerdict: IRunVerdict = infraError
      ? { ...RunVerdict.INFRA_ERROR, scenarios: scenarioVerdicts }
      : accumulateRunVerdict(scenarioVerdicts);

    // 10. Print suite summary
    if (selectedEntries.length > 0) {
      reportSuiteSummary(scenarioVerdicts, scoreThreshold);
    }

    // 11. Write eval-report.json
    if (options.evalMode && manifests.size > 0) {
      await writeEvalReport(runtimeConfig.output_dir, {
        threshold: scoreThreshold,
        runVerdict,
      });
    }

    // 12. Write eval history entries if in eval mode
    if (options.evalMode) {
      await writeEvalHistoryEntries({
        manifests,
        scenarioVerdicts,
        trialMetricsMap,
        outputDir: runtimeConfig.output_dir,
        historyFormat: options.historyFormat,
        scoreThreshold,
      });
    }

    // 13. Reclaim the sandbox this run minted.
    //
    // Nothing removed one before, so growth was unbounded and proportional to how often anyone ran
    // scenarios — 103 sandboxes / 407 MB measured on one development machine, and each is now ~4 MB
    // because the runner seeds Blueprints, Memory and the git-backed portal fixtures into it. On a
    // CI runner that fills the disk and presents as an unrelated build failure.
    //
    // An infra error counts as "did not pass": that is precisely when the journal is needed.
    await reclaimSandbox({
      runtimeConfig,
      keepSandbox: options.keepSandbox === true,
      runPassed: runVerdict.allPassed && !runVerdict.infraError,
    });

    // 14. Exit with appropriate code
    if (runVerdict.infraError) {
      console.error("\nInfrastructure error encountered. Exiting with code 2.");
      Deno.exit(2);
    } else if (!runVerdict.allPassed) {
      Deno.exit(1);
    } else {
      console.log("\nAll scenarios completed successfully.");
      Deno.exit(0);
    }
  })
  .parse(Deno.args);

interface IReclaimSandboxOptions {
  runtimeConfig: IRuntimeConfig;
  keepSandbox: boolean;
  runPassed: boolean;
}

/**
 * Decide and perform the sandbox's fate, then say what happened.
 *
 * Always prints the path when the sandbox is retained: a retained sandbox nobody can find is the
 * same as a deleted one, and the whole point of keeping a failed run's state is that someone reads
 * the journal and the daemon log in it.
 */
async function reclaimSandbox(options: IReclaimSandboxOptions): Promise<void> {
  const plan = planSandboxCleanup({
    workspacePath: options.runtimeConfig.workspace_path,
    outputDir: options.runtimeConfig.output_dir,
    provenance: options.runtimeConfig.workspace_provenance,
    keepSandbox: options.keepSandbox,
    runPassed: options.runPassed,
  });

  try {
    const outcome = await applySandboxCleanup(plan, options.runtimeConfig.workspace_path);
    if (outcome.retention === SandboxRetention.REMOVED) {
      const preserved = plan.preserve.length > 0 ? ` (evidence kept at ${options.runtimeConfig.output_dir})` : "";
      console.log(`\nSandbox reclaimed: ${outcome.path}${preserved}`);
      return;
    }
    console.log(`\nSandbox kept at ${outcome.path} — ${describeRetention(outcome.retention)}`);
  } catch (error) {
    // Cleanup failing must never change a run's verdict; report and move on.
    console.error(`\nSandbox cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface IEvalReport {
  threshold: number | undefined;
  runVerdict: IRunVerdict;
  aggregateScore: number | undefined;
  timestamp: string;
}

async function writeEvalReport(
  outputDir: string,
  opts: { threshold: number | undefined; runVerdict: IRunVerdict },
): Promise<string> {
  const scores = opts.runVerdict.scenarios.map((s) => s.suiteScore);
  const aggregateScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;

  const report: IEvalReport = {
    threshold: opts.threshold,
    runVerdict: opts.runVerdict,
    aggregateScore,
    timestamp: new Date().toISOString(),
  };

  const reportPath = resolve(outputDir, "eval-report.json");
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nEval report written to: ${reportPath}`);
  return reportPath;
}
