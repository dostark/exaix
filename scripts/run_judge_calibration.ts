#!/usr/bin/env -S deno run -A
/**
 * @module RunJudgeCalibration
 * @path scripts/run_judge_calibration.ts
 * @description Phase 146 Step 1's `eval calibration score` bridge: compiles a
 *   `--capture-calibration-evidence` output directory into CalibrationRunner's input
 *   shape and runs it with the real target judge and reference evaluator, printing the
 *   resulting report as JSON on stdout. Bridges the `apps/exactl` CLI (which must not
 *   import the Test layer) to `tests/scenario_framework/runner/calibration_runner.ts`,
 *   the same "report-script bridge" pattern run_ablation_report.ts/
 *   run_harness_lift_report.ts already use.
 * @architectural-layer Script
 * @related-files [tests/scenario_framework/runner/calibration_runner.ts, tests/scenario_framework/runner/calibration_sandbox.ts, apps/exactl/src/commands/eval_commands.ts]
 *
 * Usage:
 *   deno run -A scripts/run_judge_calibration.ts score --capture-dir <dir> --target <provider:model> \
 *     --reference <provider:model> --seed <string> [--sample-count <n>] [--label-threshold <n>] \
 *     [--isolated] [--output <dir>]
 */

import { resolve } from "@std/path";
import { CalibrationScoreOptionsSchema, DEFAULT_CALIBRATION_SAMPLE_COUNT, sha256Hex } from "@exaix/eval-history";
import type { ICalibrationRubric } from "@exaix/eval-history";
import { resolveCriterionPreset } from "@exaix/core/evaluation";
import { ConfigService } from "@exaix/core/config";
import { EventLogger } from "@exaix/core/logger";
import { DatabaseService } from "@exaix/storage-sqlite";
import {
  CALIBRATION_SOURCE_INDEX_JSONL_NAME,
  compileCalibrationSourceIndex,
} from "../tests/scenario_framework/runner/calibration_sources.ts";
import {
  CalibrationRunner,
  FileCalibrationStoreAdapter,
  LocalCalibrationJudgeAdapter,
  LocalCalibrationReferenceAdapter,
  RealCalibrationSourceReaderAdapter,
  SystemCalibrationClock,
} from "../tests/scenario_framework/runner/calibration_runner.ts";
import { SandboxedCalibrationReferenceAdapter } from "../tests/scenario_framework/runner/calibration_sandbox.ts";
import { loadJudgeMethodologyInstructions } from "../tests/scenario_framework/runner/assertions.ts";

const RUBRIC_PRESET = "GOAL_ALIGNED_REVIEW";
const DEFAULT_LABEL_THRESHOLD = 0.7;
const DEFAULT_REPORT_DIR = resolve(Deno.cwd(), ".exa", "judge_calibration_reports");
const DEFAULT_SANDBOX_SCRATCH_ROOT = "/tmp";
const USAGE =
  "Usage: deno run -A scripts/run_judge_calibration.ts score --capture-dir <dir> --target <provider:model> " +
  "--reference <provider:model> --seed <string> [--sample-count <n>] [--label-threshold <n>] [--isolated] " +
  "[--output <dir>]";

interface IRawArgs {
  captureDir?: string;
  target?: string;
  reference?: string;
  seed?: string;
  sampleCount?: string;
  labelThreshold?: string;
  isolated: boolean;
  output?: string;
}

function parseArgs(argv: string[]): IRawArgs {
  const args: IRawArgs = { isolated: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--capture-dir" && value !== undefined) {
      args.captureDir = value;
      i++;
    } else if (flag === "--target" && value !== undefined) {
      args.target = value;
      i++;
    } else if (flag === "--reference" && value !== undefined) {
      args.reference = value;
      i++;
    } else if (flag === "--seed" && value !== undefined) {
      args.seed = value;
      i++;
    } else if (flag === "--sample-count" && value !== undefined) {
      args.sampleCount = value;
      i++;
    } else if (flag === "--label-threshold" && value !== undefined) {
      args.labelThreshold = value;
      i++;
    } else if (flag === "--output" && value !== undefined) {
      args.output = value;
      i++;
    } else if (flag === "--isolated") {
      args.isolated = true;
    }
  }
  return args;
}

/** provider:model → {provider, model}; `model` keeps the full "provider:model" string,
 *  matching the convention ICalibrationVendorTarget already uses elsewhere. */
function parseVendorTarget(raw: string): { provider: string; model: string } {
  return { provider: raw.slice(0, raw.indexOf(":")), model: raw };
}

async function buildRubric(labelThreshold: number): Promise<ICalibrationRubric> {
  const criteria = resolveCriterionPreset(RUBRIC_PRESET).map((c) => ({
    name: c.name,
    description: c.description,
    weight: c.weight,
  }));
  const methodologyText = (await loadJudgeMethodologyInstructions(Deno.cwd())) || RUBRIC_PRESET;
  const methodologyHash = await sha256Hex(methodologyText);
  return {
    schema_version: 1,
    id: "plan-quality",
    version: "1.0.0",
    preset: RUBRIC_PRESET,
    criteria,
    label_threshold: labelThreshold,
    methodology_text: methodologyText,
    methodology_hash: methodologyHash,
  };
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = Deno.args;
  if (subcommand !== "score") {
    console.error(USAGE);
    Deno.exit(1);
  }

  const raw = parseArgs(rest);
  if (!raw.captureDir || !raw.target || !raw.reference || !raw.seed) {
    console.error(USAGE);
    Deno.exit(1);
  }

  const parsed = CalibrationScoreOptionsSchema.safeParse({
    capture_dir: raw.captureDir,
    seed: raw.seed,
    sample_count: raw.sampleCount ? Number(raw.sampleCount) : DEFAULT_CALIBRATION_SAMPLE_COUNT,
    target: raw.target,
    reference: raw.reference,
    isolated: raw.isolated,
    label_threshold: raw.labelThreshold ? Number(raw.labelThreshold) : DEFAULT_LABEL_THRESHOLD,
  });
  if (!parsed.success) {
    console.error(`Invalid calibration score options: ${parsed.error.message}`);
    Deno.exit(1);
  }
  const options = parsed.data;

  const jsonlPath = resolve(options.capture_dir, CALIBRATION_SOURCE_INDEX_JSONL_NAME);
  const entries = await compileCalibrationSourceIndex(jsonlPath);
  const compiledIndexPath = resolve(options.capture_dir, "compiled-source-index.json");
  await Deno.writeTextFile(compiledIndexPath, JSON.stringify(entries));

  const rubric = await buildRubric(options.label_threshold);
  const reference = options.isolated
    ? new SandboxedCalibrationReferenceAdapter(DEFAULT_SANDBOX_SCRATCH_ROOT)
    : new LocalCalibrationReferenceAdapter();

  // Same EventLogger construction as apps/exactl/src/init.ts's composition root — a real,
  // persisted audit trail for this security-sensitive orchestration, not console-only.
  const config = new ConfigService().get();
  const db = new DatabaseService(config);
  const logger = new EventLogger({ db });

  const runner = new CalibrationRunner({
    judge: new LocalCalibrationJudgeAdapter(Deno.cwd()),
    reference,
    sourceReader: new RealCalibrationSourceReaderAdapter(),
    store: new FileCalibrationStoreAdapter(raw.output ?? DEFAULT_REPORT_DIR),
    clock: new SystemCalibrationClock(),
    logger,
  });

  try {
    const result = await runner.run({
      sourceIndexPath: compiledIndexPath,
      snapshotRoot: options.capture_dir,
      seed: options.seed,
      sampleCount: options.sample_count,
      rubric,
      target: parseVendorTarget(options.target),
      reference: parseVendorTarget(options.reference),
    });
    console.log(JSON.stringify(result));
  } finally {
    await db.waitForFlush();
    await db.close();
  }
}

await main();
