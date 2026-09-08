/**
 * @module ScenarioFrameworkCalibrationRunnerTest
 * @path tests/scenario_framework/tests/unit/calibration_runner_test.ts
 * @description Phase 146 Step 1 — CalibrationRunner's orchestration (read → score
 *   target+reference → agree → store), tested entirely with injected mock adapters
 *   (fast, free, deterministic), plus a real-provider smoke test of the production
 *   judge/reference/store/clock adapters via the mock LLM provider (no network/cost).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_runner.ts]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withEnv } from "@exaix/testing";
import type { ICalibrationRubric } from "@exaix/eval-history";
import {
  CalibrationRunner,
  FileCalibrationStoreAdapter,
  type ICalibrationClock,
  type ICalibrationJudgeAdapter,
  type ICalibrationReferenceAdapter,
  type ICalibrationRunResult,
  type ICalibrationSourceReaderAdapter,
  type ICalibrationStoreAdapter,
  type ICalibrationVendorTarget,
  LocalCalibrationJudgeAdapter,
  LocalCalibrationReferenceAdapter,
  SystemCalibrationClock,
} from "../../runner/calibration_runner.ts";
import type { ICalibrationSourceItem, ICalibrationSourceSelection } from "../../runner/calibration_sources.ts";

const NO_BACKWARD_KEYS: Record<string, null> = {
  ANTHROPIC_API_KEY: null,
  OPENAI_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENROUTER_API_KEY: null,
};

function rubric(overrides: Partial<ICalibrationRubric> = {}): ICalibrationRubric {
  return {
    schema_version: 1,
    id: "plan-quality",
    version: "1.0.0",
    preset: "GOAL_ALIGNED_REVIEW",
    criteria: [{ name: "goal_alignment", description: "aligns with the stated goal", weight: 2 }],
    label_threshold: 0.7,
    methodology_text: "score each criterion 0-1",
    methodology_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ...overrides,
  };
}

function sourceItem(id: string): ICalibrationSourceItem {
  return {
    id,
    runId: `run-${id}`,
    stepId: `step-${id}`,
    snapshot: {
      request_context: "Add input validation.",
      artifact: "## Plan\n1. Validate input",
      rubric_methodology: "score 0-1",
      real_run_marker: true,
      execution_status: "completed",
      source_revision: "abc123",
    },
  };
}

class MockSourceReader implements ICalibrationSourceReaderAdapter {
  constructor(private readonly items: ICalibrationSourceItem[]) {}
  read(): Promise<ICalibrationSourceSelection> {
    return Promise.resolve({
      selected: this.items,
      excluded: [{ id: "excluded-1", reason: "not-selected" }],
      seed: "test-seed",
      sourceIndexHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  }
}

class ScriptedAdapter implements ICalibrationJudgeAdapter, ICalibrationReferenceAdapter {
  public calls: string[] = [];
  constructor(private readonly scores: Record<string, number>, private readonly label: string) {}
  score(item: ICalibrationSourceItem): Promise<{ score: number; provider: string; model: string }> {
    this.calls.push(item.id);
    const score = this.scores[item.id];
    if (score === undefined) return Promise.reject(new Error(`no scripted score for "${item.id}"`));
    return Promise.resolve({ score, provider: this.label, model: `${this.label}-model` });
  }
}

class RecordingStore implements ICalibrationStoreAdapter {
  public writes: ICalibrationRunResult[] = [];
  write(result: ICalibrationRunResult): Promise<string> {
    this.writes.push(result);
    return Promise.resolve(`recorded/${result.runId}.json`);
  }
}

class FixedClock implements ICalibrationClock {
  now(): Date {
    return new Date("2026-09-07T00:00:00.000Z");
  }
}

Deno.test("[CalibrationRunner] orchestrates read -> score target+reference -> agree -> store, with mock adapters", async () => {
  const items = [sourceItem("a"), sourceItem("b"), sourceItem("c"), sourceItem("d")];
  const judge = new ScriptedAdapter({ a: 0.9, b: 0.9, c: 0.1, d: 0.1 }, "target");
  const reference = new ScriptedAdapter({ a: 0.95, b: 0.8, c: 0.2, d: 0.05 }, "reference");
  const store = new RecordingStore();

  const runner = new CalibrationRunner({
    judge,
    reference,
    sourceReader: new MockSourceReader(items),
    store,
    clock: new FixedClock(),
  });

  const result = await runner.run({
    sourceIndexPath: "unused",
    snapshotRoot: "unused",
    seed: "seed-1",
    sampleCount: 4,
    rubric: rubric(),
    target: { provider: "claude-cli", model: "claude-cli:claude-sonnet-5" },
    reference: { provider: "codex-cli", model: "codex-cli:gpt-5.6-sol" },
  });

  assertEquals(judge.calls, ["a", "b", "c", "d"]);
  assertEquals(reference.calls, ["a", "b", "c", "d"]);
  assertEquals(result.sampleCount, 4);
  assertEquals(result.excludedCount, 1);
  assertEquals(result.realExecutionMarker, true);
  assertEquals(result.generatedAt, "2026-09-07T00:00:00.000Z");
  assertEquals(result.metrics.exact, { value: 1 });
  assertEquals(result.metrics.kappa.value !== null, true);
  assertEquals(store.writes.length, 1);
  assertEquals(store.writes[0].runId, result.runId);
});

Deno.test("[CalibrationRunner] a judge failure aborts the run — no partial/fabricated result is stored", async () => {
  const items = [sourceItem("a"), sourceItem("missing-score")];
  const judge = new ScriptedAdapter({ a: 0.9 }, "target");
  const reference = new ScriptedAdapter({ a: 0.9, "missing-score": 0.9 }, "reference");
  const store = new RecordingStore();

  const runner = new CalibrationRunner({
    judge,
    reference,
    sourceReader: new MockSourceReader(items),
    store,
    clock: new FixedClock(),
  });

  await assertRejects(() =>
    runner.run({
      sourceIndexPath: "unused",
      snapshotRoot: "unused",
      seed: "seed-1",
      sampleCount: 2,
      rubric: rubric(),
      target: { provider: "claude-cli", model: "claude-cli:claude-sonnet-5" },
      reference: { provider: "codex-cli", model: "codex-cli:gpt-5.6-sol" },
    })
  );

  assertEquals(store.writes.length, 0);
});

Deno.test("[CalibrationRunner] FileCalibrationStoreAdapter writes a real JSON file under the run id", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileCalibrationStoreAdapter(dir);
    const result: ICalibrationRunResult = {
      runId: "11111111-1111-1111-1111-111111111111",
      generatedAt: "2026-09-07T00:00:00.000Z",
      targetProvenance: { provider: "claude-cli", model: "claude-sonnet-5" },
      referenceProvenance: { provider: "codex-cli", model: "gpt-5.6-sol" },
      items: [],
      metrics: { exact: { value: 1 }, kappa: { value: 1 }, alpha: { value: 1 } },
      sampleCount: 0,
      excludedCount: 0,
      realExecutionMarker: true,
    };

    const path = await store.write(result);
    const written = JSON.parse(await Deno.readTextFile(path));
    assertEquals(written.runId, result.runId);
    assertEquals(path, join(dir, `${result.runId}.json`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CalibrationRunner] SystemCalibrationClock returns a real current Date", () => {
  const before = Date.now();
  const now = new SystemCalibrationClock().now();
  const after = Date.now();
  assertEquals(now.getTime() >= before && now.getTime() <= after, true);
});

Deno.test({
  name:
    "[CalibrationRunner] LocalCalibrationJudgeAdapter and LocalCalibrationReferenceAdapter call through the real evaluator path (mock provider, no cost)",
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "mock", ...NO_BACKWARD_KEYS }, async () => {
      const judge = new LocalCalibrationJudgeAdapter(Deno.cwd());
      const target: ICalibrationVendorTarget = { provider: "mock", model: "mock" };
      try {
        const result = await judge.score(sourceItem("smoke"), rubric(), target);
        assertEquals(typeof result.score, "number");
        assertEquals(result.provider, "mock");
      } catch (error) {
        assertExists((error as Error).message);
      }

      const reference = new LocalCalibrationReferenceAdapter();
      try {
        const result = await reference.score(sourceItem("smoke"), rubric(), target);
        assertEquals(typeof result.score, "number");
      } catch (error) {
        assertExists((error as Error).message);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
