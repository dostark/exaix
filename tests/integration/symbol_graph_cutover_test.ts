/**
 * @module SymbolGraphCutoverTest
 * @path tests/integration/symbol_graph_cutover_test.ts
 * @description Phase 178 Step 8 — the phase's integration and cutover evidence.
 * A regular (non-quick) analysis with the Enterprise symbol graph enabled must
 * produce symbol_references_symbol edges from the real Go fixture, persist them
 * to knowledge.json, and expose them through the tolerant reader. The same run
 * with the flag off must produce none.
 *
 * The composition-root wiring itself is covered by
 * `paidEditionCapabilityModules` in tests/integration/team_extractor_wiring_test.ts,
 * which proves the Enterprise module is registered only for the enterprise
 * edition string.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EDITION_ENTERPRISE } from "@exaix/core";
import {
  createDefaultSymbolReferenceExtractorRegistry,
  loadKnowledge,
  mergeRelationships,
  PortalKnowledgeService,
  saveKnowledge,
} from "@exaix/portal/knowledge";
import { PortalAnalysisMode } from "@exaix/core";
import { initializeServices } from "../../apps/exactl/src/init.ts";
import {
  enterpriseRegistries,
  fakeMemoryBank,
  symbolEdges,
  symbolGraphServiceConfig,
} from "./helpers/symbol_graph_harness.ts";

const GO_PORTAL = join(
  Deno.cwd(),
  "exaix-team/packages/portal-extractors/tests/fixtures/go_reference_portal",
);

function enterpriseRegistry() {
  return enterpriseRegistries().referenceRegistry;
}

Deno.test("[cutover] an Enterprise-enabled analysis produces persisted Go symbol edges", async () => {
  const projectsDir = await Deno.makeTempDir({ prefix: "exa_cutover_enterprise_" });
  const alias = "go-reference-enterprise";
  try {
    const service = new PortalKnowledgeService({
      config: symbolGraphServiceConfig(true),
      memoryBank: fakeMemoryBank(),
      ...(() => {
        const r = enterpriseRegistries();
        return {
          symbolExtractorRegistry: r.symbolRegistry,
          symbolReferenceExtractorRegistry: r.referenceRegistry,
          symbolFileResolverRegistry: r.fileResolverRegistry,
        };
      })(),
    });

    const knowledge = await service.analyze(alias, GO_PORTAL, PortalAnalysisMode.STANDARD);
    const edges = symbolEdges(knowledge);

    assert(edges.length > 0, `expected symbol edges, got ${JSON.stringify(knowledge.relationships)}`);
    assertEquals(
      edges.some((e) => e.to === "helper/helper.go#Double" && e.from === "main.go#Run"),
      true,
      `expected the Run -> Double edge, got ${JSON.stringify(edges)}`,
    );
    for (const edge of edges) {
      assert(edge.from.includes("#") && edge.to.includes("#"), `composite endpoints required: ${JSON.stringify(edge)}`);
    }

    // Persist and read back through the tolerant reader.
    await saveKnowledge(alias, knowledge, null, projectsDir);
    const reloaded = await loadKnowledge(alias, projectsDir);
    assert(reloaded !== null, "the snapshot must load back");
    assertEquals(symbolEdges(reloaded!).length, edges.length);
  } finally {
    await Deno.remove(projectsDir, { recursive: true });
  }
});

Deno.test("[cutover] the same analysis with the flag off produces zero symbol edges", async () => {
  const projectsDir = await Deno.makeTempDir({ prefix: "exa_cutover_off_" });
  const alias = "go-reference-flag-off";
  try {
    const service = new PortalKnowledgeService({
      config: symbolGraphServiceConfig(false),
      memoryBank: fakeMemoryBank(),
      symbolReferenceExtractorRegistry: enterpriseRegistry(),
    });

    const knowledge = await service.analyze(alias, GO_PORTAL, PortalAnalysisMode.STANDARD);

    assertEquals(symbolEdges(knowledge), [], "the flag must gate the symbol pass");
    await saveKnowledge(alias, knowledge, null, projectsDir);
    const reloaded = await loadKnowledge(alias, projectsDir);
    assert(reloaded !== null);
    assertEquals(symbolEdges(reloaded!), []);
  } finally {
    await Deno.remove(projectsDir, { recursive: true });
  }
});

Deno.test("[cutover] the flag off reproduces the relationships of a Team-style run", async () => {
  const alias = "go-reference-compare";
  const teamStyle = new PortalKnowledgeService({
    config: symbolGraphServiceConfig(false),
    memoryBank: fakeMemoryBank(),
    symbolReferenceExtractorRegistry: createDefaultSymbolReferenceExtractorRegistry(),
  });
  const enterpriseFlagOff = new PortalKnowledgeService({
    config: symbolGraphServiceConfig(false),
    memoryBank: fakeMemoryBank(),
    symbolReferenceExtractorRegistry: enterpriseRegistry(),
  });

  const first = await teamStyle.analyze(alias, GO_PORTAL, PortalAnalysisMode.STANDARD);
  const second = await enterpriseFlagOff.analyze(alias, GO_PORTAL, PortalAnalysisMode.STANDARD);

  // The merge helper is deterministic, so the same input yields the same edges.
  assertEquals(
    mergeRelationships([first.relationships ?? []]),
    mergeRelationships([second.relationships ?? []]),
  );
});

Deno.test("[cutover] the phase's Enterprise edition constant is the one the module asserts", () => {
  // Guards the delivery-vehicle decision: the module is wired only for this string.
  assertEquals(EDITION_ENTERPRISE, "enterprise");
});

/** A workspace config that enables the Enterprise symbol graph. */
function enterpriseConfigToml(root: string): string {
  return `
[system]
root = "${root}"
log_level = "error"

[paths]
runtime = "./.exa"
memory = "Memory"
workspace = "Workspace"
flows = "Workspace/Flows"
blueprints = "Blueprints"

[agents]
default_model = "mock:test"

[models."mock:test"]
provider = "mock"
model = "test"

[portal_knowledge]
default_mode = "standard"
enable_symbol_level_dependency_graph = true
`;
}

Deno.test("[cutover] the real exactl composition root reaches the symbol graph when EXAIX_EDITION=enterprise", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "exa_cutover_root_" });
  const alias = "go-reference-cli-root";
  const originalEdition = Deno.env.get("EXAIX_EDITION");
  try {
    const configPath = join(workspaceRoot, "config.toml");
    await Deno.writeTextFile(configPath, enterpriseConfigToml(workspaceRoot));

    // The CLI composition root: edition selection, composer, and registry wiring.
    Deno.env.set("EXAIX_EDITION", EDITION_ENTERPRISE);
    const services = await initializeServices({ configPath });

    assert(services.success, "the exactl composition root must initialize");
    assert(services.portalKnowledge !== undefined, "portalKnowledge must be wired");

    // The config builder threaded the flag into the service config.
    assertEquals(
      services.portalKnowledgeConfig?.enableSymbolLevelDependencyGraph,
      true,
      "buildPortalKnowledgeConfig must carry the flag from the CLI config",
    );

    const knowledge = await services.portalKnowledge.analyze(alias, GO_PORTAL, PortalAnalysisMode.STANDARD);
    const edges = symbolEdges(knowledge);

    assert(
      edges.length > 0,
      `the CLI root must reach the symbol extractors, got ${JSON.stringify(knowledge.relationships)}`,
    );
    assertEquals(
      edges.some((e) => e.to === "helper/helper.go#Double"),
      true,
      `expected the Run -> Double edge through the CLI root, got ${JSON.stringify(edges)}`,
    );
  } finally {
    if (originalEdition === undefined) Deno.env.delete("EXAIX_EDITION");
    else Deno.env.set("EXAIX_EDITION", originalEdition);
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
