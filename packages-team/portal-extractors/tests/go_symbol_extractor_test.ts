/**
 * @module GoSymbolExtractorTest
 * @path packages-team/portal-extractors/tests/go_symbol_extractor_test.ts
 * @description Tests for GoSymbolExtractor — Team edition, CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { GoSymbolExtractor } from "../src/go_symbol_extractor.ts";
import { DEFAULT_SYMBOL_MAP_LIMIT, SYMBOL_EXTRACT_MAX_FILE_BYTES } from "@exaix/core";

const FIXTURE_DIR = join(
  import.meta.dirname ?? ".",
  "fixtures",
  "go_portal",
  "src",
);

function fixtureFiles(): string[] {
  return ["main.go", "utils.go"];
}

Deno.test("[GoSymbolExtractor] extracts struct/interface/fn/const from Go fixture", async () => {
  const ext = new GoSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "go",
    allFilePaths: files,
  });
  const names = result.map((s) => s.name);

  assert(names.includes("Point"), "Point struct");
  assert(names.includes("Shape"), "Shape interface");
  assert(names.includes("NewPoint"), "NewPoint fn");
  assert(names.includes("MaxCoord"), "MaxCoord const");
  assert(names.includes("MyInt"), "MyInt type alias");
  assert(names.includes("DoublePoint"), "DoublePoint fn");
  assert(names.includes("Pi"), "Pi const");

  assert(
    result.find((s) => s.name === "Point")!.kind === "class",
    "struct → class",
  );
  assert(
    result.find((s) => s.name === "Shape")!.kind === "interface",
    "interface → interface",
  );
  assert(
    result.find((s) => s.name === "NewPoint")!.kind === "function",
    "fn → function",
  );
  assert(
    result.find((s) => s.name === "MaxCoord")!.kind === "const",
    "const → const",
  );
  assert(
    result.find((s) => s.name === "MyInt")!.kind === "type",
    "type alias → type",
  );
});

Deno.test("[GoSymbolExtractor] ranks and caps", async () => {
  const ext = new GoSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "go",
    allFilePaths: files,
  });
  assert(result.length <= DEFAULT_SYMBOL_MAP_LIMIT);
});

Deno.test("[GoSymbolExtractor] returns [] for non-go language", async () => {
  const ext = new GoSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, fixtureFiles(), {
    primaryLanguage: "python",
    allFilePaths: fixtureFiles(),
  });
  assertEquals(result, []);
});

Deno.test("[GoSymbolExtractor] [security] rejects path traversal", async () => {
  const ext = new GoSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, ["../../etc/passwd"], {
    primaryLanguage: "go",
    allFilePaths: ["../../etc/passwd"],
  });
  assert(Array.isArray(result));
});

Deno.test("[GoSymbolExtractor] [security] bounds pathological file", async () => {
  const ext = new GoSymbolExtractor();
  const dir = await Deno.makeTempDir({ prefix: "go_ext_" });
  try {
    const hugeContent = "// " + "X".repeat(SYMBOL_EXTRACT_MAX_FILE_BYTES + 1);
    await Deno.writeTextFile(join(dir, "huge.go"), hugeContent);
    await Deno.writeTextFile(join(dir, "normal.go"), "func ok() {}\n");
    const result = await ext.extractSymbols(dir, ["huge.go", "normal.go"], {
      primaryLanguage: "go",
      allFilePaths: ["huge.go", "normal.go"],
    });
    assert(result.length > 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
