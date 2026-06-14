/**
 * @module SymbolExtractorRegistryTest
 * @path packages/portal/knowledge/tests/symbol_extractor_registry_test.ts
 * @related-files [packages/portal/knowledge/symbol_extractor_registry.ts, packages/portal/knowledge/symbol_extractor.ts]
 * @architectural-layer Portal
 * @description Phase 115 Step 4 — verifies the ISymbolExtractor seam + per-language registry:
 * TS extraction is unchanged through the interface (parity), and a stub extractor registers and
 * is selected for a non-TS language while unregistered languages fall back to a no-op ([]).
 * Solo keeps the deno-doc TS extractor; paid editions (P46) register more via the composer.
 */

import { assertEquals } from "@std/assert";
import {
  createDefaultSymbolExtractorRegistry,
  type IDenoDocNode,
  type IDocCommandRunner,
  type ISymbolExtractor,
  SymbolExtractor,
} from "@exaix/portal/knowledge";
import type { ISymbolEntry } from "@exaix/schemas";

function mockRunner(response: string | null): IDocCommandRunner {
  return { run: (_entrypoint: string, _portalPath: string) => Promise.resolve(response) };
}

function makeDocNode(kind: string, name: string, overrides: Partial<IDenoDocNode> = {}): IDenoDocNode {
  return { kind, name, location: { filename: "src/main.ts" }, ...overrides };
}

Deno.test("[portal] TS extraction is unchanged through ISymbolExtractor (parity)", async () => {
  const nodes = [
    makeDocNode("function", "myFunc", {
      functionDef: { params: [{ name: "x" }], returnType: { repr: "string" } },
    }),
  ];
  const runner = mockRunner(JSON.stringify(nodes));
  const options = { primaryLanguage: "typescript" };

  // Historical direct path vs. the same extractor selected through the registry.
  const direct = new SymbolExtractor(runner);
  const expected = await direct.extractSymbols("/portal", ["src/main.ts"], options);

  const registry = createDefaultSymbolExtractorRegistry(runner);
  const viaRegistry: ISymbolExtractor = registry.getForLanguage("typescript");
  const actual = await viaRegistry.extractSymbols("/portal", ["src/main.ts"], options);

  assertEquals(actual, expected);
  assertEquals(actual.length, 1);
  assertEquals(actual[0].name, "myFunc");
});

Deno.test("[portal] a stub extractor registers and is selected for a non-TS language", async () => {
  const pySymbol: ISymbolEntry = { name: "py_fn", kind: "function", file: "main.py", signature: "def py_fn()" };
  const stub: ISymbolExtractor = { extractSymbols: () => Promise.resolve([pySymbol]) };

  const registry = createDefaultSymbolExtractorRegistry();
  registry.register("python", stub);

  const selected = registry.getForLanguage("python");
  const result = await selected.extractSymbols("/portal", ["main.py"], { primaryLanguage: "python" });
  assertEquals(result, [pySymbol]);

  // Unregistered language falls back to the no-op extractor (empty index — current behaviour).
  const ruby = await registry.getForLanguage("ruby").extractSymbols("/portal", ["main.rb"], {
    primaryLanguage: "ruby",
  });
  assertEquals(ruby, []);
});
