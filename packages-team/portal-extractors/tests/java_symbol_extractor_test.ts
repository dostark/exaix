/**
 * @module JavaSymbolExtractorTest
 * @path packages-team/portal-extractors/tests/java_symbol_extractor_test.ts
 * @description Tests for JavaSymbolExtractor — Team edition, CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { JavaSymbolExtractor } from "../src/java_symbol_extractor.ts";
import {
  DEFAULT_SYMBOL_MAP_LIMIT,
  SYMBOL_EXTRACT_MAX_FILE_BYTES,
} from "@exaix/core";

const FIXTURE_DIR = join(
  import.meta.dirname ?? ".",
  "fixtures",
  "java_portal",
  "src",
);

function fixtureFiles(): string[] {
  return ["Main.java", "Util.java"];
}

Deno.test("[JavaSymbolExtractor] extracts class/method/const from Java fixture", async () => {
  const ext = new JavaSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "java",
    allFilePaths: files,
  });
  const names = result.map((s) => s.name);

  assert(names.includes("Main"), "Main class");
  assert(names.includes("MAX_RETRIES"), "MAX_RETRIES const");
  assert(names.includes("run"), "run method");
  assert(names.includes("Util"), "Util class");
  assert(names.includes("format"), "format method");

  assert(
    result.find((s) => s.name === "Main")!.kind === "class",
    "class → class",
  );
  assert(
    result.find((s) => s.name === "MAX_RETRIES")!.kind === "const",
    "field → const",
  );
  assert(
    result.find((s) => s.name === "run")!.kind === "function",
    "method → function",
  );
  assert(
    result.find((s) => s.name === "Util")!.kind === "class",
    "class → class",
  );
  assert(
    result.find((s) => s.name === "format")!.kind === "function",
    "method → function",
  );
});

Deno.test("[JavaSymbolExtractor] ranks and caps", async () => {
  const ext = new JavaSymbolExtractor();
  const files = fixtureFiles();
  const result = await ext.extractSymbols(FIXTURE_DIR, files, {
    primaryLanguage: "java",
    allFilePaths: files,
  });
  assert(result.length <= DEFAULT_SYMBOL_MAP_LIMIT);
});

Deno.test("[JavaSymbolExtractor] returns [] for non-java language", async () => {
  const ext = new JavaSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, fixtureFiles(), {
    primaryLanguage: "python",
    allFilePaths: fixtureFiles(),
  });
  assertEquals(result, []);
});

Deno.test("[JavaSymbolExtractor] [security] rejects path traversal", async () => {
  const ext = new JavaSymbolExtractor();
  const result = await ext.extractSymbols(FIXTURE_DIR, ["../../etc/passwd"], {
    primaryLanguage: "java",
    allFilePaths: ["../../etc/passwd"],
  });
  assert(Array.isArray(result));
});

Deno.test("[JavaSymbolExtractor] [security] bounds pathological file", async () => {
  const ext = new JavaSymbolExtractor();
  const dir = await Deno.makeTempDir({ prefix: "java_ext_" });
  try {
    const hugeContent = "// " + "X".repeat(SYMBOL_EXTRACT_MAX_FILE_BYTES + 1);
    await Deno.writeTextFile(join(dir, "Huge.java"), hugeContent);
    await Deno.writeTextFile(
      join(dir, "Normal.java"),
      "class Normal { void ok() {} }\n",
    );
    const result = await ext.extractSymbols(dir, ["Huge.java", "Normal.java"], {
      primaryLanguage: "java",
      allFilePaths: ["Huge.java", "Normal.java"],
    });
    assert(result.length > 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
