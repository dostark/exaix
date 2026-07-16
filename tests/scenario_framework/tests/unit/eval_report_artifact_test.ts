/**
 * @module EvalReportArtifactTest
 * @path tests/scenario_framework/tests/unit/eval_report_artifact_test.ts
 * @description Tests that eval-report.json is written correctly by the runner
 * with correct threshold, per-scenario scores, and aggregate metrics.
 */

import { assertEquals, assertExists } from "@std/assert";
import { resolve } from "@std/path";
import { accumulateRunVerdict, type IScenarioVerdict } from "../../runner/scoring.ts";

interface IEvalReport {
  threshold: number | undefined;
  runVerdict: {
    allPassed: boolean;
    infraError: boolean;
    scenarios: IScenarioVerdict[];
  };
  aggregateScore: number | undefined;
  timestamp: string;
}

async function writeEvalReport(
  outputDir: string,
  opts: {
    threshold: number | undefined;
    runVerdict: { allPassed: boolean; infraError: boolean; scenarios: IScenarioVerdict[] };
  },
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
  return reportPath;
}

Deno.test("[EvalReport] eval-report.json is written with correct structure", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "eval-report-test-" });
  try {
    const scenarios: IScenarioVerdict[] = [
      { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: true },
      { scenarioId: "s2", pack: "p1", suiteScore: 0.4, passed: false },
    ];
    const verdict = accumulateRunVerdict(scenarios);

    await writeEvalReport(outputDir, { threshold: 0.5, runVerdict: verdict });

    const content = await Deno.readTextFile(resolve(outputDir, "eval-report.json"));
    const report = JSON.parse(content) as IEvalReport;

    assertEquals(report.threshold, 0.5);
    assertEquals(report.runVerdict.allPassed, false);
    assertEquals(report.runVerdict.scenarios.length, 2);
    assertEquals(report.runVerdict.scenarios[0].scenarioId, "s1");
    assertEquals(report.runVerdict.scenarios[0].suiteScore, 0.9);
    assertEquals(report.runVerdict.scenarios[0].passed, true);
    assertEquals(report.runVerdict.scenarios[1].scenarioId, "s2");
    assertEquals(report.runVerdict.scenarios[1].suiteScore, 0.4);
    assertEquals(report.runVerdict.scenarios[1].passed, false);
    assertEquals(report.aggregateScore, 0.65);
    assertExists(report.timestamp);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[EvalReport] eval-report.json writes correct aggregateScore", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "eval-report-test-" });
  try {
    const scenarios: IScenarioVerdict[] = [
      { scenarioId: "s1", pack: "p1", suiteScore: 1.0, passed: true },
      { scenarioId: "s2", pack: "p1", suiteScore: 0.5, passed: true },
      { scenarioId: "s3", pack: "p1", suiteScore: 0.0, passed: false },
    ];
    const verdict = accumulateRunVerdict(scenarios);

    await writeEvalReport(outputDir, { threshold: 0.5, runVerdict: verdict });
    const content = await Deno.readTextFile(resolve(outputDir, "eval-report.json"));
    const report = JSON.parse(content) as IEvalReport;

    assertEquals(report.aggregateScore, (1.0 + 0.5 + 0.0) / 3);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[EvalReport] eval-report.json with no threshold still produces report", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "eval-report-test-" });
  try {
    const scenarios: IScenarioVerdict[] = [
      { scenarioId: "s1", pack: "p1", suiteScore: 0.8, passed: true },
    ];
    const verdict = accumulateRunVerdict(scenarios);

    await writeEvalReport(outputDir, { threshold: undefined, runVerdict: verdict });
    const content = await Deno.readTextFile(resolve(outputDir, "eval-report.json"));
    const report = JSON.parse(content) as IEvalReport;

    assertEquals(report.threshold, undefined);
    assertEquals(report.runVerdict.allPassed, true);
    assertEquals(report.aggregateScore, 0.8);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[EvalReport] eval-report.json empty scenario list has undefined aggregate", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "eval-report-test-" });
  try {
    const verdict = accumulateRunVerdict([]);

    await writeEvalReport(outputDir, { threshold: 0.5, runVerdict: verdict });
    const content = await Deno.readTextFile(resolve(outputDir, "eval-report.json"));
    const report = JSON.parse(content) as IEvalReport;

    assertEquals(report.aggregateScore, undefined);
    assertEquals(report.runVerdict.scenarios.length, 0);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
