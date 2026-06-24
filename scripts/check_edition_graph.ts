#!/usr/bin/env -S deno run -A

/**
 * @module CheckEditionGraph
 * @path scripts/check_edition_graph.ts
 * @description Edition-leak graph gate — an INDEPENDENT, AST-grounded double-check of the
 *   text-based `[edition-leak]` rule in scripts/check_code_style.ts. It resolves an entry's
 *   real module graph via `deno info --json` and flags any STATIC (non-dynamic) runtime
 *   `code` edge from a module of one edition tier into a module of a HIGHER tier
 *   (MIT < Team < Enterprise). Because it reads the resolved graph (not source regex), a bug
 *   in the static rule's parsing — a specifier shape it fails to match, a guard it mis-reads —
 *   is caught here instead of silently leaking Team/Enterprise code into a lower-edition build.
 *
 *   Usage:
 *     deno run -A scripts/check_edition_graph.ts [--entry <path>] [--entry <path> ...]
 *
 *   Defaults to the daemon + exactl entrypoints. Exits non-zero on any static leak.
 *   It deliberately MIRRORS the static rule's exemptions: edition-gated DYNAMIC imports
 *   (`isDynamic`) and type-only edges (no `code` edge) are NOT leaks — exactly as
 *   check_code_style.ts exempts them — so the two gates agree on a clean tree (verified: 0).
 *
 * @architectural-layer Script
 * @dependencies [@std/flags, scripts/check_code_style.ts]
 * @related-files [scripts/check_code_style.ts, scripts/ci.ts, dev/Exaix_Edition_Architecture.md]
 */

import { parse } from "@std/flags";
import { editionTierOfPath } from "./check_code_style.ts";

/** A single resolved runtime edge in the module graph, reduced to what the gate needs. */
export interface IGraphEdge {
  /** Repo-relative path of the importing module. */
  from: string;
  /** Repo-relative path of the imported (runtime `code`) target. */
  to: string;
  /** True for dynamic-load edges; false for static top-level import edges. */
  isDynamic: boolean;
  /** 1-based source line of the edge (for the leak report). */
  line: number;
}

/** A static leak: a non-dynamic edge from a lower tier into a strictly higher tier. */
export interface IStaticEditionLeak extends IGraphEdge {
  fromTier: number;
  toTier: number;
}

/** Entry points whose graphs ship in a Solo (MIT) source-run deploy. */
const DEFAULT_ENTRIES = ["apps/daemon/main.ts", "apps/exactl/main.ts"];

/**
 * Pure core: return every STATIC edge whose target tier is strictly higher than its source
 * tier. Edges between untiered modules (scripts/, tests/, external) are ignored, as are
 * dynamic edges (the sanctioned edition-gated load) and intra-/down-tier edges. This mirrors
 * the `[edition-leak]` static rule exactly, but over the resolved graph rather than source text.
 */
export function findStaticEditionLeaks(edges: IGraphEdge[]): IStaticEditionLeak[] {
  const leaks: IStaticEditionLeak[] = [];
  for (const edge of edges) {
    if (edge.isDynamic) continue; // edition-gated dynamic load — the sanctioned exception
    const fromTier = editionTierOfPath(edge.from);
    const toTier = editionTierOfPath(edge.to);
    if (fromTier === null || toTier === null) continue; // untiered endpoint
    if (toTier > fromTier) {
      leaks.push({ ...edge, fromTier, toTier });
    }
  }
  return leaks;
}

interface IDenoInfoDepEndpoint {
  specifier?: string;
  span?: { start?: { line?: number } };
}
interface IDenoInfoDependency {
  specifier: string;
  code?: IDenoInfoDepEndpoint;
  isDynamic?: boolean;
}
interface IDenoInfoModule {
  specifier: string;
  dependencies?: IDenoInfoDependency[];
}
interface IDenoInfoGraph {
  modules: IDenoInfoModule[];
}

/** Strip a `file://<repoRoot>/x` specifier to its repo-relative path, else null (external). */
function repoRelative(specifier: string, repoRootUrl: string): string | null {
  if (!specifier.startsWith(repoRootUrl)) return null;
  return specifier.slice(repoRootUrl.length);
}

/** Resolve an entry's module graph and reduce it to runtime `code` edges. */
async function resolveGraphEdges(entry: string, repoRootUrl: string): Promise<IGraphEdge[]> {
  const cmd = new Deno.Command("deno", {
    args: ["info", "--json", entry],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  if (!out.success) {
    throw new Error(`deno info failed for ${entry}: ${new TextDecoder().decode(out.stderr)}`);
  }
  const graph = JSON.parse(new TextDecoder().decode(out.stdout)) as IDenoInfoGraph;
  const edges: IGraphEdge[] = [];
  for (const mod of graph.modules ?? []) {
    const from = repoRelative(mod.specifier, repoRootUrl);
    if (from === null) continue;
    for (const dep of mod.dependencies ?? []) {
      const targetSpec = dep.code?.specifier;
      if (!targetSpec) continue; // type-only / unresolved edge — not a runtime `code` edge
      const to = repoRelative(targetSpec, repoRootUrl);
      if (to === null) continue;
      edges.push({
        from,
        to,
        isDynamic: dep.isDynamic === true,
        line: (dep.code?.span?.start?.line ?? 0) + 1,
      });
    }
  }
  return edges;
}

async function main(): Promise<void> {
  const flags = parse(Deno.args, { string: ["entry"], collect: ["entry"] });
  const rawEntries = flags.entry as string[] | undefined;
  const entries = rawEntries && rawEntries.length > 0 ? rawEntries : DEFAULT_ENTRIES;
  const repoRootUrl = new URL("../", import.meta.url).href; // file://…/exaix/

  let total = 0;
  for (const entry of entries) {
    const edges = await resolveGraphEdges(entry, repoRootUrl);
    const leaks = findStaticEditionLeaks(edges);
    if (leaks.length === 0) {
      console.log(`✅ [edition-graph] ${entry}: no static higher-tier edges (graph agrees with [edition-leak]).`);
      continue;
    }
    total += leaks.length;
    console.error(`❌ [edition-graph] ${entry}: ${leaks.length} static edition leak(s) in the resolved graph:`);
    for (const leak of leaks) {
      console.error(`   ${leak.from}:${leak.line}  (tier ${leak.fromTier}) → ${leak.to}  (tier ${leak.toTier})`);
    }
  }

  if (total > 0) {
    console.error(
      `\n${total} static edition leak(s). The resolved module graph contains a non-dynamic import\n` +
        `from a lower edition into a higher one. If check:style reported 0 errors, its [edition-leak]\n` +
        `rule has a bug (a specifier shape or guard it mis-parsed) — that is exactly what this gate guards.`,
    );
    Deno.exit(1);
  }
  console.log(`\n✅ [edition-graph] all ${entries.length} entry graph(s) clean — no static edition leaks.`);
}

if (import.meta.main) {
  await main();
}
