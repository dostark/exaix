/**
 * @module GoPortCoreL0ReferenceTest
 * @path tests/scripts/go_port_core_l0_reference_test.ts
 * @description Exercises the deterministic core-l0 reference fixture generator and digest manifest.
 * @architectural-layer Test
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { CORE_L0_REFERENCE_GROUPS, writeCoreL0Reference } from "../../scripts/go_port/core_l0_reference.ts";
import {
  extractConfigKeys,
  type IVocabularySymbolRow,
  type TTaggedJson,
} from "../../scripts/go_port/core_l0_vocabulary_symbols.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const COMMITTED_DIR = join(ROOT, "exaix-go", "internal", "core", "l0", "testdata", "reference");
const REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

Deno.test("go-port-core-l0-reference: generator output is deterministic and covers every kept group", async () => {
  await withTempDir(async (dir) => {
    const firstDir = join(dir, "first");
    const secondDir = join(dir, "second");
    await writeCoreL0Reference(ROOT, firstDir);
    await writeCoreL0Reference(ROOT, secondDir);

    const manifest1 = await Deno.readTextFile(join(firstDir, "manifest.json"));
    const manifest2 = await Deno.readTextFile(join(secondDir, "manifest.json"));
    assertEquals(manifest1, manifest2);

    const parsed = JSON.parse(manifest1) as {
      reference_parent: string;
      files: Record<string, string>;
    };
    assertEquals(parsed.reference_parent, REFERENCE);
    for (const group of CORE_L0_REFERENCE_GROUPS) {
      const filename = `${group}.json`;
      assert(typeof parsed.files[filename] === "string" && parsed.files[filename].length === 64);
      const a = await Deno.readTextFile(join(firstDir, filename));
      const b = await Deno.readTextFile(join(secondDir, filename));
      assertEquals(a, b);
    }
  });
});

Deno.test("go-port-core-l0-reference: committed manifest matches generated fixture digests", async () => {
  const raw = await Deno.readTextFile(join(COMMITTED_DIR, "manifest.json"));
  const parsed = JSON.parse(raw) as { reference_parent: string; files: Record<string, string> };
  assertEquals(parsed.reference_parent, REFERENCE);
  for (const group of CORE_L0_REFERENCE_GROUPS) {
    assert(Boolean(parsed.files[`${group}.json`]), `missing fixture ${group}.json`);
  }
});

interface IVocabularyFixture {
  readonly symbols: readonly IVocabularySymbolRow[];
}

interface IInventoryEntry {
  readonly module: string;
  readonly symbol: string;
  readonly class: string;
  readonly step?: number;
  readonly evidence: { readonly target?: string };
}

const KEPT_VOCABULARY_STEP = 3;

async function generatedVocabulary(): Promise<readonly IVocabularySymbolRow[]> {
  let symbols: readonly IVocabularySymbolRow[] = [];
  await withTempDir(async (dir) => {
    await writeCoreL0Reference(ROOT, dir);
    const fixture = JSON.parse(await Deno.readTextFile(join(dir, "vocabulary.json"))) as IVocabularyFixture;
    symbols = fixture.symbols;
  });
  return symbols;
}

Deno.test("go-port-core-l0-reference: vocabulary fixture carries a value for every kept Step 3 symbol", async () => {
  const inventory = JSON.parse(
    await Deno.readTextFile(join(ROOT, "exaix-go", "port", "inventory", "core-l0.json")),
  ) as {
    entries: IInventoryEntry[];
  };
  const kept = inventory.entries.filter((e) => e.class === "keep" && e.step === KEPT_VOCABULARY_STEP);
  const rows = await generatedVocabulary();
  assertEquals(rows.map((r) => `${r.module}#${r.symbol}`), kept.map((e) => `${e.module}#${e.symbol}`));
  for (const entry of kept) {
    const row = rows.find((r) => r.module === entry.module && r.symbol === entry.symbol);
    assertEquals(row?.target, entry.evidence.target);
  }
});

Deno.test("go-port-core-l0-reference: vocabulary fixture encodes enums, patterns, sets and absent values", async () => {
  const rows = await generatedVocabulary();
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  assertEquals(bySymbol.get("TOKENS_PER_MTOK")?.value, 1_000_000);
  const members = (symbol: string): { readonly [key: string]: TTaggedJson } =>
    bySymbol.get(symbol)?.value as { readonly [key: string]: TTaggedJson };
  assertEquals(members("CostGroupBy").MODEL, "model");
  assertEquals(members("PriorityLevel").HIGH, 4);
  assertEquals(Object.keys(members("PriorityLevel")), ["LOCAL", "LOW", "MEDIUM", "HIGH", "DEFAULT"]);
  assertEquals(Object.keys(members("PORTAL_PREFIX_PATTERN")), ["$regexp", "flags"]);
  assertEquals(Object.keys(members("FS_WRITE_EVENT_KINDS")), ["$set"]);
});

Deno.test("go-port-core-l0-reference: inventory records the config key of every configurable constant", async () => {
  const inventory = JSON.parse(
    await Deno.readTextFile(join(ROOT, "exaix-go", "port", "inventory", "core-l0.json")),
  ) as {
    entries: (IInventoryEntry & { readonly evidence: { readonly config_key?: string } })[];
  };
  const source = await Deno.readTextFile(join(ROOT, "packages", "core", "src", "types", "constants.ts"));
  const keys = extractConfigKeys(source);
  assert(keys.size > 0);
  const kept = inventory.entries.filter((e) => e.class === "keep" && e.step === KEPT_VOCABULARY_STEP);
  for (const entry of kept) {
    const expected = entry.module.endsWith("types/constants.ts") ? keys.get(entry.symbol) : undefined;
    assertEquals(entry.evidence.config_key, expected, `${entry.symbol} config key`);
  }
  assertEquals(
    kept.filter((e) => e.evidence.config_key !== undefined).length,
    [...keys.keys()].filter((symbol) => kept.some((e) => e.symbol === symbol)).length,
  );
});

interface IDataTypesFixture {
  readonly samples: { readonly [goType: string]: readonly object[] };
  readonly tool_calls: readonly { readonly expected: { readonly name: string } }[];
  readonly json_extract: readonly { readonly found: boolean }[];
}

Deno.test("go-port-core-l0-reference: data type fixture carries samples and helper cases", async () => {
  let fixture: IDataTypesFixture | undefined;
  await withTempDir(async (dir) => {
    await writeCoreL0Reference(ROOT, dir);
    fixture = JSON.parse(await Deno.readTextFile(join(dir, "data_types.json"))) as IDataTypesFixture;
  });
  assert(fixture !== undefined);
  assert(Object.keys(fixture.samples).length > 30);
  for (const [goType, samples] of Object.entries(fixture.samples)) {
    assert(samples.length > 0, `${goType} has no sample`);
  }
  assert(fixture.tool_calls.some((c) => c.expected.name === "search_text"));
  assert(fixture.json_extract.some((c) => !c.found) && fixture.json_extract.some((c) => c.found));
});
