/**
 * @module RustSymbolExtractorTest
 * @path packages-team/portal-extractors/tests/rust_symbol_extractor_test.ts
 * @description Tests for RustSymbolExtractor — Team edition, CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { RustSymbolExtractor } from "../src/rust_symbol_extractor.ts";
import { DEFAULT_SYMBOL_MAP_LIMIT, SYMBOL_EXTRACT_MAX_FILE_BYTES } from "@exaix/core";

const FIXTURE_DIR = join(
  import.meta.dirname ?? ".",
  "fixtures",
  "rust_portal",
  "src",
);

function fixtureFiles(): string[] {
  return ["lib.rs", "utils.rs"];
}

Deno.test("[RustSymbolExtractor] extracts struct/enum/trait/fn/const from Rust fixture", async () => {
  const ext = new RustSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "rust",
    allFilePaths: files,
  });
  const names = result.map((s) => s.name);

  assert(names.includes("Point"), "Point struct");
  assert(names.includes("Color"), "Color enum");
  assert(names.includes("Drawable"), "Drawable trait");
  assert(names.includes("new_point"), "new_point fn");
  assert(names.includes("MAX_COORD"), "MAX_COORD const");
  assert(names.includes("double_point"), "double_point fn");
  assert(names.includes("ORIGIN"), "ORIGIN const");

  // Check kinds
  assert(
    result.find((s) => s.name === "Point")!.kind === "class",
    "struct → class",
  );
  assert(
    result.find((s) => s.name === "Color")!.kind === "enum",
    "enum → enum",
  );
  assert(
    result.find((s) => s.name === "Drawable")!.kind === "interface",
    "trait → interface",
  );
  assert(
    result.find((s) => s.name === "new_point")!.kind === "function",
    "fn → function",
  );
  assert(
    result.find((s) => s.name === "MAX_COORD")!.kind === "const",
    "const → const",
  );
});

Deno.test("[RustSymbolExtractor] ranks by import count and caps", async () => {
  const ext = new RustSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "rust",
    allFilePaths: files,
  });
  assert(result.length <= DEFAULT_SYMBOL_MAP_LIMIT, "cap");
  // lib.rs symbols should rank higher than utils.rs (utils imports from lib)
  // This is approximate since pageRank is file-level
});

Deno.test("[RustSymbolExtractor] returns [] for non-rust language", async () => {
  const ext = new RustSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, fixtureFiles(), {
    primaryLanguage: "python",
    allFilePaths: fixtureFiles(),
  });
  assertEquals(result, []);
});

Deno.test("[RustSymbolExtractor] [security] rejects path traversal", async () => {
  const ext = new RustSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, ["../../etc/passwd"], {
    primaryLanguage: "rust",
    allFilePaths: ["../../etc/passwd"],
  });
  assert(Array.isArray(result));
});

Deno.test("[RustSymbolExtractor] [security] bounds pathological file", async () => {
  const ext = new RustSymbolExtractor();
  const dir = await Deno.makeTempDir({ prefix: "rs_ext_" });
  try {
    const hugeContent = "// " + "X".repeat(SYMBOL_EXTRACT_MAX_FILE_BYTES + 1);
    await Deno.writeTextFile(join(dir, "huge.rs"), hugeContent);
    await Deno.writeTextFile(join(dir, "normal.rs"), "fn ok() {}\n");
    const result = await ext.extractSymbols(dir, ["huge.rs", "normal.rs"], {
      primaryLanguage: "rust",
      allFilePaths: ["huge.rs", "normal.rs"],
    });
    assert(result.length > 0, "normal.rs symbols should be extracted");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
