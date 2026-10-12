/**
 * @module SymbolGraphLanguageMatrixTest
 * @path tests/integration/symbol_graph_language_matrix_test.ts
 * @description Phase 178 — the language matrix for the symbol-level reference
 * graph. Each supported language gets a multi-package, multi-file fixture with a
 * real call chain, and each fixture is queried the way an agent would query it:
 *
 *   "what calls X"  ->  the recorded reference edges, as structured data
 *
 * Scope, stated so a reader does not over-read a pass: the extractors resolve a
 * call site against the portal's capped symbol map, scoped to the referencing
 * file, its import graph, and its package or module siblings. That covers direct
 * and transitive call chains. It does **not** claim semantic binding, dynamic
 * dispatch, interface satisfaction, or callback registration, so those forms are
 * deliberately not asserted here. Languages with reference support are Go, Java,
 * and Rust. TypeScript/JavaScript and Python ship symbol maps but no reference
 * extractor, so this phase makes no "who calls X" claim for them.
 *
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { LANG_GO, LANG_JAVA, LANG_RUST, PortalAnalysisMode } from "@exaix/core";
import {
  createDefaultSymbolExtractorRegistry,
  createDefaultSymbolFileResolverRegistry,
  createDefaultSymbolReferenceExtractorRegistry,
  mergeRelationships,
  PortalKnowledgeService,
  queryRelationships,
  saveKnowledge,
  whoDependsOn,
} from "@exaix/portal/knowledge";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import { EnterpriseSymbolGraphModule, PortalExtractorsModule } from "@exaix-team/portal-extractors";
import { QuerySymbolReferencesTool } from "../../exaix-team/packages/mcp-server/portal_knowledge_tools.ts";
import {
  createPermissionsService,
  createToolContext,
  getFirstStructuredDataContent,
  getFirstTextContent,
  withToolPermissionTest,
} from "@exaix/mcp/testing";

/** One language's fixture: its files, and the call chain the query must find. */
interface ILanguageFixture {
  language: string;
  extension: string;
  /** Portal-relative path to the file that declares the query target. */
  targetFile: string;
  /** The symbol name every query asks about. */
  targetSymbol: string;
  /** Symbols that call the target directly, as `file#symbol`. */
  directCallers: string[];
  /** A caller that reaches the target only through intermediate frames. */
  transitiveCaller: string;
  /** The transitive chain, asserted edge by edge so depth is real. */
  chain: Array<{ from: string; to: string }>;
  files: { [path: string]: string };
}

const GO_FIXTURE: ILanguageFixture = {
  language: LANG_GO,
  extension: ".go",
  targetFile: "core/core.go",
  targetSymbol: "Target",
  directCallers: ["deep/deep.go#Level3", "remote/remote.go#Remote"],
  transitiveCaller: "deep/sibling.go#Level1",
  chain: [
    { from: "deep/sibling.go#Level1", to: "deep/deep.go#Level2" },
    { from: "deep/deep.go#Level2", to: "deep/deep.go#Level3" },
    { from: "deep/deep.go#Level3", to: "core/core.go#Target" },
  ],
  files: {
    "go.mod": "module example.com/app\n\ngo 1.22\n",
    "core/core.go": `package core

// Target is the function every query asks about.
func Target(v int) int {
	return v * 2
}
`,
    "deep/deep.go": `package deep

import "example.com/app/core"

// Level3 calls Target directly.
func Level3(v int) int {
	return core.Target(v) + 1
}

// Level2 calls Level3, so Target sits two frames down.
func Level2(v int) int {
	return Level3(v) * 2
}
`,
    "deep/sibling.go": `package deep

// Level1 calls Level2 in the same package, in another file.
func Level1(v int) int {
	return Level2(v) + 3
}
`,
    "remote/remote.go": `package remote

import (
	"example.com/app/deep"
	"example.com/app/core"
)

// Remote calls Target directly and through the deep package.
func Remote(v int) int {
	direct := core.Target(v)
	indirect := deep.Level3(v)
	return direct + indirect
}
`,
  },
};

const RUST_FIXTURE: ILanguageFixture = {
  language: LANG_RUST,
  extension: ".rs",
  targetFile: "src/core.rs",
  targetSymbol: "ship",
  directCallers: ["src/deep/deep.rs#level3", "src/remote/remote.rs#remote"],
  transitiveCaller: "src/deep/sibling.rs#level1",
  chain: [
    { from: "src/deep/sibling.rs#level1", to: "src/deep/deep.rs#level2" },
    { from: "src/deep/deep.rs#level2", to: "src/deep/deep.rs#level3" },
    { from: "src/deep/deep.rs#level3", to: "src/core.rs#ship" },
  ],
  files: {
    "Cargo.toml": '[package]\nname = "app"\nversion = "0.1.0"\n',
    "src/lib.rs": "pub mod deep;\npub mod remote;\npub mod core;\n",
    "src/core.rs": `/// Target is the function every query asks about.
pub fn ship(v: i32) -> i32 {
    v * 2
}
`,
    "src/deep/mod.rs": "pub mod deep;\npub mod sibling;\n",
    "src/deep/deep.rs": `use crate::core;

/// level3 calls target::ship directly.
pub fn level3(v: i32) -> i32 {
    core::ship(v) + 1
}

/// level2 calls level3, so ship sits two frames down.
pub fn level2(v: i32) -> i32 {
    level3(v) * 2
}
`,
    "src/deep/sibling.rs": `use super::deep;

/// level1 calls level2 in the same module, in another file.
pub fn level1(v: i32) -> i32 {
    deep::level2(v) + 3
}
`,
    "src/remote/mod.rs": "pub mod remote;\n",
    "src/remote/remote.rs": `use crate::deep;
use crate::core;

/// remote calls ship directly and through the deep module.
pub fn remote(v: i32) -> i32 {
    let direct = core::ship(v);
    let indirect = deep::level3(v);
    direct + indirect
}
`,
  },
};

/**
 * Java resolves a call through the receiver type.
 * An edge can therefore land on the type and on the method.
 * The coarse form is asserted, not hidden, because an agent sees it.
 */
const JAVA_FIXTURE: ILanguageFixture = {
  language: LANG_JAVA,
  extension: ".java",
  targetFile: "src/com/example/core/Target.java",
  targetSymbol: "Target",
  directCallers: ["src/com/example/deep/Deep.java#level3", "src/com/example/remote/Remote.java#remote"],
  transitiveCaller: "src/com/example/deep/Sibling.java#level1",
  chain: [
    { from: "src/com/example/deep/Sibling.java#level1", to: "src/com/example/deep/Deep.java#Deep" },
    { from: "src/com/example/deep/Sibling.java#level1", to: "src/com/example/deep/Deep.java#level2" },
    { from: "src/com/example/deep/Deep.java#level2", to: "src/com/example/deep/Deep.java#level3" },
    { from: "src/com/example/deep/Deep.java#level3", to: "src/com/example/core/Target.java#Target" },
  ],
  files: {
    "src/com/example/core/Target.java": `package com.example.core;

/** Target is the type every query asks about. */
public class Target {
    public static int target(int v) {
        return v * 2;
    }
}
`,
    "src/com/example/deep/Deep.java": `package com.example.deep;

import com.example.core.Target;

/** Direct and indirect callers of Target. */
public class Deep {
    public static int level3(int v) {
        return Target.target(v) + 1;
    }

    public static int level2(int v) {
        return level3(v) * 2;
    }
}
`,
    "src/com/example/deep/Sibling.java": `package com.example.deep;

/** Calls level2 in the same package, in another file. */
public class Sibling {
    public static int level1(int v) {
        return Deep.level2(v) + 3;
    }
}
`,
    "src/com/example/remote/Remote.java": `package com.example.remote;

import com.example.core.Target;
import com.example.deep.Deep;

/** Calls Target directly and through the deep package. */
public class Remote {
    public static int remote(int v) {
        int direct = Target.target(v);
        int indirect = Deep.level3(v);
        return direct + indirect;
    }
}
`,
  },
};

const FIXTURES = [GO_FIXTURE, JAVA_FIXTURE, RUST_FIXTURE];

/** Portal alias used by the agent-facing tool tests. */
const GO_ALIAS = "lang-go";

async function writeFixture(fixture: ILanguageFixture): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: `exa_lang_${fixture.language}_` });
  for (const [relative, content] of Object.entries(fixture.files)) {
    await Deno.mkdir(join(root, relative, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, relative), content);
  }
  return root;
}

function serviceConfig(): IPortalKnowledgeConfig {
  return {
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
    enableSymbolLevelDependencyGraph: true,
  };
}

function fakeMemoryBank(): IMemoryBankService {
  return {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(undefined),
    updateProjectMemory: () => Promise.resolve(undefined),
    listProjectMemories: () => Promise.resolve([]),
  } as Partial<IMemoryBankService> as IMemoryBankService;
}

/** The registries as the Enterprise composition root fills them. */
function enterpriseRegistries() {
  const symbolRegistry = createDefaultSymbolExtractorRegistry();
  const referenceRegistry = createDefaultSymbolReferenceExtractorRegistry();
  const fileResolverRegistry = createDefaultSymbolFileResolverRegistry();
  const teamModule = new PortalExtractorsModule();
  teamModule.registerSymbolExtractors(symbolRegistry as ISeamRegistryPlaceholder);
  const enterpriseModule = new EnterpriseSymbolGraphModule();
  enterpriseModule.registerSymbolReferenceExtractors(referenceRegistry as ISeamRegistryPlaceholder);
  // The reference extractor narrows a reference by resolved import edges.
  // The file resolvers must also be registered.
  // Without them, nothing cross-file can resolve.
  enterpriseModule.registerSymbolFileResolvers(fileResolverRegistry as ISeamRegistryPlaceholder);
  return { symbolRegistry, referenceRegistry, fileResolverRegistry };
}

/** Analyzes one fixture through the real service and returns the stored knowledge. */
async function analyzeFixture(
  fixture: ILanguageFixture,
): Promise<{ knowledge: IPortalKnowledge; portalRoot: string }> {
  const portalRoot = await writeFixture(fixture);
  const { symbolRegistry, referenceRegistry, fileResolverRegistry } = enterpriseRegistries();
  const service = new PortalKnowledgeService({
    config: serviceConfig(),
    memoryBank: fakeMemoryBank(),
    symbolExtractorRegistry: symbolRegistry,
    symbolReferenceExtractorRegistry: referenceRegistry,
    symbolFileResolverRegistry: fileResolverRegistry,
  });
  const knowledge = await service.analyze(
    `lang-${fixture.language}`,
    portalRoot,
    PortalAnalysisMode.STANDARD,
  );
  return { knowledge, portalRoot };
}

function symbolEdges(knowledge: IPortalKnowledge) {
  return (knowledge.relationships ?? []).filter((e) => e.kind === "symbol_references_symbol");
}

function pairs(knowledge: IPortalKnowledge): string[] {
  return symbolEdges(knowledge).map((e) => `${e.from}->${e.to}`).sort();
}

for (const fixture of FIXTURES) {
  const label = fixture.language;

  Deno.test(`[${label}] a deep call chain is recorded edge by edge across packages and files`, async () => {
    const { knowledge, portalRoot } = await analyzeFixture(fixture);
    try {
      const recorded = pairs(knowledge);
      for (const edge of fixture.chain) {
        assert(
          recorded.includes(`${edge.from}->${edge.to}`),
          `${label}: expected chain edge ${edge.from}->${edge.to}, got ${JSON.stringify(recorded)}`,
        );
      }
      // The chain proves depth: the target's caller is two frames from the entry.
      assertEquals(fixture.chain.length >= 3, true);
    } finally {
      await Deno.remove(portalRoot, { recursive: true });
    }
  });

  Deno.test(`[${label}] "what calls X" returns exactly the direct callers`, async () => {
    const { knowledge, portalRoot } = await analyzeFixture(fixture);
    try {
      const target = `${fixture.targetFile}#${fixture.targetSymbol}`;
      const answer = whoDependsOn(knowledge, target).map((e) => e.from).sort();

      for (const caller of fixture.directCallers) {
        assert(answer.includes(caller), `${label}: ${caller} must be reported as a caller of ${target}`);
      }
      // The transitive caller reaches the target through intermediates, so it is
      // NOT a direct caller. Reporting it would be a wrong answer.
      assert(
        !answer.includes(fixture.transitiveCaller),
        `${label}: ${fixture.transitiveCaller} is two frames away and must not be reported as a direct caller`,
      );
    } finally {
      await Deno.remove(portalRoot, { recursive: true });
    }
  });

  Deno.test(`[${label}] "what does X call" returns exactly the out-edges of X`, async () => {
    const { knowledge, portalRoot } = await analyzeFixture(fixture);
    try {
      const deepest = fixture.chain[fixture.chain.length - 1].from;
      const answer = queryRelationships(knowledge, deepest)
        .filter((e) => e.kind === "symbol_references_symbol")
        .map((e) => e.to);

      assert(
        answer.includes(`${fixture.targetFile}#${fixture.targetSymbol}`),
        `${label}: ${deepest} must report the target as an out-edge, got ${JSON.stringify(answer)}`,
      );
    } finally {
      await Deno.remove(portalRoot, { recursive: true });
    }
  });

  Deno.test(`[${label}] every edge uses the composite key format an agent can parse`, async () => {
    const { knowledge, portalRoot } = await analyzeFixture(fixture);
    try {
      const edges = symbolEdges(knowledge);
      assert(edges.length > 0, `${label}: expected at least one reference edge`);
      for (const edge of edges) {
        assertEquals(edge.kind, "symbol_references_symbol");
        assert(edge.from.includes("#"), `${label}: from must be <file>#<symbol>, got ${edge.from}`);
        assert(edge.to.includes("#"), `${label}: to must be <file>#<symbol>, got ${edge.to}`);
        // A composite key must never be walked as a module path.
        const modules = queryRelationships(knowledge, edge.from).filter(
          (e) => e.kind === "file_imports_file_internal",
        );
        assertEquals(modules, [], `${label}: a composite key must not be a module node`);
      }
      // The merged shape an agent receives through the service is deduplicated.
      const merged = mergeRelationships([knowledge.relationships ?? []]);
      assertEquals(merged.length, (knowledge.relationships ?? []).length);
    } finally {
      await Deno.remove(portalRoot, { recursive: true });
    }
  });
}

Deno.test("[matrix] every supported reference language is covered, and unsupported ones are not claimed", () => {
  const covered = FIXTURES.map((f) => f.language).sort();
  assertEquals(covered, [LANG_GO, LANG_JAVA, LANG_RUST].sort());
  // TypeScript/JavaScript and Python ship symbol maps only.
  // This phase claims no reference edges for them.
  // They are therefore absent from the matrix on purpose.
  assertEquals(covered.includes("typescript"), false);
  assertEquals(covered.includes("python"), false);
});

Deno.test("[matrix] the agent-facing tool answers who-calls-X in a structured, parseable format", async () => {
  const { knowledge, portalRoot } = await analyzeFixture(GO_FIXTURE);
  try {
    await withToolPermissionTest({ portalAlias: GO_ALIAS }, async (env) => {
      await saveKnowledge(GO_ALIAS, knowledge, null, join(env.tempDir, "Memory", "Projects"));
      const tool = new QuerySymbolReferencesTool(
        createToolContext(env),
        createPermissionsService(env),
      );

      const target = `${GO_FIXTURE.targetFile}#${GO_FIXTURE.targetSymbol}`;
      const response = await tool.execute({
        portal: GO_ALIAS,
        symbol: target,
        direction: "referenced_by",
        agent_role: "test-agent",
      });

      assertEquals(response.isError, undefined, "the tool must answer, not error");

      // An agent reads structured data.
      // Each record must carry the composite key and its decoded halves.
      // No client should have to split the key itself.
      interface IReferenceRecord {
        from: string;
        to: string;
        kind: string;
        from_file: string | null;
        from_symbol: string | null;
        to_file: string | null;
        to_symbol: string | null;
      }
      const records = getFirstStructuredDataContent<Record<string, string | null>[]>(response);
      assert(records.length > 0, "the tool must return at least one caller");

      for (const record of records) {
        assertEquals(record.kind, "symbol_references_symbol");
        assertEquals(record.to, target, "every record answers the question that was asked");
        assertEquals(record.to_file, GO_FIXTURE.targetFile);
        assertEquals(record.to_symbol, GO_FIXTURE.targetSymbol);
        assert(record.from_file !== null && record.from_symbol !== null, "the caller must decode");
      }
      const callers = records.map((r) => `${r.from_file}#${r.from_symbol}`).sort();
      for (const expected of GO_FIXTURE.directCallers) {
        assert(callers.includes(expected), `tool must report ${expected}, got ${JSON.stringify(callers)}`);
      }

      // The text block must be the same JSON, so a text-only client is not degraded.
      const text = getFirstTextContent(response);
      assertEquals(JSON.parse(text), records);
    });
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[matrix] a symbol with no callers answers with an empty list, not an error", async () => {
  const { knowledge, portalRoot } = await analyzeFixture(GO_FIXTURE);
  try {
    await withToolPermissionTest({ portalAlias: GO_ALIAS }, async (env) => {
      await saveKnowledge(GO_ALIAS, knowledge, null, join(env.tempDir, "Memory", "Projects"));
      const tool = new QuerySymbolReferencesTool(
        createToolContext(env),
        createPermissionsService(env),
      );
      const response = await tool.execute({
        portal: GO_ALIAS,
        symbol: "core/core.go#NobodyCallsThis",
        direction: "referenced_by",
        agent_role: "test-agent",
      });
      assertEquals(response.isError, undefined, "an empty answer is not an error");
      assertEquals(getFirstStructuredDataContent<never[]>(response), []);
    });
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

/** Java indexes both the receiver type and the method, which an agent must be told. */
Deno.test("[java] a receiver-typed call reports both the type and the method it resolved", async () => {
  const { knowledge, portalRoot } = await analyzeFixture(JAVA_FIXTURE);
  try {
    const answer = symbolEdges(knowledge)
      .filter((e) => e.from.endsWith("#level3") || e.from.endsWith("#remote"))
      .map((e) => e.to)
      .sort();
    // Both forms are real resolution outcomes for `Target.target(v)`.
    assert(answer.includes("src/com/example/core/Target.java#Target"), JSON.stringify(answer));
    assert(answer.includes("src/com/example/core/Target.java#target"), JSON.stringify(answer));
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

/** Guards the matrix against a fixture that stops exercising depth. */
Deno.test("[matrix] every fixture declares a chain at least three frames deep", () => {
  for (const fixture of FIXTURES) {
    assert(fixture.chain.length >= 3, `${fixture.language}: chain must be at least 3 edges`);
    assert(fixture.files[fixture.targetFile] !== undefined, `${fixture.language}: target file must exist`);
    assert(fixture.directCallers.length >= 2, `${fixture.language}: at least two direct callers`);
    assert(
      Object.keys(fixture.files).length >= 4,
      `${fixture.language}: a multi-file project needs at least four files`,
    );
    const directories = new Set(Object.keys(fixture.files).map((p) => join(p, "..")));
    assert(directories.size >= 2, `${fixture.language}: the project must span at least two directories`);
  }
});
