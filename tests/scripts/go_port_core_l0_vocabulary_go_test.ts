/**
 * @module GoPortCoreL0VocabularyGoTest
 * @path tests/scripts/go_port_core_l0_vocabulary_go_test.ts
 * @description Exercises the Go vocabulary generator on sample rows and guards the committed generated files against drift.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  buildVocabularyGoFiles,
  generateVocabularyGo,
  scanHandwritten,
} from "../../scripts/go_port/core_l0_vocabulary_go.ts";
import type { IVocabularySymbolRow, TTaggedJson } from "../../scripts/go_port/core_l0_vocabulary_symbols.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const LEAF_DIR = join(ROOT, "exaix-go", "internal", "leaf");
const FIXTURE = join(ROOT, "exaix-go", "internal", "core", "l0", "testdata", "reference", "vocabulary.json");
const NO_HANDWRITTEN = {
  types: new Set<string>(),
  consts: new Set<string>(),
  funcs: new Set<string>(),
  typedConsts: new Map<string, readonly string[]>(),
};

function row(kind: string, target: string, value: TTaggedJson): IVocabularySymbolRow {
  return { module: "packages/core/src/types/sample.ts", symbol: "SAMPLE", kind, target, value };
}

function generated(rows: readonly IVocabularySymbolRow[]): Map<string, string> {
  return new Map(generateVocabularyGo(rows, NO_HANDWRITTEN).map((f) => [f.name, f.content]));
}

Deno.test("go-port-core-l0-vocabulary-go: a string enum becomes a typed closed set with a parser", () => {
  const files = generated([row("enum", "leaf.SampleKind", { FIRST: "first", SECOND_ONE: "second-one" })]);
  const enums = files.get("core_enums_gen.go") ?? "";
  assertStringIncludes(enums, 'SampleKindSecondOne SampleKind = "second-one"');
  assertStringIncludes(enums, "func ParseSampleKind(raw string) (SampleKind, error)");
  assertStringIncludes(files.get("core_vocabulary_table_gen_test.go") ?? "", '"SampleKind": []string{');
});

Deno.test("go-port-core-l0-vocabulary-go: a numeric enum keeps its numbers and imports the helpers it needs", () => {
  const files = generated([row("enum", "leaf.SampleCode", { OK: 0, FAILED: -32700 })]);
  const enums = files.get("core_enums_gen.go") ?? "";
  assertStringIncludes(enums, "SampleCodeFailed SampleCode = -32700");
  assertStringIncludes(enums, '"slices"');
});

Deno.test("go-port-core-l0-vocabulary-go: constants become scalars, patterns, copies and records with absent fields", () => {
  const files = generated([
    row("constant", "leaf.SampleMax", 4),
    row("constant", "leaf.SamplePattern", { $regexp: "^a+$", flags: "i" }),
    row("constant", "leaf.SampleNames", ["a", "b"]),
    row("constant", "leaf.SampleProfiles", {
      one: { model: "m", endpoint: "e" },
      two: { model: "m", endpoint: { $undefined: true } },
    }),
  ]);
  const constants = files.get("core_constants_gen.go") ?? "";
  assertStringIncludes(constants, "const SampleMax = 4");
  assertStringIncludes(constants, 'const SamplePatternFlags = "i"');
  assertStringIncludes(constants, "func SampleNames() []string");
  assertStringIncludes(constants, "Endpoint *string");
  assertStringIncludes(constants, "func vocabularyPointer[T any]");
});

Deno.test("go-port-core-l0-vocabulary-go: a generated name that clashes with a hand-written name is rejected", () => {
  const handwritten = { ...NO_HANDWRITTEN, consts: new Set(["SampleMax"]) };
  assertThrows(
    () =>
      generateVocabularyGo(
        [row("constant", "leaf.SampleMax", 4), row("enum", "leaf.SampleMax", { A: "a" })],
        handwritten,
      ),
    Error,
    "clashes",
  );
});

Deno.test("go-port-core-l0-vocabulary-go: committed generated Go matches the fixture and the hand-written leaf files", async () => {
  const handwritten = await scanHandwritten(LEAF_DIR);
  assert(handwritten.types.has("ProviderType"));
  for (const file of await buildVocabularyGoFiles(FIXTURE, LEAF_DIR)) {
    assertEquals(await Deno.readTextFile(join(LEAF_DIR, file.name)), file.content, `${file.name} is stale`);
  }
});
