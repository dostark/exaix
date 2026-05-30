/**
 * @module PatternDetectorTest
 * @path packages/portal/knowledge/tests/pattern_detector_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for the PatternDetector (Strategy 4): heuristic detection
 * of code conventions and naming patterns from file structure and optional
 * file contents. Covers naming, layout, test conventions, barrel exports,
 * content-based import detection, evidenceCount, and confidence thresholds.
 */

import { assertEquals, assertExists } from "@std/assert";
import { computeAdaptiveSampleSize, detectPatterns, selectSampleFiles } from "@exaix/portal/knowledge";
import type { IFileSignificance } from "@exaix/schemas/portal_knowledge.ts";

// Minimal key-file stubs used across tests
const NO_KEY_FILES: IFileSignificance[] = [];

// ---------------------------------------------------------------------------
// Service naming pattern
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects service naming pattern", () => {
  const files = [
    "src/services/auth_service.ts",
    "src/services/user_service.ts",
    "src/services/billing_service.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("service"));
  assertExists(convention, "Expected a service naming convention to be detected");
  assertEquals(convention.evidenceCount, 3);
  assertEquals(convention.category, "naming");
});

// ---------------------------------------------------------------------------
// Repository naming pattern
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects repository naming pattern", () => {
  const files = [
    "src/repositories/user_repository.ts",
    "src/repositories/order_repository.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("repository"));
  assertExists(convention, "Expected a repository naming convention to be detected");
  assertEquals(convention.evidenceCount, 2);
});

// ---------------------------------------------------------------------------
// Test layout patterns
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects co-located test layout", () => {
  const files = [
    "src/services/auth_service.ts",
    "src/services/__tests__/auth_service.test.ts",
    "src/controllers/__tests__/login.test.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) =>
    c.name.toLowerCase().includes("co-located") || c.description.toLowerCase().includes("co-located")
  );
  assertExists(convention, "Expected co-located test layout convention");
  assertEquals(convention.category, "structure");
});

Deno.test("[PatternDetector] detects mirror test layout", () => {
  const files = [
    "src/services/auth.ts",
    "src/utils/helpers.ts",
    "tests/services/auth_test.ts",
    "tests/utils/helpers_test.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) =>
    c.name.toLowerCase().includes("mirror") || c.description.toLowerCase().includes("mirror")
  );
  assertExists(convention, "Expected mirror test layout convention");
  assertEquals(convention.category, "structure");
});

// ---------------------------------------------------------------------------
// Test file naming convention
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects test file naming convention", () => {
  const files = [
    "src/services/auth_test.ts",
    "src/utils/helpers_test.ts",
    "src/models/user_test.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.category === "testing");
  assertExists(convention, "Expected a testing convention");
  assertEquals(convention.category, "testing");
  // Should mention the naming pattern
  const mentionsUnderscore = convention.description.includes("_test") ||
    convention.name.includes("_test");
  assertEquals(mentionsUnderscore, true);
});

// ---------------------------------------------------------------------------
// Barrel export pattern
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects barrel export pattern", () => {
  const files = [
    "src/services/mod.ts",
    "src/utils/mod.ts",
    "src/models/mod.ts",
    "src/mod.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) =>
    c.name.toLowerCase().includes("barrel") || c.name.toLowerCase().includes("mod.ts")
  );
  assertExists(convention, "Expected barrel export convention for mod.ts files");
  assertEquals(convention.category, "structure");
});

// ---------------------------------------------------------------------------
// Example file paths
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] provides examples for each convention", () => {
  const files = [
    "src/services/auth_service.ts",
    "src/services/user_service.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("service"));
  assertExists(convention);
  assertEquals(convention.examples.length > 0, true, "Should have at least one example");
  // Examples should be actual file paths from the input
  const exampleInInput = convention.examples.some((ex) => files.includes(ex));
  assertEquals(exampleInInput, true, "Examples should reference input file paths");
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] assigns correct categories", () => {
  const files = [
    "src/services/auth_service.ts",
    "src/services/user_service.ts",
    "src/mod.ts",
    "src/utils/mod.ts",
    "tests/services/auth_test.ts",
    "tests/services/user_test.ts",
    "tests/services/billing_test.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);

  const namingConventions = result.filter((c) => c.category === "naming");
  const structureConventions = result.filter((c) => c.category === "structure");

  assertEquals(namingConventions.length > 0, true, "Should have at least one naming convention");
  assertEquals(
    structureConventions.length > 0,
    true,
    "Should have at least one structure convention",
  );
});

// ---------------------------------------------------------------------------
// Heuristic-only mode (no readFileContents)
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] works in heuristic-only mode", () => {
  const files = [
    "src/services/auth_service.ts",
    "src/services/user_service.ts",
  ];
  // Should not throw and should return results without any callback
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  assertEquals(Array.isArray(result), true);
  assertEquals(result.length > 0, true);
});

// ---------------------------------------------------------------------------
// Content-based import detection via readFileContents callback
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] detects import patterns when reading file contents", async () => {
  const files = [
    "src/services/auth_service.ts",
    "src/utils/helpers.ts",
  ];
  const contents: Record<string, string> = {
    "src/services/auth_service.ts": 'import { Logger } from "@shared/logger.ts";\n',
    "src/utils/helpers.ts": 'import { config } from "@config/index.ts";\n',
  };
  const readFileContents = (path: string) => Promise.resolve(contents[path] ?? "");

  const result = await detectPatterns("/portal", files, NO_KEY_FILES, readFileContents);
  const importConvention = result.find((c) => c.category === "imports");
  assertExists(importConvention, "Expected an imports convention when file content is available");
  assertEquals(importConvention.category, "imports");
});

// ---------------------------------------------------------------------------
// evidenceCount and confidence thresholds
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] sets evidenceCount to number of matching files per convention", () => {
  const files = [
    "src/a_service.ts",
    "src/b_service.ts",
    "src/c_service.ts",
    "src/d_service.ts",
    "src/e_service.ts",
  ];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("service"));
  assertExists(convention);
  assertEquals(convention.evidenceCount, 5);
});

Deno.test("[PatternDetector] assigns confidence low for 1-2 evidence files", () => {
  const files = ["src/a_service.ts"];
  const result = detectPatterns("/portal", files, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("service"));
  assertExists(convention);
  assertEquals(convention.confidence, "low");
});

Deno.test("[PatternDetector] assigns confidence high for 10+ evidence files", () => {
  const services = Array.from({ length: 12 }, (_, i) => `src/service_${i}.ts`);
  const result = detectPatterns("/portal", services, NO_KEY_FILES);
  const convention = result.find((c) => c.name.toLowerCase().includes("service"));
  assertExists(convention);
  assertEquals(convention.confidence, "high");
});

// ---------------------------------------------------------------------------
// Adaptive sample size
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] computeAdaptiveSampleSize scales with total files (5% floor, min 10, max 50)", () => {
  // 5% of 10 = 0.5, floor = 0, clamped to min 10
  assertEquals(computeAdaptiveSampleSize(10, 10, 50), 10);
  // 5% of 200 = 10
  assertEquals(computeAdaptiveSampleSize(200, 10, 50), 10);
  // 5% of 1000 = 50, at max
  assertEquals(computeAdaptiveSampleSize(1000, 10, 50), 50);
  // 5% of 2000 = 100, clamped to max 50
  assertEquals(computeAdaptiveSampleSize(2000, 10, 50), 50);
  // 5% of 50 = 2.5, floor = 2, clamped to min 5
  assertEquals(computeAdaptiveSampleSize(50, 5, 50), 5);
});

Deno.test("[PatternDetector] computeAdaptiveSampleSize handles 0 files", () => {
  assertEquals(computeAdaptiveSampleSize(0, 10, 50), 0);
});

Deno.test("[PatternDetector] computeAdaptiveSampleSize handles min >= max", () => {
  // When min >= max, min takes precedence as the floor
  assertEquals(computeAdaptiveSampleSize(500, 100, 100), 100);
  assertEquals(computeAdaptiveSampleSize(500, 100, 50), 100);
});

// ---------------------------------------------------------------------------
// Stratified sampling
// ---------------------------------------------------------------------------

Deno.test("[PatternDetector] stratified sampling covers all top-level directories", () => {
  const files = [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "tests/x_test.ts",
    "tests/y_test.ts",
    "docs/readme.md",
  ];
  const sample = selectSampleFiles(files, 6);
  // All files should be selected since sample >= total
  assertEquals(sample.length, 6);
  // Every directory should be represented
  assertEquals(sample.includes("src/a.ts"), true);
  assertEquals(sample.includes("tests/x_test.ts"), true);
  assertEquals(sample.includes("docs/readme.md"), true);
});

Deno.test("[PatternDetector] stratified sampling prefers TS/JS files within each bucket", () => {
  const files = [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.js",
    "src/e.json",
    "src/f.txt",
    "tests/test_a.ts",
    "tests/test_b.ts",
    "tests/test_c.py",
  ];
  // Request 3 files — should get 1 from each top-level dir, preferring TS/JS
  const sample = selectSampleFiles(files, 4);
  assertEquals(sample.length, 4);
  // Both src and tests should be represented
  const srcFiles = sample.filter((f: string) => f.startsWith("src/"));
  const testFiles = sample.filter((f: string) => f.startsWith("tests/"));
  assertEquals(srcFiles.length >= 1, true);
  assertEquals(testFiles.length >= 1, true);
  // src files should prefer TS/JS
  for (const f of srcFiles) {
    assertEquals(f.endsWith(".ts") || f.endsWith(".js"), true);
  }
});

Deno.test("[PatternDetector] handles edge case: 0 files → empty sample", () => {
  const sample = selectSampleFiles([], 10);
  assertEquals(sample.length, 0);
});

Deno.test("[PatternDetector] handles edge case: fewer files than min sample size", () => {
  const files = ["src/a.ts", "src/b.ts"];
  const sample = selectSampleFiles(files, 10);
  assertEquals(sample.length, 2);
  assertEquals(sample.includes("src/a.ts"), true);
  assertEquals(sample.includes("src/b.ts"), true);
});
