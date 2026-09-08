/**
 * @module CalibrationEventsIntegrationTest
 * @path tests/integration/calibration_events_test.ts
 * @description Phase 146 Step 1 — real EventLogger persistence for CalibrationRunner's
 *   typed lifecycle: eval.calibration.started/reference_completed/scored on a successful
 *   run, eval.calibration.failed (with the failing operation and a sanitized error code,
 *   never the raw prompt/artifact) on a mid-run failure, all correlated by the run's own
 *   id as the trace id.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_runner.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import type { JSONObject } from "@exaix/core";
import type { LogMetadata } from "@exaix/core/types";
import type { ICalibrationRubric } from "@exaix/eval-history";
import {
  CalibrationRunner,
  type ICalibrationClock,
  type ICalibrationJudgeAdapter,
  type ICalibrationReferenceAdapter,
  type ICalibrationRunResult,
  type ICalibrationSourceReaderAdapter,
  type ICalibrationStoreAdapter,
} from "../scenario_framework/runner/calibration_runner.ts";
import type {
  ICalibrationSourceItem,
  ICalibrationSourceSelection,
} from "../scenario_framework/runner/calibration_sources.ts";

const CALIBRATION_STARTED_ACTION = "eval.calibration.started";

/** Captures the run id off the started event's payload (CalibrationRunner generates it
 *  internally and never returns it on a failed run), while delegating every real write to
 *  the wrapped EventLogger so persistence assertions below observe the real thing. */
class RunIdCapturingLogger implements IEventLogger {
  public runId: string | undefined;
  constructor(private readonly inner: IEventLogger) {}

  log(event: Parameters<IEventLogger["log"]>[0]): Promise<void> {
    return this.inner.log(event);
  }

  info(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
    if (action === CALIBRATION_STARTED_ACTION && payload && typeof payload.run_id === "string") {
      this.runId = payload.run_id;
    }
    return this.inner.info(action, target, payload, traceId);
  }

  warn(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
    return this.inner.warn(action, target, payload, traceId);
  }

  error(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
    return this.inner.error(action, target, payload, traceId);
  }

  fatal(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
    return this.inner.fatal(action, target, payload, traceId);
  }

  debug(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
    return this.inner.debug(action, target, payload, traceId);
  }

  child(overrides: Parameters<IEventLogger["child"]>[0]): IEventLogger {
    return this.inner.child(overrides);
  }
}

function rubric(): ICalibrationRubric {
  return {
    schema_version: 1,
    id: "plan-quality",
    version: "1.0.0",
    preset: "GOAL_ALIGNED_REVIEW",
    criteria: [{ name: "goal_alignment", description: "aligns with the stated goal", weight: 2 }],
    label_threshold: 0.7,
    methodology_text: "score each criterion 0-1",
    methodology_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };
}

function sourceItem(id: string): ICalibrationSourceItem {
  return {
    id,
    runId: `run-${id}`,
    stepId: `step-${id}`,
    snapshot: {
      request_context: "SENTINEL-REQUEST-CONTEXT-must-never-appear-in-an-event-payload",
      artifact: "SENTINEL-ARTIFACT-must-never-appear-in-an-event-payload",
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
      excluded: [],
      seed: "test-seed",
      sourceIndexHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  }
}

class ScriptedAdapter implements ICalibrationJudgeAdapter, ICalibrationReferenceAdapter {
  constructor(private readonly scores: Record<string, number>, private readonly label: string) {}
  score(item: ICalibrationSourceItem): Promise<{ score: number; provider: string; model: string }> {
    const score = this.scores[item.id];
    if (score === undefined) return Promise.reject(new Error(`no scripted score for "${item.id}"`));
    return Promise.resolve({ score, provider: this.label, model: `${this.label}-model` });
  }
}

class NoopStore implements ICalibrationStoreAdapter {
  write(result: ICalibrationRunResult): Promise<string> {
    return Promise.resolve(`recorded/${result.runId}.json`);
  }
}

class FixedClock implements ICalibrationClock {
  now(): Date {
    return new Date("2026-09-08T00:00:00.000Z");
  }
}

Deno.test("[CalibrationEvents] a successful run logs started -> reference_completed(xN) -> scored, all under the run id as trace", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new RunIdCapturingLogger(new EventLogger({ db }));
    const items = [sourceItem("a"), sourceItem("b")];
    const runner = new CalibrationRunner({
      judge: new ScriptedAdapter({ a: 0.9, b: 0.1 }, "target"),
      reference: new ScriptedAdapter({ a: 0.95, b: 0.05 }, "reference"),
      sourceReader: new MockSourceReader(items),
      store: new NoopStore(),
      clock: new FixedClock(),
      logger,
    });

    const result = await runner.run({
      sourceIndexPath: "unused",
      snapshotRoot: "unused",
      seed: "seed-1",
      sampleCount: 2,
      rubric: rubric(),
      target: { provider: "claude-cli", model: "claude-cli:claude-sonnet-5" },
      reference: { provider: "codex-cli", model: "codex-cli:gpt-5.6-sol" },
    });

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace(result.runId);
    const actions = activities.map((a) => a.action_type);

    assertEquals(actions.filter((a) => a === "eval.calibration.started").length, 1);
    assertEquals(actions.filter((a) => a === "eval.calibration.reference_completed").length, 2);
    assertEquals(actions.filter((a) => a === "eval.calibration.scored").length, 1);
    assertEquals(actions.includes("eval.calibration.failed"), false);

    const started = activities.find((a) => a.action_type === "eval.calibration.started");
    assertExists(started);
    const startedPayload = JSON.parse(started.payload) as JSONObject;
    assertEquals(startedPayload.run_id, result.runId);
    assertEquals(startedPayload.target_vendor, "claude-cli");
    assertEquals(startedPayload.reference_vendor, "codex-cli");

    const scored = activities.find((a) => a.action_type === "eval.calibration.scored");
    assertExists(scored);
    const scoredPayload = JSON.parse(scored.payload) as JSONObject;
    assertEquals(scoredPayload.sample_count, 2);
    assertEquals(scoredPayload.excluded_count, 0);
    assertExists((scoredPayload.metric_outcome as JSONObject).exact);

    for (const activity of activities) {
      assertEquals(activity.payload.includes("SENTINEL-"), false, "payload must never leak snapshot text");
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[CalibrationEvents] a mid-run judge failure logs eval.calibration.failed with a sanitized error_code, never scored", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new RunIdCapturingLogger(new EventLogger({ db }));
    const items = [sourceItem("a"), sourceItem("missing-score")];
    const runner = new CalibrationRunner({
      judge: new ScriptedAdapter({ a: 0.9 }, "target"),
      reference: new ScriptedAdapter({ a: 0.9, "missing-score": 0.9 }, "reference"),
      sourceReader: new MockSourceReader(items),
      store: new NoopStore(),
      clock: new FixedClock(),
      logger,
    });

    try {
      await runner.run({
        sourceIndexPath: "unused",
        snapshotRoot: "unused",
        seed: "seed-1",
        sampleCount: 2,
        rubric: rubric(),
        target: { provider: "claude-cli", model: "claude-cli:claude-sonnet-5" },
        reference: { provider: "codex-cli", model: "codex-cli:gpt-5.6-sol" },
      });
    } catch {
      // Expected — the scripted judge has no score for "missing-score".
    }

    await db.waitForFlush();
    assertExists(logger.runId, "expected a started event to have been logged before the failure");

    const activities = db.getActivitiesByTrace(logger.runId);
    const actions = activities.map((a) => a.action_type);

    assertEquals(actions.includes("eval.calibration.started"), true);
    assertEquals(actions.includes("eval.calibration.scored"), false);
    assertEquals(actions.filter((a) => a === "eval.calibration.failed").length, 1);

    const failed = activities.find((a) => a.action_type === "eval.calibration.failed");
    assertExists(failed);
    const failedPayload = JSON.parse(failed.payload) as JSONObject;
    assertEquals(failedPayload.operation, "judge");
    assertEquals(typeof failedPayload.error_code, "string");
    assertEquals((failedPayload.error_code as string).length > 0, true);
    // Never the raw Error.message (which could echo item ids/context) — a fixed classification only.
    assertEquals((failedPayload.error_code as string).includes("no scripted score"), false);
  } finally {
    await cleanup();
  }
});
