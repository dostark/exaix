/**
 * @module ScenarioFrameworkHistoryWriterTest
 * @path tests/scenario_framework/tests/unit/history_writer_test.ts
 * @description Tests for eval history JSONL writing. Verifies that
 * history entries are written atomically to both scenario-specific
 * and global history files in eval mode.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer.ts, tests/scenario_framework/schema/history_schema.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import { EvalHistoryEntrySchema } from "../../schema/history_schema.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeTestManifest(overrides: Partial<IRunManifest> = {}): IRunManifest {
  return {
    scenarioId: "test-scenario",
    pack: "smoke",
    mode: "auto",
    outcome: "success",
    steps: [
      {
        stepId: "step-1",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        criterionResults: [
          {
            criterion_id: "check-1",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "file exists",
            evidence_refs: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

Deno.test("[ScenarioFrameworkHistoryWriter] writes valid JSONL entry to history directory", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest();
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "test-scenario",
      manifest,
    });

    // Validate schema
    const parsed = EvalHistoryEntrySchema.parse(entry);
    assertEquals(parsed.scenario_id, "test-scenario");
    assertEquals(parsed.outcome, "success");
    assertEquals(parsed.passed, true);
    assertEquals(parsed.mode, "auto");

    // Check global history file exists and is valid JSONL
    const globalHistoryPath = join(outputDir, "history", "eval-history.jsonl");
    const globalContent = await Deno.readTextFile(globalHistoryPath);
    const lines = globalContent.trim().split("\n");
    assertEquals(lines.length, 1);
    const parsedLine = JSON.parse(lines[0]);
    assertEquals(parsedLine.scenario_id, "test-scenario");

    // Check scenario-specific history file
    const scenarioHistoryPath = join(outputDir, "history", "test-scenario", "eval-history.jsonl");
    const scenarioContent = await Deno.readTextFile(scenarioHistoryPath);
    assertEquals(scenarioContent, globalContent);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] appends to existing history file on second write", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest1 = makeTestManifest({ scenarioId: "scenario-a", outcome: "success" });
    const manifest2 = makeTestManifest({ scenarioId: "scenario-b", outcome: "scenario-failure" });

    await writeEvalHistoryEntry({ outputDir, scenarioId: "scenario-a", manifest: manifest1 });
    await writeEvalHistoryEntry({ outputDir, scenarioId: "scenario-b", manifest: manifest2 });

    const globalHistoryPath = join(outputDir, "history", "eval-history.jsonl");
    const globalContent = await Deno.readTextFile(globalHistoryPath);
    const lines = globalContent.trim().split("\n");
    assertEquals(lines.length, 2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assertEquals(first.scenario_id, "scenario-a");
    assertEquals(second.scenario_id, "scenario-b");
    assertEquals(first.passed, true);
    assertEquals(second.passed, false);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] entry includes run_id, scenario_id, outcome, mode, passed, timestamp", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest();
    const entry = await writeEvalHistoryEntry({ outputDir, scenarioId: "test-scenario", manifest });

    assertStringIncludes(entry.run_id, "-"); // UUID format
    assertEquals(entry.scenario_id, "test-scenario");
    assertEquals(entry.outcome, "success");
    assertEquals(entry.mode, "auto");
    assertEquals(entry.passed, true);
    assertEquals(typeof entry.timestamp, "string");
    assertEquals(entry.timestamp.length > 0, true);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] component_versions include binary_version and schema_version", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest();
    const entry = await writeEvalHistoryEntry({ outputDir, scenarioId: "test-scenario", manifest });

    assertEquals(typeof entry.component_versions, "object");
    assertEquals(typeof entry.component_versions!.binary_version, "string");
    assertEquals(typeof entry.component_versions!.schema_version, "string");
    assertEquals(entry.component_versions!.binary_version.length > 0, true);
    assertEquals(entry.component_versions!.schema_version.length > 0, true);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] passed is false when outcome is not success", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest({ outcome: "scenario-failure" });
    const entry = await writeEvalHistoryEntry({ outputDir, scenarioId: "test-scenario", manifest });

    assertEquals(entry.passed, false);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] suite_score is included when present in manifest", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest({ suite_score: 0.85 });
    const entry = await writeEvalHistoryEntry({ outputDir, scenarioId: "test-scenario", manifest });

    assertEquals(entry.suite_score, 0.85);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] suite_score is absent when not in manifest", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest: IRunManifest = {
      scenarioId: "test-scenario",
      pack: "smoke",
      mode: "auto",
      outcome: "success",
      steps: [],
    };
    const entry = await writeEvalHistoryEntry({ outputDir, scenarioId: "test-scenario", manifest });

    assertEquals(entry.suite_score, undefined);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkHistoryWriter] writes separate scenario history file under history/<scenario-id>/", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-history-" });

  try {
    const manifest = makeTestManifest({ scenarioId: "multi-scenario" });
    await writeEvalHistoryEntry({ outputDir, scenarioId: "multi-scenario", manifest });

    const scenarioDir = join(outputDir, "history", "multi-scenario");
    const dirEntries = [];
    for await (const entry of Deno.readDir(scenarioDir)) {
      dirEntries.push(entry.name);
    }
    assertEquals(dirEntries, ["eval-history.jsonl"]);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
