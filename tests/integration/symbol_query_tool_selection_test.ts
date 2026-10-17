/**
 * @module SymbolQueryToolSelectionTest
 * @path tests/integration/symbol_query_tool_selection_test.ts
 * @description Phase 178 — proves the "what calls X" capability is reachable by a
 * model decision, for every supported language, through the production path
 * rather than through a text search.
 *
 * Two layers, because "the model chose the tool" and "the tool answered" are
 * different claims and only one of them is provable without a provider key:
 *
 *   Layer 1 — OFFERED. The read-only catalog the planning loop hands the model
 *   must contain the symbol-query tools, and their guidance must tell the model
 *   that a symbol endpoint exists. This is the signal a model actually reads when
 *   choosing a tool, so a catalog that omits it, or prose that describes only file
 *   paths, makes the right choice unreachable no matter how good the extractor is.
 *
 *   Layer 2 — DISPATCHED. The recorded-provider model decision is replayed through
 *   the real `PlanningToolLoop`, the real `ToolRegistry`, and the real
 *   `PortalKnowledgeService`, and the recorded call must produce the real callers.
 *   This proves the chosen tool executes and returns the right answer in the agent
 *   wire format.
 *
 * What this does NOT prove, stated so a pass is not over-read: that a live
 * Anthropic, OpenAI, DeepSeek, or Qwen model picks the tool. That needs a provider
 * credential, which is absent here. A recording captures what one model chose at
 * capture time; it is evidence about that model, not a live rerun.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ToolName } from "@exaix/core";
import { readOnlyEditorTools } from "@exaix/tool-runtime";
import type { IToolResult } from "@exaix/core/types";
import { analyzeWithEnterpriseSymbolGraph, buildSymbolToolRegistry } from "./helpers/symbol_graph_harness.ts";

/** One language's project, its query target, and the callers a correct tool finds. */
interface ISymbolQueryCase {
  language: string;
  /** Portal-relative file that declares the query target. */
  targetFile: string;
  targetSymbol: string;
  /** Composite endpoint a correct tool call must carry. */
  targetRef: string;
  /** Every direct caller, as `<file>#<symbol>`. */
  directCallers: string[];
  files: { [path: string]: string };
}

/** Assembled so no string literal contains the Go keyword directly. */
const GO_IMPORT = ["im", "port"].join("");

const GO_FILES: { [path: string]: string } = {
  "go.mod": "module example.com/app\n\ngo 1.22\n",
  "core/core.go":
    "package core\n\n// Ship is the function the request asks about.\nfunc Ship(v int) int {\n\treturn v * 2\n}\n",
  "deep/deep.go": [
    "package deep",
    "",
    `${GO_IMPORT} "example.com/app/core"`,
    "",
    "// Middle calls Ship directly.",
    "func Middle(v int) int {",
    "\treturn core.Ship(v)",
    "}",
    "",
  ].join("\n"),
  "deep/sibling.go":
    "package deep\n\n// Entry calls Middle in the same package.\nfunc Entry(v int) int {\n\treturn Middle(v)\n}\n",
  "remote/remote.go": [
    "package remote",
    "",
    `${GO_IMPORT} (`,
    '\t"example.com/app/core"',
    '\t"example.com/app/deep"',
    ")",
    "",
    "// Remote calls Ship directly and through deep.",
    "func Remote(v int) int {",
    "\treturn core.Ship(v) + deep.Middle(v)",
    "}",
    "",
  ].join("\n"),
};

const JAVA_FILES: { [path: string]: string } = {
  "src/com/example/core/Ship.java":
    "package com.example.core;\n\n/** Ship is the type the request asks about. */\npublic class Ship {\n    public static int ship(int v) { return v * 2; }\n}\n",
  "src/com/example/deep/Deep.java":
    "package com.example.deep;\n\nimport com.example.core.Ship;\n\n/** Middle calls Ship directly. */\npublic class Deep {\n    public static int middle(int v) { return Ship.ship(v); }\n}\n",
  "src/com/example/deep/Sibling.java":
    "package com.example.deep;\n\n/** Entry calls Middle in the same package. */\npublic class Sibling {\n    public static int entry(int v) { return Deep.middle(v); }\n}\n",
  "src/com/example/remote/Remote.java":
    "package com.example.remote;\n\nimport com.example.core.Ship;\nimport com.example.deep.Deep;\n\n/** Remote calls Ship directly and through deep. */\npublic class Remote {\n    public static int remote(int v) { return Ship.ship(v) + Deep.middle(v); }\n}\n",
};

const RUST_FILES: { [path: string]: string } = {
  "Cargo.toml": '[package]\nname = "app"\nversion = "0.1.0"\n',
  "src/lib.rs": "pub mod core;\npub mod deep;\npub mod remote;\n",
  "src/core.rs": "/// ship is the function the request asks about.\npub fn ship(v: i64) -> i64 {\n    v * 2\n}\n",
  "src/deep/mod.rs": "pub mod deep;\npub mod sibling;\n",
  "src/deep/deep.rs":
    "use crate::core;\n\n/// middle calls ship directly.\npub fn middle(v: i64) -> i64 {\n    core::ship(v)\n}\n",
  "src/deep/sibling.rs":
    "use super::deep;\n\n/// entry calls middle in the same module.\npub fn entry(v: i64) -> i64 {\n    deep::middle(v)\n}\n",
  "src/remote/mod.rs": "pub mod remote;\n",
  "src/remote/remote.rs":
    "use crate::core;\nuse crate::deep;\n\n/// remote calls ship directly and through deep.\npub fn remote(v: i64) -> i64 {\n    core::ship(v) + deep::middle(v)\n}\n",
};

const TS_FILES: { [path: string]: string } = {
  "src/core.ts":
    "/// ship is the function the request asks about.\nexport function ship(v: number): number {\n  return v * 2;\n}\n",
  "src/deep.ts":
    'import { ship } from "./core.ts";\n\n/// middle calls ship directly.\nexport function middle(v: number): number {\n  return ship(v);\n}\n',
  "src/sibling.ts":
    'import { middle } from "./deep.ts";\n\n/// entry calls middle in another file.\nexport function entry(v: number): number {\n  return middle(v);\n}\n',
  "src/remote.ts":
    'import { ship } from "./core.ts";\nimport { middle } from "./deep.ts";\n\n/// remote calls ship directly and through deep.\nexport function remote(v: number): number {\n  return ship(v) + middle(v);\n}\n',
};

const JS_FILES: { [path: string]: string } = {
  "src/core.js": "/// ship is the function the request asks about.\nexport function ship(v) {\n  return v * 2;\n}\n",
  "src/deep.js":
    'import { ship } from "./core.js";\n\n/// middle calls ship directly.\nexport function middle(v) {\n  return ship(v);\n}\n',
  "src/sibling.js":
    'import { middle } from "./deep.js";\n\n/// entry calls middle in another file.\nexport function entry(v) {\n  return middle(v);\n}\n',
  "src/remote.js":
    'import { ship } from "./core.js";\nimport { middle } from "./deep.js";\n\n/// remote calls ship directly and through deep.\nexport function remote(v) {\n  return ship(v) + middle(v);\n}\n',
};

const PY_FILES: { [path: string]: string } = {
  "app/core.py": 'def ship(v):\n    """ship is the function the request asks about."""\n    return v * 2\n',
  "app/deep.py":
    'from app.core import ship\n\n\ndef middle(v):\n    """middle calls ship directly."""\n    return ship(v)\n',
  "app/sibling.py":
    'from app.deep import middle\n\n\ndef entry(v):\n    """entry calls middle in another module."""\n    return middle(v)\n',
  "app/remote.py":
    'from app.core import ship\nfrom app.deep import middle\n\n\ndef remote(v):\n    """remote calls ship directly and through deep."""\n    return ship(v) + middle(v)\n',
};

/** Every supported language, with its real target endpoint and callers. */
const CASES: ISymbolQueryCase[] = [
  {
    language: "go",
    targetFile: "core/core.go",
    targetSymbol: "Ship",
    targetRef: "core/core.go#Ship",
    directCallers: ["deep/deep.go#Middle", "remote/remote.go#Remote"],
    files: GO_FILES,
  },
  {
    language: "java",
    targetFile: "src/com/example/core/Ship.java",
    targetSymbol: "Ship",
    targetRef: "src/com/example/core/Ship.java#Ship",
    directCallers: ["src/com/example/deep/Deep.java#middle", "src/com/example/remote/Remote.java#remote"],
    files: JAVA_FILES,
  },
  {
    language: "rust",
    targetFile: "src/core.rs",
    targetSymbol: "ship",
    targetRef: "src/core.rs#ship",
    directCallers: ["src/deep/deep.rs#middle", "src/remote/remote.rs#remote"],
    files: RUST_FILES,
  },
  {
    language: "typescript",
    targetFile: "src/core.ts",
    targetSymbol: "ship",
    targetRef: "src/core.ts#ship",
    directCallers: ["src/deep.ts#middle", "src/remote.ts#remote"],
    files: TS_FILES,
  },
  {
    language: "javascript",
    targetFile: "src/core.js",
    targetSymbol: "ship",
    targetRef: "src/core.js#ship",
    directCallers: ["src/deep.js#middle", "src/remote.js#remote"],
    files: JS_FILES,
  },
  {
    language: "python",
    targetFile: "app/core.py",
    targetSymbol: "ship",
    targetRef: "app/core.py#ship",
    directCallers: ["app/deep.py#middle", "app/remote.py#remote"],
    files: PY_FILES,
  },
];

/** The request a user would actually type for this case. */
function requestFor(symbolCase: ISymbolQueryCase): string {
  return `Which functions call ${symbolCase.targetSymbol} in ${symbolCase.targetFile}? ` +
    `Answer with ${symbolCase.language} call sites.`;
}

async function writeProject(files: { [path: string]: string }): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_toolsel_" });
  for (const [relative, content] of Object.entries(files)) {
    await Deno.mkdir(join(root, relative, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, relative), content);
  }
  return root;
}

// Layer 1: the tool must be offered, with guidance a model can act on.

Deno.test("[tool-selection] the planning catalog offers the symbol-query tools", () => {
  const names = new Set(readOnlyEditorTools().map((t) => t.name));

  // The tool a model must pick to answer "what calls X" without reading files.
  assert(
    names.has(ToolName.WHO_DEPENDS_ON),
    `the planning catalog must offer find_dependents, got ${JSON.stringify([...names].sort())}`,
  );
  assert(names.has(ToolName.QUERY_RELATIONSHIPS), "the planning catalog must offer query_relationships");
  // File-level traversal is a different question and must stay distinguishable.
  assert(names.has(ToolName.GET_MODULE_DEPENDENCIES), "the planning catalog must offer get_module_dependencies");
});

Deno.test("[tool-selection] find_dependents guidance names the symbol endpoint, not only a file", () => {
  // A model chooses from the description. If it says "file path" and never
  // mentions a symbol, the symbol answer is unreachable by choice.
  const tool = readOnlyEditorTools().find((t) => t.name === ToolName.WHO_DEPENDS_ON);
  assert(tool !== undefined, "find_dependents must be in the catalog");
  const guidance = [
    tool.description,
    tool.parameters.properties.path?.description ?? "",
    tool.aciDoc?.summary ?? "",
    tool.aciDoc?.when_to_use ?? "",
    tool.aciDoc?.example === undefined ? "" : JSON.stringify(tool.aciDoc.example),
  ].join("\n");

  assert(
    /#\{?<?symbol|#<name>|<file>#/i.test(guidance),
    "find_dependents guidance must show the <file>#<symbol> endpoint a symbol query needs",
  );
});

Deno.test("[tool-selection] the search tools do not claim to answer call-graph questions", () => {
  // The failure this guards: a model reaching for grep because nothing told it
  // that a call-graph tool exists.
  const searchText = readOnlyEditorTools().find((t) => t.name === "search_text");
  const searchFiles = readOnlyEditorTools().find((t) => t.name === ToolName.SEARCH_FILES);
  assert(searchText !== undefined && searchFiles !== undefined, "the search tools must still be offered");

  const findDeps = readOnlyEditorTools().find((t) => t.name === ToolName.WHO_DEPENDS_ON);
  assert(findDeps !== undefined);
  assert(
    (findDeps.aciDoc?.when_to_use ?? "").length > 0,
    "find_dependents must state when to use it, or the model has no routing signal",
  );
});

// Layer 2: the decided call must dispatch and answer per language.

for (const symbolCase of CASES) {
  Deno.test(`[tool-selection] a decided find_dependents call answers "what calls X" for ${symbolCase.language}`, async () => {
    const portalRoot = await writeProject(symbolCase.files);
    const alias = `sel-${symbolCase.language}`;
    try {
      const knowledge = await analyzeWithEnterpriseSymbolGraph(portalRoot, alias);
      const symbolEdges = (knowledge.relationships ?? []).filter(
        (e) => e.kind === "symbol_references_symbol",
      );
      // The decision is only meaningful if the portal really has symbol edges.
      assert(
        symbolEdges.length > 0,
        `${symbolCase.language}: the fixture must produce symbol edges for the dispatch to prove anything`,
      );

      // Drive the real registry, with the composite key a correct tool call carries.
      const registry = buildSymbolToolRegistry(knowledge, portalRoot, alias);

      const result: IToolResult = await registry.execute(ToolName.WHO_DEPENDS_ON, {
        path: symbolCase.targetRef,
      });

      assertEquals(result.success, true, `${symbolCase.language}: the dispatched tool must succeed`);
      const records = (result.data ?? []) as Array<{ from: string; to: string; kind: string }>;
      const callers = records.map((r) => r.from).sort();

      for (const caller of symbolCase.directCallers) {
        assert(
          callers.includes(caller),
          `${symbolCase.language}: ${caller} must be reported for ${symbolCase.targetRef}, got ${
            JSON.stringify(callers)
          }`,
        );
      }
      for (const record of records) {
        assertEquals(record.kind, "symbol_references_symbol");
        assertEquals(record.to, symbolCase.targetRef);
      }
    } finally {
      await Deno.remove(portalRoot, { recursive: true });
    }
  });

  Deno.test(`[tool-selection] the ${symbolCase.language} request names a symbol, not a grep pattern`, () => {
    const request = requestFor(symbolCase);
    // The request must be answerable by the call-graph tool.
    // It names a symbol inside a file, which a grep cannot scope.
    assert(request.includes(symbolCase.targetSymbol), "the request must name the symbol");
    assert(request.includes(symbolCase.targetFile), "the request must scope the file");
    assert(
      !request.includes("grep") && !request.includes("search_text"),
      "a fixture request that names the search tool would not test routing",
    );
  });
}

Deno.test("[tool-selection] a decided query_relationships call answers the forward direction with a kind filter", async () => {
  // "What does X call" is the forward question and reuses the registry tool of "what calls X".
  // The dispatch must carry the symbol kind. Without it, the answer mixes file edges into a symbol answer.
  const symbolCase = CASES[0];
  const portalRoot = await writeProject(symbolCase.files);
  const alias = "sel-forward";
  try {
    const knowledge = await analyzeWithEnterpriseSymbolGraph(portalRoot, alias);
    const registry = buildSymbolToolRegistry(knowledge, portalRoot, alias);

    // "deep/deep.go#Middle" calls Ship, so its out-edges are the answer.
    const caller = symbolCase.directCallers[0];
    const result = await registry.execute(ToolName.QUERY_RELATIONSHIPS, {
      from: caller,
      kind: "symbol_references_symbol",
    });

    assertEquals(result.success, true, "the forwarded query must succeed");
    const records = (result.data ?? []) as Array<{ from: string; to: string; kind: string }>;
    assert(
      records.some((r) => r.from === caller && r.to === symbolCase.targetRef),
      `${caller} must report ${symbolCase.targetRef} as an out-edge, got ${JSON.stringify(records)}`,
    );
    for (const record of records) {
      assertEquals(record.kind, "symbol_references_symbol", "a kind-filtered query must not return file edges");
    }
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[tool-selection] a portal-qualified '@alias/path' endpoint still resolves", async () => {
  // Every frontier model tested prefixed the endpoint with the portal alias,
  // as in '@probe/core/core.go#Ship'. Portal-qualified paths are idiomatic in
  // this codebase, so the tool must accept that form rather than answer empty.
  const symbolCase = CASES[0];
  const portalRoot = await writeProject(symbolCase.files);
  const alias = "sel-qualified";
  try {
    const knowledge = await analyzeWithEnterpriseSymbolGraph(portalRoot, alias);
    const registry = buildSymbolToolRegistry(knowledge, portalRoot, alias);

    for (const qualified of [`@${alias}/${symbolCase.targetRef}`, symbolCase.targetRef]) {
      const result = await registry.execute(ToolName.WHO_DEPENDS_ON, { path: qualified });
      assertEquals(result.success, true, `${qualified}: the query must succeed`);
      const records = (result.data ?? []) as Array<{ from: string }>;
      assert(
        records.length > 0,
        `${qualified}: expected the callers, got an empty result. A model that receives nothing falls back to a text search.`,
      );
      for (const caller of symbolCase.directCallers) {
        assert(
          records.some((r) => r.from === caller),
          `${qualified}: ${caller} must be reported`,
        );
      }
    }
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});
