/**
 * @module RelationshipQueryTest
 * @path packages/portal/knowledge/tests/relationship_query_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for the relationship-traversal query surface (Phase 175 Step 2):
 * deriveLayerContainsFileEdges (on-demand, never persisted), queryRelationships, and
 * whoDependsOn, combining persisted file_imports_file_internal edges with derived
 * layer_contains_file edges.
 */

import { assertEquals } from "@std/assert";
import { PortalAnalysisMode } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import {
  decodeSymbolRef,
  deriveLayerContainsFileEdges,
  encodeSymbolRef,
  queryRelationships,
  traverseModuleDependencies,
  whoDependsOn,
} from "../relationship_query.ts";

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
    metadata: { durationMs: 0, mode: PortalAnalysisMode.QUICK, filesScanned: 0, filesRead: 0 },
    ...overrides,
  };
}

Deno.test("deriveLayerContainsFileEdges: derives edges correctly for a fixture portal with 2 layers, 5 key files", () => {
  const knowledge = makeKnowledge({
    layers: [
      {
        name: "services",
        paths: ["services/"],
        responsibility: "Business logic",
        keyFiles: ["services/a.ts", "services/b.ts", "services/c.ts"],
      },
      {
        name: "controllers",
        paths: ["controllers/"],
        responsibility: "HTTP handlers",
        keyFiles: ["controllers/d.ts", "controllers/e.ts"],
      },
    ],
  });

  const edges = deriveLayerContainsFileEdges(knowledge);

  assertEquals(edges, [
    { from: "services", to: "services/a.ts", kind: "layer_contains_file" },
    { from: "services", to: "services/b.ts", kind: "layer_contains_file" },
    { from: "services", to: "services/c.ts", kind: "layer_contains_file" },
    { from: "controllers", to: "controllers/d.ts", kind: "layer_contains_file" },
    { from: "controllers", to: "controllers/e.ts", kind: "layer_contains_file" },
  ]);
});

Deno.test("deriveLayerContainsFileEdges: emits edges from both top-level layers and packages[].layers without deduplicating same-named layers", () => {
  const knowledge = makeKnowledge({
    layers: [
      { name: "shared", paths: ["shared/"], responsibility: "Shared code", keyFiles: ["shared/x.ts"] },
    ],
    packages: [
      {
        name: "@app/one",
        path: "packages/one",
        primaryLanguage: "typescript",
        layers: [
          {
            name: "shared",
            paths: ["packages/one/shared/"],
            responsibility: "Pkg-local",
            keyFiles: [
              "packages/one/shared/y.ts",
            ],
          },
        ],
        conventions: [],
      },
    ],
  });

  const edges = deriveLayerContainsFileEdges(knowledge);

  assertEquals(edges, [
    { from: "shared", to: "shared/x.ts", kind: "layer_contains_file" },
    { from: "shared", to: "packages/one/shared/y.ts", kind: "layer_contains_file" },
  ]);
});

Deno.test("deriveLayerContainsFileEdges: never persists its output (pure function, no side effects)", () => {
  const knowledge = makeKnowledge({
    layers: [{ name: "l", paths: [], responsibility: "r", keyFiles: ["f.ts"] }],
  });

  deriveLayerContainsFileEdges(knowledge);

  assertEquals(knowledge.relationships, undefined);
});

Deno.test("queryRelationships: returns correct forward edges, combining persisted file_imports_file_internal and derived layer_contains_file edges", () => {
  const knowledge = makeKnowledge({
    layers: [{ name: "services", paths: [], responsibility: "r", keyFiles: ["main.ts"] }],
    relationships: [{ from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" }],
  });

  const fromServices = queryRelationships(knowledge, "services");
  assertEquals(fromServices, [{ from: "services", to: "main.ts", kind: "layer_contains_file" }]);

  const fromMain = queryRelationships(knowledge, "main.ts");
  assertEquals(fromMain, [{ from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" }]);

  const filteredByKind = queryRelationships(knowledge, "services", "file_imports_file_internal");
  assertEquals(filteredByKind, []);
});

Deno.test("whoDependsOn: returns correct reverse edges (files that import the target)", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
      { from: "other.ts", to: "util.ts", kind: "file_imports_file_internal" },
      { from: "main.ts", to: "unrelated.ts", kind: "file_imports_file_internal" },
    ],
  });

  const dependents = whoDependsOn(knowledge, "util.ts");

  assertEquals(dependents, [
    { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
    { from: "other.ts", to: "util.ts", kind: "file_imports_file_internal" },
  ]);
});

Deno.test("queryRelationships and whoDependsOn: handle a portal with zero persisted relationships gracefully", () => {
  const knowledge = makeKnowledge({
    layers: [{ name: "services", paths: [], responsibility: "r", keyFiles: ["main.ts"] }],
    relationships: undefined,
  });

  // layer_contains_file edges still derive correctly even with zero persisted relationships.
  assertEquals(queryRelationships(knowledge, "services"), [
    { from: "services", to: "main.ts", kind: "layer_contains_file" },
  ]);
  // file_imports_file_internal-sourced results are simply empty, not an error.
  assertEquals(queryRelationships(knowledge, "main.ts"), []);
  assertEquals(whoDependsOn(knowledge, "util.ts"), []);
});

Deno.test("traverseModuleDependencies: returns forward multi-hop file_imports_file_internal edges within maxDepth", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
      { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
      { from: "c.ts", to: "d.ts", kind: "file_imports_file_internal" },
    ],
  });

  assertEquals(traverseModuleDependencies(knowledge, "a.ts", 1), [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
  ]);
  assertEquals(traverseModuleDependencies(knowledge, "a.ts", 2), [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
    { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
  ]);
  assertEquals(traverseModuleDependencies(knowledge, "a.ts", 10), [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
    { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
    { from: "c.ts", to: "d.ts", kind: "file_imports_file_internal" },
  ]);
});

Deno.test("traverseModuleDependencies: deduplicates cycles — each node visited at most once", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
      { from: "b.ts", to: "a.ts", kind: "file_imports_file_internal" },
      { from: "a.ts", to: "c.ts", kind: "file_imports_file_internal" },
      { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
    ],
  });

  const edges = traverseModuleDependencies(knowledge, "a.ts", 5);

  assertEquals(edges, [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
    { from: "a.ts", to: "c.ts", kind: "file_imports_file_internal" },
  ]);
});

Deno.test("traverseModuleDependencies: sorts each hop's edges by from then to, and returns [] for an unknown or leaf node", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "a.ts", to: "z.ts", kind: "file_imports_file_internal" },
      { from: "a.ts", to: "m.ts", kind: "file_imports_file_internal" },
    ],
  });

  assertEquals(traverseModuleDependencies(knowledge, "a.ts", 1), [
    { from: "a.ts", to: "m.ts", kind: "file_imports_file_internal" },
    { from: "a.ts", to: "z.ts", kind: "file_imports_file_internal" },
  ]);
  assertEquals(traverseModuleDependencies(knowledge, "unknown.ts", 3), []);
  assertEquals(traverseModuleDependencies(knowledge, "z.ts", 3), []);
});

Deno.test("encodeSymbolRef/decodeSymbolRef: round-trips a file and name pair", () => {
  const ref = encodeSymbolRef("packages/foo/bar.go", "Helper");
  assertEquals(ref, "packages/foo/bar.go#Helper");
  assertEquals(decodeSymbolRef(ref), { file: "packages/foo/bar.go", name: "Helper" });
});

Deno.test("decodeSymbolRef: returns undefined when no separator is present", () => {
  assertEquals(decodeSymbolRef("packages/foo/bar.go"), undefined);
  assertEquals(decodeSymbolRef(""), undefined);
});

Deno.test("decodeSymbolRef: splits on the last separator, attributing a trailing name segment to the name", () => {
  assertEquals(decodeSymbolRef(encodeSymbolRef("src/a.go", "Helper")), {
    file: "src/a.go",
    name: "Helper",
  });
  assertEquals(decodeSymbolRef("src/a.go#Weird#"), { file: "src/a.go#Weird", name: "" });
  assertEquals(decodeSymbolRef("src/a.go#WeirdName"), { file: "src/a.go", name: "WeirdName" });
});

Deno.test("decodeSymbolRef: never throws on separators in both halves, and documents the attribution", () => {
  // Ambiguous by construction, because file paths never contain the separator in practice.
  // The last-separator split attributes the trailing segment to the name.
  // The contract is total rather than injective, so it always decodes.
  const decoded = decodeSymbolRef("src/a#b.go#Weird#Name");
  assertEquals(decoded, { file: "src/a#b.go#Weird", name: "Name" });
});

Deno.test("decodeSymbolRef: returns undefined for a leading separator", () => {
  assertEquals(decodeSymbolRef("#Helper"), undefined);
});

Deno.test("decodeSymbolRef: an empty name decodes to an empty string rather than undefined", () => {
  assertEquals(decodeSymbolRef("src/a.go#"), { file: "src/a.go", name: "" });
});

Deno.test("traverseModuleDependencies: never returns a symbol_references_symbol edge and never emits a composite node", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
      { from: "b.ts", to: encodeSymbolRef("c.ts", "Helper"), kind: "symbol_references_symbol" },
      { from: encodeSymbolRef("b.ts", "Helper"), to: "c.ts", kind: "symbol_references_symbol" },
    ],
  });

  const edges = traverseModuleDependencies(knowledge, "a.ts", 5);

  assertEquals(edges, [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
  ]);
  for (const edge of edges) {
    assertEquals(edge.kind, "file_imports_file_internal");
    assertEquals(edge.to.includes("#"), false);
  }
});

Deno.test("traverseModuleDependencies: is unchanged for file-only knowledge with no symbol edges", () => {
  const knowledge = makeKnowledge({
    relationships: [
      { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
      { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
    ],
  });

  assertEquals(traverseModuleDependencies(knowledge, "a.ts", 2), [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
    { from: "b.ts", to: "c.ts", kind: "file_imports_file_internal" },
  ]);
});
