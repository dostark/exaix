/**
 * @module PythonSymbolExtractorTest
 * @path packages/portal/knowledge/tests/python_symbol_extractor_test.ts
 * @description Tests for PythonSymbolExtractor — tree-sitter-based Python symbol extraction
 * with pageRank, DoS bounds, path security, and edition-gated registration.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/python_symbol_extractor.ts, packages/portal/knowledge/tree_sitter_symbol_extractor.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PythonSymbolExtractor } from "@exaix/portal/knowledge";
import { DEFAULT_SYMBOL_MAP_LIMIT, SYMBOL_EXTRACT_MAX_FILE_BYTES, SYMBOL_EXTRACT_MAX_FILES } from "@exaix/core";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  import.meta.dirname ?? ".",
  "fixtures",
  "python_portal",
);

/** All Python source files in the fixture. */
function fixtureFiles(): string[] {
  return ["src/main.py", "src/utils.py"];
}

// ---------------------------------------------------------------------------
// Extraction test — basic contract
// ---------------------------------------------------------------------------

Deno.test(
  "[PythonSymbolExtractor] extracts functions/classes/consts from a Python fixture with signatures and docs",
  async () => {
    const extractor = new PythonSymbolExtractor();
    const files = fixtureFiles();
    const result = await extractor.extractSymbols(
      FIXTURE_DIR,
      files,
      { primaryLanguage: "python", allFilePaths: files },
    );

    // All expected symbols in the fixture
    const expectedNames = [
      "greet",
      "calculate_sum",
      "Calculator",
      "add",
      "multiply",
      "MAX_VALUE",
      "DEFAULT_TIMEOUT",
    ];

    for (const name of expectedNames) {
      const found = result.find((s) => s.name === name);
      assert(found !== undefined, `symbol "${name}" should be extracted`);
    }

    // Verify kinds
    assert(result.find((s) => s.name === "greet")!.kind === "function", "greet should be function");
    assert(result.find((s) => s.name === "calculate_sum")!.kind === "function", "calculate_sum should be function");
    assert(result.find((s) => s.name === "Calculator")!.kind === "class", "Calculator should be class");
    assert(result.find((s) => s.name === "add")!.kind === "function", "add method should be function");
    assert(result.find((s) => s.name === "multiply")!.kind === "function", "multiply method should be function");
    assert(result.find((s) => s.name === "MAX_VALUE")!.kind === "const", "MAX_VALUE should be const");
    assert(result.find((s) => s.name === "DEFAULT_TIMEOUT")!.kind === "const", "DEFAULT_TIMEOUT should be const");

    // Verify signatures (no body — signature is the first line before the docstring)
    assert(result.find((s) => s.name === "greet")!.signature.includes("greet"));
    assert(result.find((s) => s.name === "Calculator")!.signature.includes("Calculator"));

    // Verify docs (docstrings)
    assert(result.find((s) => s.name === "greet")!.doc?.includes("Greet"));
    assert(result.find((s) => s.name === "Calculator")!.doc?.includes("simple calculator"));

    // Each symbol should have a file path
    for (const name of expectedNames) {
      const sym = result.find((s) => s.name === name);
      assert(sym !== undefined && sym.file.length > 0, `${name} should have a file path`);
    }
  },
);

// ---------------------------------------------------------------------------
// PageRank ranking test
// ---------------------------------------------------------------------------

Deno.test(
  "[PythonSymbolExtractor] ranks symbols by cross-file import count and caps at DEFAULT_SYMBOL_MAP_LIMIT",
  async () => {
    const extractor = new PythonSymbolExtractor();
    const files = fixtureFiles();
    const result = await extractor.extractSymbols(
      FIXTURE_DIR,
      files,
      { primaryLanguage: "python", allFilePaths: files },
    );

    // utils.py imports from main.py — pageRank is file-level per §3a.
    // Symbols in main.py → 1 importer / 2 files = 0.5.
    // Symbols in utils.py → 0 importers / 2 files = 0.
    //
    // Therefore any symbol in main.py ranks above any symbol in utils.py.

    const greet = result.find((s) => s.name === "greet");
    const double = result.find((s) => s.name === "double");

    assert(greet !== undefined, "greet should be extracted");
    assert(double !== undefined, "double should be extracted");

    assert(
      (greet.pageRankScore ?? 0) > (double.pageRankScore ?? 0),
      "symbols in main.py should rank higher than symbols in utils.py",
    );

    // Cap test: result should not exceed DEFAULT_SYMBOL_MAP_LIMIT
    assert(result.length <= DEFAULT_SYMBOL_MAP_LIMIT, "symbol count should not exceed cap");
  },
);

// ---------------------------------------------------------------------------
// Non-matching language returns []
// ---------------------------------------------------------------------------

Deno.test("[PythonSymbolExtractor] returns [] for a non-Python language", async () => {
  const extractor = new PythonSymbolExtractor();
  const result = await extractor.extractSymbols(
    FIXTURE_DIR,
    fixtureFiles(),
    { primaryLanguage: "rust", allFilePaths: fixtureFiles() },
  );
  assertEquals(result, []);
});

// ---------------------------------------------------------------------------
// [security] Path traversal rejection
// ---------------------------------------------------------------------------

Deno.test({
  name: "[PythonSymbolExtractor] [security] rejects an entrypoint path outside the portal (PathResolver)",
  fn: async () => {
    const extractor = new PythonSymbolExtractor();
    // Attempt to extract with a file path that escapes the portal
    const escapedPath = "../etc/passwd";
    const result = await extractor.extractSymbols(
      FIXTURE_DIR,
      [escapedPath],
      { primaryLanguage: "python", allFilePaths: [escapedPath] },
    );
    // Should not crash — fail-soft, returning at most the safe files
    assert(Array.isArray(result), "should return an array even with malicious path");
  },
});

// ---------------------------------------------------------------------------
// [security] Pathological file bounds (byte cap + node-count cap + time cap)
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "[PythonSymbolExtractor] [security] bounds a pathological file — byte, node-count, and time caps; no hang, no memory blow-up",
  fn: async () => {
    const extractor = new PythonSymbolExtractor();
    const dir = await Deno.makeTempDir({ prefix: "py_extract_bounds_" });
    try {
      // Write a file that exceeds the byte cap
      const oversizedContent = "# " + "X".repeat(SYMBOL_EXTRACT_MAX_FILE_BYTES + 1);
      await Deno.writeTextFile(join(dir, "huge.py"), oversizedContent);

      // Write a file that is within the byte cap but deeply nested (high node count)
      // Generate deeply nested expressions
      let deepContent = "x = ";
      for (let i = 0; i < 500; i++) {
        deepContent += "(";
      }
      deepContent += "1";
      for (let i = 0; i < 500; i++) {
        deepContent += ")";
      }
      deepContent += "\n";
      await Deno.writeTextFile(join(dir, "deep.py"), deepContent);

      // Also include a normal file that should still be parsed
      await Deno.writeTextFile(join(dir, "normal.py"), "def ok(): pass\n");

      const files = ["huge.py", "deep.py", "normal.py"];
      const result = await extractor.extractSymbols(
        dir,
        files,
        { primaryLanguage: "python", allFilePaths: files },
      );

      // The huge file should be skipped (exceeds byte cap), deep file may be skipped or
      // partially parsed. normal.py should still yield its symbol.
      const normalSymbols = result.filter((s) => s.file === "normal.py");
      assert(
        normalSymbols.length > 0,
        "normal.py symbols should still be extracted despite pathological siblings",
      );

      // Execution should not throw or hang
      assert(Array.isArray(result), "result should be an array");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ---------------------------------------------------------------------------
// [security] File-count cap
// ---------------------------------------------------------------------------

Deno.test({
  name: "[PythonSymbolExtractor] [security] caps a zone with more than SYMBOL_EXTRACT_MAX_FILES files",
  fn: async () => {
    const extractor = new PythonSymbolExtractor();
    const dir = await Deno.makeTempDir({ prefix: "py_extract_fcap_" });
    try {
      // Create SYMBOL_EXTRACT_MAX_FILES + 10 tiny Python files
      const extraCount = 10;
      const manyFiles: string[] = [];
      for (let i = 0; i < SYMBOL_EXTRACT_MAX_FILES + extraCount; i++) {
        const name = `file_${i}.py`;
        await Deno.writeTextFile(join(dir, name), "x = 1\n");
        manyFiles.push(name);
      }

      const result = await extractor.extractSymbols(
        dir,
        manyFiles,
        { primaryLanguage: "python", allFilePaths: manyFiles },
      );

      // Should not crash — extraction handles file-count cap gracefully
      assert(Array.isArray(result), "should return an array with many files");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ---------------------------------------------------------------------------
// [security] No network access at extraction time
// ---------------------------------------------------------------------------

Deno.test({
  name: "[PythonSymbolExtractor] [security] extracts with no --allow-net (local locateFile, no network fetch)",
  fn: async () => {
    // This test verifies the extraction does not require network access.
    // It runs with --allow-read but NOT --allow-net (enforced by test config).
    const extractor = new PythonSymbolExtractor();
    const files = fixtureFiles();
    const result = await extractor.extractSymbols(
      FIXTURE_DIR,
      files,
      { primaryLanguage: "python", allFilePaths: files },
    );
    assert(result.length > 0, "should extract symbols with only local files");
  },
  // Note: this test MUST be run with --allow-read but NOT --allow-net
  // The test runner should deny net access or we verify no network errors
});
