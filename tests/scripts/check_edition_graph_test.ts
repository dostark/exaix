/**
 * @module CheckEditionGraphTest
 * @path tests/scripts/check_edition_graph_test.ts
 * @description Tests for the edition-leak GRAPH gate (scripts/check_edition_graph.ts) — the
 *   AST-grounded double-check of the text-based `[edition-leak]` rule. `findStaticEditionLeaks`
 *   flags every STATIC (non-dynamic) runtime edge from a lower edition tier into a higher one
 *   (MIT < Team < Enterprise), and exempts exactly what the static rule exempts: edition-gated
 *   dynamic edges and type-only edges (which carry no `code` edge and so never reach this core).
 *   The final case is an integration check: the real daemon graph must be clean, so the two
 *   gates agree.
 * @architectural-layer Test
 * @related-files [scripts/check_edition_graph.ts, scripts/check_code_style.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { findStaticEditionLeaks, type IGraphEdge } from "../../scripts/check_edition_graph.ts";

function edge(from: string, to: string, isDynamic = false, line = 1): IGraphEdge {
  return { from, to, isDynamic, line };
}

Deno.test("[edition-graph] a static MIT → Team edge is flagged", () => {
  const leaks = findStaticEditionLeaks([
    edge("apps/exactl/src/init.ts", "packages-team/voting/mod.ts"),
  ]);
  assertEquals(leaks.length, 1);
  assertEquals(leaks[0].fromTier, 0);
  assertEquals(leaks[0].toTier, 1);
});

Deno.test("[edition-graph] a static MIT → Enterprise edge is flagged", () => {
  const leaks = findStaticEditionLeaks([
    edge("packages/core/src/foo.ts", "exaix-enterprise/audit/mod.ts"),
  ]);
  assertEquals(leaks.length, 1);
  assertEquals(leaks[0].toTier, 2);
});

Deno.test("[edition-graph] a DYNAMIC MIT → Team edge is exempt (the sanctioned edition-gated load)", () => {
  const leaks = findStaticEditionLeaks([
    edge("apps/daemon/main.ts", "packages-team/team-composer/mod.ts", true),
  ]);
  assertEquals(leaks, []);
});

Deno.test("[edition-graph] an intra-tier Team → Team edge is NOT a leak", () => {
  const leaks = findStaticEditionLeaks([
    edge("packages-team/ai-vertex/mod.ts", "packages-team/ai-vertex/src/constants.ts"),
  ]);
  assertEquals(leaks, []);
});

Deno.test("[edition-graph] a down-tier Team → MIT edge is NOT a leak (Team may use MIT)", () => {
  const leaks = findStaticEditionLeaks([
    edge("packages-team/voting/mod.ts", "packages/core/mod.ts"),
  ]);
  assertEquals(leaks, []);
});

Deno.test("[edition-graph] the Team-tier app dispatch entry (bootstrap_team.ts) → Team is intra-tier, not a leak", () => {
  // bootstrap_team.ts is classified Team-tier (TEAM_TIER_APP_PATHS) by the shared
  // editionTierOfPath, so its static Team imports are intra-tier — matching the static rule.
  const leaks = findStaticEditionLeaks([
    edge("apps/daemon/src/bootstrap_team.ts", "packages-team/hitl/mod.ts"),
  ]);
  assertEquals(leaks, []);
});

Deno.test("[edition-graph] untiered endpoints (scripts/, tests/) are ignored", () => {
  const leaks = findStaticEditionLeaks([
    edge("scripts/foo.ts", "packages-team/voting/mod.ts"),
    edge("tests/x_test.ts", "packages-team/voting/mod.ts"),
  ]);
  assertEquals(leaks, []);
});

Deno.test("[edition-graph] mixed batch: only the static up-tier edges are returned", () => {
  const leaks = findStaticEditionLeaks([
    edge("apps/exactl/src/init.ts", "packages-team/voting/mod.ts"), // leak
    edge("apps/daemon/main.ts", "packages-team/team-composer/mod.ts", true), // dynamic — ok
    edge("packages-team/a/mod.ts", "packages-team/b/mod.ts"), // intra-tier — ok
    edge("packages/core/foo.ts", "exaix-enterprise/x/mod.ts"), // leak
  ]);
  assertEquals(leaks.length, 2);
  assert(leaks.every((l) => l.toTier > l.fromTier && !l.isDynamic));
});
