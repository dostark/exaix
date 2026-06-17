/**
 * @module SymbolExtractionConstantsTest
 * @path packages/core/tests/symbol_extraction_constants_test.ts
 * @description Verifies Phase 119 multi-language symbol-extraction constants are exported
 *   with stable values and full language coverage (python/rust/go/java + TS/JS), and that
 *   the DoS bounds are positive named constants.
 * @architectural-layer Tests
 * @related-files ["packages/core/src/types/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import {
  LANGUAGE_SOURCE_EXTENSIONS,
  SYMBOL_EXTRACT_MAX_FILE_BYTES,
  SYMBOL_EXTRACT_MAX_FILES,
  SYMBOL_EXTRACT_MAX_NODES,
  SYMBOL_EXTRACT_TIMEOUT_MS,
  TS_JS_EXTENSIONS,
} from "@exaix/core";

Deno.test("[SymbolExtractionConstants] LANGUAGE_SOURCE_EXTENSIONS covers python/rust/go/java (and TS/JS)", () => {
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.python, [".py", ".pyi"]);
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.rust, [".rs"]);
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.go, [".go"]);
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.java, [".java"]);
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.typescript, [".ts", ".tsx"]);
  assertEquals(LANGUAGE_SOURCE_EXTENSIONS.javascript, [".js", ".jsx", ".mjs", ".cjs"]);
});

Deno.test("[SymbolExtractionConstants] TS_JS_EXTENSIONS is the TS/JS fallback set", () => {
  assertEquals(TS_JS_EXTENSIONS, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
});

Deno.test("[SymbolExtractionConstants] DoS bounds are positive named constants", () => {
  assertEquals(SYMBOL_EXTRACT_MAX_FILE_BYTES > 0, true);
  assertEquals(SYMBOL_EXTRACT_MAX_FILES > 0, true);
  assertEquals(SYMBOL_EXTRACT_MAX_NODES > 0, true);
  assertEquals(SYMBOL_EXTRACT_TIMEOUT_MS > 0, true);
});
