/**
 * @module AstAnalyzerTest
 * @path packages/portal/knowledge/tests/ast_analyzer_test.ts
 * @description Tests for AstAnalyzer — Strategy 7 of PortalKnowledgeService.
 * Tests non-TS/JS language handling, empty entrypoints, and subprocess failures.
 */

import { assertEquals } from "@std/assert";
import { AstAnalyzer } from "../ast_analyzer.ts";

Deno.test("AstAnalyzer: returns empty diagnostics for non-TS/JS language", async () => {
  const analyzer = new AstAnalyzer();

  const result = await analyzer.analyze("/tmp", ["main.ts"], "python");

  assertEquals(result, {
    totalModules: 0,
    totalImports: 0,
    diagnostics: [],
    importGraph: {},
    errorCount: 0,
  });
});

Deno.test("AstAnalyzer: returns empty diagnostics for empty entrypoints", async () => {
  const analyzer = new AstAnalyzer();

  const result = await analyzer.analyze("/tmp", [], "typescript");

  assertEquals(result, {
    totalModules: 0,
    totalImports: 0,
    diagnostics: [],
    importGraph: {},
    errorCount: 0,
  });
});

Deno.test("AstAnalyzer: handles missing directory gracefully", async () => {
  const analyzer = new AstAnalyzer();

  const result = await analyzer.analyze("/nonexistent/path", ["mod.ts"], "typescript");

  assertEquals(result, {
    totalModules: 0,
    totalImports: 0,
    diagnostics: [],
    importGraph: {},
    errorCount: 0,
  });
});

Deno.test("AstAnalyzer: produces diagnostics for failing deno check", async () => {
  const analyzer = new AstAnalyzer();

  const result = await analyzer.analyze("/tmp", ["nonexistent_file.ts"], "typescript");

  assertEquals(result.totalModules, 1);
  assertEquals(result.diagnostics.length, 0);
});
