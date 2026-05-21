/**
 * @module AnalysisPersistenceTest
 * @path tests/services/request_analysis/analysis_persistence_test.ts
 * @description Tests for `saveAnalysis` / `loadAnalysis` — the atomic
 * file-system persistence helpers that store `IRequestAnalysis` as a
 * `_analysis.json` sibling to the request `.md` file.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { loadAnalysis, saveAnalysis } from "@exaix/request";
import { ANALYZER_VERSION } from "@exaix/core";
import { RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<IRequestAnalysis> = {}): IRequestAnalysis {
  return {
    goals: [{ description: "Add caching", explicit: true, priority: 1 }],
    requirements: [{ description: "Must be atomic", confidence: 0.95, type: "functional", explicit: true }],
    constraints: ["No new deps"],
    acceptanceCriteria: ["Tests pass"],
    ambiguities: [],
    actionabilityScore: 85,
    complexity: RequestAnalysisComplexity.MEDIUM,
    taskType: RequestTaskType.FEATURE,
    tags: ["cache"],
    referencedFiles: ["src/services/cache_service.ts"],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 12,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

Deno.test("[AnalysisPersistence] derives correct _analysis.json path from .md path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "my-request.md");
    await Deno.writeTextFile(requestPath, "# Request");

    await saveAnalysis(requestPath, makeAnalysis());

    const expectedPath = join(dir, "my-request_analysis.json");
    const stat = await Deno.stat(expectedPath);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Save & Load round-trip
// ---------------------------------------------------------------------------

Deno.test("[AnalysisPersistence] saves analysis as JSON sibling file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const analysis = makeAnalysis();

    await saveAnalysis(requestPath, analysis);

    const jsonPath = join(dir, "req_analysis.json");
    const raw = await Deno.readTextFile(jsonPath);
    const parsed = JSON.parse(raw);
    assertEquals(parsed.actionabilityScore, 85);
    assertEquals(parsed.taskType, RequestTaskType.FEATURE);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[AnalysisPersistence] loads previously saved analysis", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const analysis = makeAnalysis();

    await saveAnalysis(requestPath, analysis);
    const loaded = await loadAnalysis(requestPath);

    assertExists(loaded);
    assertEquals(loaded!.actionabilityScore, 85);
    assertEquals(loaded!.complexity, RequestAnalysisComplexity.MEDIUM);
    assertEquals(loaded!.goals.length, 1);
    assertEquals(loaded!.metadata.mode, AnalysisMode.HEURISTIC);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[AnalysisPersistence] analysis data round-trips without loss", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const original = makeAnalysis();

    await saveAnalysis(requestPath, original);
    const loaded = await loadAnalysis(requestPath);

    assertExists(loaded);
    assertEquals(loaded!.referencedFiles, original.referencedFiles);
    assertEquals(loaded!.constraints, original.constraints);
    assertEquals(loaded!.tags, original.tags);
    assertEquals(loaded!.metadata.durationMs, original.metadata.durationMs);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Missing / invalid files
// ---------------------------------------------------------------------------

Deno.test("[AnalysisPersistence] returns null for missing analysis file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "nonexistent.md");
    const result = await loadAnalysis(requestPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[AnalysisPersistence] returns null for corrupted analysis file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const jsonPath = join(dir, "req_analysis.json");
    await Deno.writeTextFile(jsonPath, "{ not valid json {{");

    const result = await loadAnalysis(requestPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[AnalysisPersistence] returns null for JSON not matching schema", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const jsonPath = join(dir, "req_analysis.json");
    await Deno.writeTextFile(jsonPath, JSON.stringify({ foo: "bar" }));

    const result = await loadAnalysis(requestPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

Deno.test("[AnalysisPersistence] uses atomic write (temp file then rename)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const requestPath = join(dir, "req.md");
    const analysis = makeAnalysis();

    await saveAnalysis(requestPath, analysis);

    // After completion, only the final .json should exist; no .tmp left behind
    const entries: string[] = [];
    for await (const e of Deno.readDir(dir)) {
      entries.push(e.name);
    }
    assertEquals(entries.some((n) => n.endsWith(".tmp")), false);
    assertEquals(entries.includes("req_analysis.json"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
