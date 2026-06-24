#!/usr/bin/env -S deno run -A

/**
 * @module CheckEditionBundle
 * @path scripts/check_edition_bundle.ts
 * @description Edition build-artifact gate — flags modules from a HIGHER edition tier than
 *   the build's own in an entry's resolved module graph (what the source-text [edition-leak]
 *   rule cannot see, since deno compile/info follow dynamic imports too).
 * @architectural-layer Script
 * @dependencies [@exaix/core, @std/flags]
 * @related-files [scripts/check_code_style.ts, scripts/ci.ts, dev/Exaix_Edition_Architecture.md]
 *
 * Usage:
 *   deno run -A scripts/check_edition_bundle.ts [--edition solo|team|enterprise] [--entry <path>] [--fail]
 */

// Tiers: solo (no packages-team/, no exaix-enterprise/) < team (no exaix-enterprise/) <
// enterprise (anything). Default edition solo, default entry apps/daemon/main.ts.
//
// ⚠️ Advisory by default (exit 0 + report). Pass `--fail` to exit non-zero on offenders.
// The Solo daemon graph CURRENTLY contains Team modules (the edition-gated dynamic imports
// are still graph-reachable; `deno compile` bundles them). True binary exclusion needs a
// Solo-specific import map pointing @exaix-team/* at stubs — until then this stays advisory.
// See dev/Exaix_Edition_Architecture.md.

import { parse } from "@std/flags";
import { EDITION_ENTERPRISE, EDITION_SOLO, EDITION_TEAM } from "@exaix/core";

const EDITION_TIER: Record<string, number> = {
  [EDITION_SOLO]: 0,
  [EDITION_TEAM]: 1,
  [EDITION_ENTERPRISE]: 2,
};

/** Repo-relative prefix → the edition tier that owns it. */
const TIER_PREFIXES: { prefix: string; tier: number }[] = [
  { prefix: "exaix-enterprise/", tier: 2 },
  { prefix: "packages-team/", tier: 1 },
];

/** Strip a `file://...<repo>/` specifier down to its repo-relative path, else null. */
function repoRelativeOf(specifier: string): string | null {
  if (!specifier.startsWith("file://")) return null; // jsr:/https:/npm: — external
  const idx = specifier.indexOf("/packages-team/") >= 0
    ? specifier.indexOf("/packages-team/")
    : specifier.indexOf("/exaix-enterprise/");
  if (idx < 0) return null; // not a tiered module
  return specifier.slice(idx + 1); // drop the leading slash
}

/**
 * Return the repo-relative paths of modules in the graph that belong to a HIGHER edition
 * tier than the given build edition. Pure: takes the list of module specifiers from the graph.
 */
export function findHigherTierModulesInGraph(
  specifiers: string[],
  edition: string,
): string[] {
  const buildTier = EDITION_TIER[edition] ?? 0;
  const offenders: string[] = [];
  for (const spec of specifiers) {
    const rel = repoRelativeOf(spec);
    if (rel === null) continue;
    const moduleTier = TIER_PREFIXES.find((t) => rel.startsWith(t.prefix))?.tier ?? 0;
    if (moduleTier > buildTier) offenders.push(rel);
  }
  return offenders;
}

interface IDenoInfoModule {
  specifier: string;
}
interface IDenoInfoGraph {
  modules: IDenoInfoModule[];
}

/** Resolve the entry's module graph via `deno info --json` and return module specifiers. */
async function resolveGraphSpecifiers(entry: string): Promise<string[]> {
  const cmd = new Deno.Command("deno", {
    args: ["info", "--json", entry],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  if (!out.success) {
    const err = new TextDecoder().decode(out.stderr);
    throw new Error(`deno info failed for ${entry}: ${err}`);
  }
  const graph = JSON.parse(new TextDecoder().decode(out.stdout)) as IDenoInfoGraph;
  return graph.modules.map((m) => m.specifier);
}

async function main() {
  const flags = parse(Deno.args, {
    boolean: ["fail"],
    string: ["edition", "entry"],
    default: { edition: EDITION_SOLO, entry: "apps/daemon/main.ts" },
  });
  const edition = String(flags.edition);
  const entry = String(flags.entry);

  if (!(edition in EDITION_TIER)) {
    console.error(`❌ Unknown edition: ${edition}. Use solo, team, or enterprise.`);
    Deno.exit(1);
  }

  const specifiers = await resolveGraphSpecifiers(entry);
  const offenders = [...new Set(findHigherTierModulesInGraph(specifiers, edition))].sort();

  if (offenders.length === 0) {
    console.log(`✅ ${edition} build graph (${entry}) contains no higher-edition modules.`);
    Deno.exit(0);
  }

  const label = flags.fail ? "ERROR" : "WARN";
  console.log(
    `${label} [edition-bundle] ${edition} build graph (${entry}) contains ${offenders.length} higher-edition module(s):`,
  );
  const tiers = new Set(offenders.map((o) => o.split("/").slice(0, o.startsWith("packages-team/") ? 2 : 1).join("/")));
  for (const t of [...tiers].sort()) console.log(`  - ${t}/…`);
  console.log(
    "  These modules are reachable in the graph (deno compile bundles dynamic imports too).\n" +
      "  True exclusion needs a Solo/Team-specific import map pointing higher-tier specifiers at stubs.\n" +
      "  See dev/Exaix_Edition_Architecture.md. Run with --fail to enforce once stubs exist.",
  );
  Deno.exit(flags.fail ? 1 : 0);
}

if (import.meta.main) {
  main();
}
