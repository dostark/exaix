/**
 * @module SymbolExtractorTest
 * @path packages/portal/knowledge/tests/symbol_extractor_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for the SymbolExtractor (Strategy 6): runs deno doc --json
 * on detected entrypoints to produce an ISymbolEntry[]. Mock IDocCommandRunner
 * is used to avoid real subprocess calls in tests.
 */

import { assertEquals } from "@std/assert";
import { type IDenoDocNode, type IDocCommandRunner, SymbolExtractor } from "@exaix/portal/knowledge";
import { DEFAULT_SYMBOL_MAP_LIMIT, runWithConcurrency, SYMBOL_EXTRACTOR_CONCURRENCY } from "@exaix/core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Creates a mock command runner that returns a fixed JSON string or null. */
function mockRunner(response: string | null): IDocCommandRunner {
  return { run: (_entrypoint: string, _portalPath: string) => Promise.resolve(response) };
}

/** Minimal deno doc JSON node factory. */
function makeDocNode(
  kind: string,
  name: string,
  overrides: Partial<IDenoDocNode> = {},
): IDenoDocNode {
  return { kind, name, location: { filename: "src/main.ts" }, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[SymbolExtractor] returns empty array for non-TypeScript portal", async () => {
  const extractor = new SymbolExtractor(mockRunner("[]"));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "python",
  });
  assertEquals(result, []);
});

Deno.test("[SymbolExtractor] maps deno doc JSON nodes to ISymbolEntry", async () => {
  const nodes = [
    makeDocNode("function", "myFunc", {
      functionDef: { params: [{ name: "x" }], returnType: { repr: "string" } },
      jsDoc: { doc: "My function docs" },
    }),
  ];
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodes)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "myFunc");
  assertEquals(result[0].kind, "function");
});

Deno.test("[SymbolExtractor] assigns correct kind for function/class/interface/const/type", async () => {
  const nodes = [
    makeDocNode("function", "fn"),
    makeDocNode("class", "MyClass"),
    makeDocNode("interface", "IFoo"),
    makeDocNode("variable", "MY_CONST", { variableDef: { kind: "const" } }),
    makeDocNode("typeAlias", "MyType"),
    makeDocNode("enum", "Direction"),
  ];
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodes)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  const kinds = result.map((r) => r.kind);
  assertEquals(kinds.includes("function"), true);
  assertEquals(kinds.includes("class"), true);
  assertEquals(kinds.includes("interface"), true);
  assertEquals(kinds.includes("const"), true);
  assertEquals(kinds.includes("type"), true);
  assertEquals(kinds.includes("enum"), true);
});

Deno.test("[SymbolExtractor] populates signature from functionDef", async () => {
  const nodes = [
    makeDocNode("function", "doWork", {
      functionDef: { params: [{ name: "input" }, { name: "count" }], returnType: { repr: "void" } },
    }),
  ];
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodes)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result[0].signature.includes("doWork"), true);
  assertEquals(result[0].signature.includes("input"), true);
});

Deno.test("[SymbolExtractor] extracts JSDoc summary as doc field", async () => {
  const nodes = [
    makeDocNode("function", "helper", {
      functionDef: { params: [], returnType: { repr: "void" } },
      jsDoc: { doc: "Helps with tasks." },
    }),
  ];
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodes)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result[0].doc, "Helps with tasks.");
});

Deno.test("[SymbolExtractor] computes pageRankScore from import count", async () => {
  const nodes = [makeDocNode("function", "sharedUtil", { functionDef: { params: [] } })];
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodes)));

  // 3 files import sharedUtil, total 10 files → pageRankScore ≈ 0.3
  const allFilePaths = Array.from({ length: 10 }, (_, i) => `src/file_${i}.ts`);
  const importMap: Record<string, string[]> = {
    "src/file_0.ts": ["src/main.ts"],
    "src/file_1.ts": ["src/main.ts"],
    "src/file_2.ts": ["src/main.ts"],
  };
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
    allFilePaths,
    importMap,
  });
  assertEquals(result[0].pageRankScore !== undefined, true);
  assertEquals((result[0].pageRankScore ?? 0) > 0, true);
});

Deno.test("[SymbolExtractor] sorts by pageRankScore descending", async () => {
  // popular is at src/main.ts (imported by a + b = 2 files), rare at src/alt.ts (0 imports)
  const nodesDetailed = [
    { ...makeDocNode("function", "rare"), location: { filename: "src/alt.ts" } },
    { ...makeDocNode("function", "popular"), location: { filename: "src/main.ts" } },
  ];
  const allFilePaths = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const importMap: Record<string, string[]> = {
    "src/a.ts": ["src/main.ts"],
    "src/b.ts": ["src/main.ts"],
    "src/c.ts": [],
  };
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(nodesDetailed)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
    allFilePaths,
    importMap,
  });

  // popular (src/main.ts, imported by a + b = 2) comes before rare (src/alt.ts, 0 imports)
  assertEquals(result[0].name, "popular");
});

Deno.test("[SymbolExtractor] caps output at DEFAULT_SYMBOL_MAP_LIMIT", async () => {
  const manyNodes = Array.from(
    { length: DEFAULT_SYMBOL_MAP_LIMIT + 20 },
    (_, i) => makeDocNode("function", `fn_${i}`, { functionDef: { params: [] } }),
  );
  const extractor = new SymbolExtractor(mockRunner(JSON.stringify(manyNodes)));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result.length <= DEFAULT_SYMBOL_MAP_LIMIT, true);
});

Deno.test("[SymbolExtractor] returns empty array on subprocess failure", async () => {
  const failRunner: IDocCommandRunner = {
    run: () => Promise.reject(new Error("command failed")),
  };
  const extractor = new SymbolExtractor(failRunner);
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result, []);
});

Deno.test("[SymbolExtractor] returns empty array when runner returns null", async () => {
  const extractor = new SymbolExtractor(mockRunner(null));
  const result = await extractor.extractSymbols("/portal", ["src/main.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(result, []);
});

// ---------------------------------------------------------------------------
// Full-source extraction (directory batching + dedup + concurrency)
// ---------------------------------------------------------------------------

Deno.test("[SymbolExtractor] extracts symbols from all TS files (not just entrypoints)", async () => {
  const nodesA = [
    makeDocNode("function", "funcA", { location: { filename: "src/a.ts" }, functionDef: { params: [] } }),
  ];
  const nodesB = [
    makeDocNode("function", "funcB", { location: { filename: "src/b.ts" }, functionDef: { params: [] } }),
  ];
  let callCount = 0;
  const trackingRunner: IDocCommandRunner = {
    run: (_entrypoint: string) => {
      callCount++;
      if (_entrypoint.includes("a.ts")) return Promise.resolve(JSON.stringify(nodesA));
      if (_entrypoint.includes("b.ts")) return Promise.resolve(JSON.stringify(nodesB));
      return Promise.resolve("[]");
    },
  };
  const extractor = new SymbolExtractor(trackingRunner);
  const result = await extractor.extractSymbols("/portal", ["src/a.ts", "src/b.ts"], {
    primaryLanguage: "typescript",
  });
  assertEquals(callCount >= 2, true);
  assertEquals(result.length, 2);
  assertEquals(result.some((r) => r.name === "funcA"), true);
  assertEquals(result.some((r) => r.name === "funcB"), true);
});

Deno.test("[SymbolExtractor] deduplicates symbols by name + file path", async () => {
  const sameSymbol = makeDocNode("function", "duplicated", {
    location: { filename: "src/shared.ts" },
    functionDef: { params: [] },
  });
  const runner: IDocCommandRunner = {
    run: () => Promise.resolve(JSON.stringify([sameSymbol, sameSymbol])),
  };
  const extractor = new SymbolExtractor(runner);
  const result = await extractor.extractSymbols("/portal", ["src/a.ts", "src/b.ts"], {
    primaryLanguage: "typescript",
  });
  const matched = result.filter((r) => r.name === "duplicated" && r.file === "src/shared.ts");
  assertEquals(matched.length, 1, "Same symbol from same file should appear once");
});

Deno.test("[SymbolExtractor] handles empty file list gracefully", async () => {
  const extractor = new SymbolExtractor();
  const result = await extractor.extractSymbols("/portal", [], {
    primaryLanguage: "typescript",
  });
  assertEquals(result, []);
});

Deno.test("[runWithConcurrency] runs all items with bounded concurrency", async () => {
  const results: number[] = [];
  const maxConcurrent: number[] = [0];
  let running = 0;
  await runWithConcurrency([1, 2, 3, 4], SYMBOL_EXTRACTOR_CONCURRENCY, async (item) => {
    running++;
    maxConcurrent[0] = Math.max(maxConcurrent[0], running);
    await new Promise((r) => setTimeout(r, 10));
    results.push(item);
    running--;
  });
  assertEquals(results.length, 4);
  assertEquals(results.sort((a, b) => a - b).join(","), "1,2,3,4");
  assertEquals(maxConcurrent[0] <= SYMBOL_EXTRACTOR_CONCURRENCY, true);
});
