/**
 * @module InternalImportGraphPythonTest
 * @path packages/portal/knowledge/tests/internal_import_graph_python_test.ts
 * @description Tests for Python support in the internal import graph. `deno info`
 * resolves TypeScript and JavaScript only, so a Python portal needs its own
 * specifier resolver or it produces no file-import edges at all.
 * @architectural-layer Portal
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PortalAnalysisMode } from "@exaix/core";
import {
  createDefaultSymbolExtractorRegistry,
  InternalImportGraphBuilder,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";

async function writePortal(files: { [path: string]: string }): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_pygraph_" });
  for (const [relative, content] of Object.entries(files)) {
    await Deno.mkdir(join(root, relative, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, relative), content);
  }
  return root;
}

Deno.test("[internal import graph] resolves a Python `from x import y` into a file edge", async () => {
  const root = await writePortal({
    "app/core.py": "def ship(v):\n    return v * 2\n",
    "app/deep.py": "from app.core import ship\n\ndef level3(v):\n    return ship(v)\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["app/deep.py"]);
    assertEquals(
      result.edges.map((e) => `${e.from}->${e.to}`),
      ["app/deep.py->app/core.py"],
    );
    assertEquals(result.edges[0].kind, "file_imports_file_internal");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] resolves a plain Python `import x.y`", async () => {
  const root = await writePortal({
    "app/core.py": "def ship(v):\n    return v * 2\n",
    "app/consumer.py": "import app.core\n\ndef use():\n    return app.core.ship(1)\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["app/consumer.py"]);
    assertEquals(
      result.edges.map((e) => `${e.from}->${e.to}`),
      ["app/consumer.py->app/core.py"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] resolves a Python package to its __init__.py", async () => {
  const root = await writePortal({
    "lib/__init__.py": "from lib.util import helper\n",
    "lib/util.py": "def helper():\n    return 1\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["lib/__init__.py"]);
    assertEquals(
      result.edges.map((e) => `${e.from}->${e.to}`),
      ["lib/__init__.py->lib/util.py"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] ignores a third-party Python import", async () => {
  const root = await writePortal({
    "app/main.py": "import requests\nimport os\nfrom collections import OrderedDict\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["app/main.py"]);
    assertEquals(result.edges, [], "a stdlib or third-party import is not a portal file");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] drops a Python import that escapes the portal root", async () => {
  const root = await writePortal({
    "app/main.py": "from ....outside import thing\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["app/main.py"]);
    assertEquals(result.edges, [], "an escaping relative import must produce no edge");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] TypeScript resolution is unchanged", async () => {
  // The Python path must not disturb the deno-info path for TS/JS portals.
  const root = await writePortal({
    "main.ts": 'import { helper } from "./helper.ts";\nhelper();\n',
    "helper.ts": "export function helper(): void {}\n",
  });
  try {
    const result = await new InternalImportGraphBuilder().build(root, ["main.ts"]);
    assertEquals(
      result.edges.map((e) => `${e.from}->${e.to}`),
      ["main.ts->helper.ts"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[internal import graph] a Solo Python analysis persists file edges with the graph flag off", async () => {
  // Python's file-level graph must not depend on the Enterprise symbol-graph flag.
  const root = await writePortal({
    "app/core.py": "def ship(v):\n    return v * 2\n",
    "app/deep.py": "from app.core import ship\n\ndef level3(v):\n    return ship(v)\n",
  });
  const projectsDir = await Deno.makeTempDir({ prefix: "exa_pygraph_proj_" });
  try {
    const service = new PortalKnowledgeService({
      config: {
        autoAnalyzeOnMount: false,
        defaultMode: PortalAnalysisMode.STANDARD,
        quickScanLimit: 200,
        maxFilesToRead: 50,
        ignorePatterns: [".git"],
        staleness: 168,
        useLlmInference: false,
        relevanceSearchEmbeddingEnabled: false,
        enableAstAnalysis: false,
        enableTestExecution: false,
        enableVulnerabilityScan: false,
        enableGitHistoryAnalysis: false,
        enableSymbolLevelDependencyGraph: false,
      },
      memoryBank: {
        getProjectMemory: () => Promise.resolve(null),
        createProjectMemory: () => Promise.resolve(undefined),
        updateProjectMemory: () => Promise.resolve(undefined),
        listProjectMemories: () => Promise.resolve([]),
      } as never,
      symbolExtractorRegistry: createDefaultSymbolExtractorRegistry(),
    });

    const knowledge = await service.analyze("py-solo", root, PortalAnalysisMode.STANDARD);
    const fileEdges = (knowledge.relationships ?? []).filter(
      (e) => e.kind === "file_imports_file_internal",
    );
    assert(
      fileEdges.some((e) => e.from === "app/deep.py" && e.to === "app/core.py"),
      `expected the Python file edge with the flag off, got ${JSON.stringify(knowledge.relationships)}`,
    );
    assertEquals(
      (knowledge.relationships ?? []).some((e) => e.kind === "symbol_references_symbol"),
      false,
      "the flag being off must still suppress symbol edges",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(projectsDir, { recursive: true });
  }
});
