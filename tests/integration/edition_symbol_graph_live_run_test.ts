/**
 * @module EditionSymbolGraphLiveRunTest
 * @path tests/integration/edition_symbol_graph_live_run_test.ts
 * @description Phase 178 — the Solo and Team live-run legs. This phase adds an
 * Enterprise-only pass, so the property these editions require is the opposite
 * of the Enterprise one: the same analysis and the same fixture must produce no
 * symbol-level edge at all, under either edition string.
 *
 * Each case drives the real `initializeServices` composition root and the real
 * `PortalKnowledgeService.analyze()`, so it exercises edition selection, the
 * composer, and the registry wiring rather than a hand-built service.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EDITION_SOLO, EDITION_TEAM, PortalAnalysisMode } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { initializeServices } from "../../apps/exactl/src/init.ts";
import { readConfigFixture } from "./helpers/config_fixture.ts";

/** A TS-primary portal: the Solo builder resolves these imports without the flag. */
async function writeTsPortal(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_edition_ts_" });
  await Deno.writeTextFile(join(root, "main.ts"), 'import { helper } from "./helper.ts";\nhelper();\n');
  await Deno.writeTextFile(join(root, "helper.ts"), "export function helper(): void {}\n");
  return root;
}

function symbolEdges(knowledge: IPortalKnowledge) {
  return (knowledge.relationships ?? []).filter((e) => e.kind === "symbol_references_symbol");
}

function fileEdges(knowledge: IPortalKnowledge) {
  return (knowledge.relationships ?? []).filter((e) => e.kind === "file_imports_file_internal");
}

async function analyzeUnderEdition(edition: string, alias: string): Promise<IPortalKnowledge> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: `exa_edition_${edition}_` });
  const portalRoot = await writeTsPortal();
  const originalEdition = Deno.env.get("EXAIX_EDITION");
  try {
    const configPath = join(workspaceRoot, "config.toml");
    await Deno.writeTextFile(configPath, readConfigFixture("edition-symbol-graph-live", { root: workspaceRoot }));

    Deno.env.set("EXAIX_EDITION", edition);
    const services = await initializeServices({ configPath });
    assert(services.success, `the exactl root must initialize under ${edition}`);
    assert(services.portalKnowledge !== undefined, "portalKnowledge must be wired");

    // The flag must stay at its default, so the pass is gated off by config here.
    assertEquals(
      services.portalKnowledgeConfig?.enableSymbolLevelDependencyGraph ?? false,
      false,
      `${edition}: the symbol graph flag must default to off`,
    );

    return await services.portalKnowledge.analyze(alias, portalRoot, PortalAnalysisMode.STANDARD);
  } finally {
    if (originalEdition === undefined) Deno.env.delete("EXAIX_EDITION");
    else Deno.env.set("EXAIX_EDITION", originalEdition);
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(portalRoot, { recursive: true });
  }
}

Deno.test("[edition] a Solo live run produces zero symbol edges", async () => {
  const knowledge = await analyzeUnderEdition(EDITION_SOLO, "solo-live");

  assertEquals(symbolEdges(knowledge), [], "Solo must never emit a symbol-level edge");
  // The Solo file-level graph is phase-175's, and it must still work.
  assert(
    fileEdges(knowledge).length > 0,
    `the Solo file-level graph must survive, got ${JSON.stringify(knowledge.relationships)}`,
  );
  assertEquals(knowledge.metadata.mode, PortalAnalysisMode.STANDARD);
});

Deno.test("[edition] a Team live run produces zero symbol edges", async () => {
  const knowledge = await analyzeUnderEdition(EDITION_TEAM, "team-live");

  assertEquals(symbolEdges(knowledge), [], "Team must never emit a symbol-level edge");
  assert(
    fileEdges(knowledge).length > 0,
    `the Team file-level graph must survive, got ${JSON.stringify(knowledge.relationships)}`,
  );
  assertEquals(knowledge.metadata.mode, PortalAnalysisMode.STANDARD);
});

Deno.test("[edition] Solo and Team agree edge-for-edge on the same TS portal", async () => {
  const solo = await analyzeUnderEdition(EDITION_SOLO, "parity-solo");
  const team = await analyzeUnderEdition(EDITION_TEAM, "parity-team");

  // This phase must not move Solo output, and Team must not diverge from it here.
  const normalize = (k: IPortalKnowledge) =>
    [...(k.relationships ?? [])].map((e) => `${e.from}->${e.to}:${e.kind}`).sort();
  assertEquals(normalize(solo), normalize(team));
  assertEquals(symbolEdges(team), []);
});
