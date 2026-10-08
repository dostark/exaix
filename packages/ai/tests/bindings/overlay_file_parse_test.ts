/**
 * @module OverlayFileParseTest
 * @path packages/ai/tests/bindings/overlay_file_parse_test.ts
 * @description Verifies that a per-run overlay is parsed as TOML or JSON by its file extension and that bad text is refused as overlay_invalid.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @std/assert]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { parseOverlayText } from "../../src/bindings/overlay_file.ts";

const EXPECTED = { schema: 1, bindings: { "flow:research/step:compose": { service: "alpha", effort: "high" } } };

Deno.test("parseOverlayText reads a .toml file as TOML", () => {
  const text = 'schema = 1\n[bindings."flow:research/step:compose"]\nservice = "alpha"\neffort = "high"\n';
  assertEquals(parseOverlayText("/x/run.toml", text), EXPECTED);
});

Deno.test("parseOverlayText reads other extensions as JSON", () => {
  assertEquals(parseOverlayText("/x/run.json", JSON.stringify(EXPECTED)), EXPECTED);
  assertEquals(parseOverlayText("/x/run", JSON.stringify(EXPECTED)), EXPECTED);
});

Deno.test("parseOverlayText refuses invalid text with overlay_invalid", () => {
  assertThrows(
    () => parseOverlayText("/x/run.toml", "schema = = 1"),
    Error,
    "overlay_invalid: /x/run.toml is not valid TOML",
  );
  assertThrows(() => parseOverlayText("/x/run.json", "{"), Error, "overlay_invalid: /x/run.json is not valid JSON");
  assertThrows(() => parseOverlayText("/x/run.json", "schema = 1"), Error, "overlay_invalid");
});
