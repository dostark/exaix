/**
 * @module FlowCatalogResolutionTest
 * @path tests/config/flow_catalog_resolution_test.ts
 * @description Phase 142 Step 23 (GAP-7) — the flow catalog has exactly one resolution rule.
 *
 *   Step 13 fixed `paths.flows` after `exactl flow list` reported "No flows found" against a
 *   workspace holding twenty flows. Three consumers read the corrected setting — `exactl init`,
 *   `FlowCommands` and `RequestProcessor` — and the daemon did not: it built its `FlowLoader`
 *   from `join(root, paths.blueprints, DEFAULT_FLOWS_PATH)`, recomposing the default's parts and
 *   never consulting `paths.flows`. The two rules agree on a default workspace and diverge the
 *   moment an operator overrides the setting, so the CLI would honour it and the daemon that
 *   actually runs the flows would ignore it.
 *
 *   The guard is source-level because the divergence is a call-site choice, not a value: a unit
 *   test over `getDefaultPaths` cannot see a consumer that declines to ask it.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/request/src/processor.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { ExaPathDefaults } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const PRODUCTION_ROOTS = ["apps", "packages"];

/** Directory segments whose contents are tests or fixtures rather than shipped code. */
const NON_PRODUCTION_SEGMENTS = ["/tests/", "/test/", "/fixtures/", "/node_modules/"];

/** Source with comments removed, so the guard below matches on constant *use*, not on a
 * comment that merely mentions it. */
function codeOnly(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

async function productionSources(): Promise<string[]> {
  const files: string[] = [];
  for (const root of PRODUCTION_ROOTS) {
    for await (const entry of walk(join(REPO_ROOT, root), { includeDirs: false, exts: [".ts"] })) {
      const posix = entry.path.replaceAll("\\", "/");
      if (NON_PRODUCTION_SEGMENTS.some((segment) => posix.includes(segment))) continue;
      if (posix.endsWith("_test.ts")) continue;
      files.push(entry.path);
    }
  }
  return files.sort();
}

/** Statements that build a path by combining the blueprints directory with the flows subfolder.
 * Recomposition is the defect: comparing against the constant is legitimate, joining it onto
 * `paths.blueprints` re-derives a setting the caller should have read. */
function recompositionStatements(source: string): string[] {
  return source
    .split(/[;\n]/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.includes("DEFAULT_FLOWS_PATH") && /blueprints/i.test(statement));
}

Deno.test("[flow-catalog] no production consumer recomposes the flows path from its default's parts", async () => {
  // `DEFAULT_FLOWS_PATH` is a *component* of `ExaPathDefaults.flows`. A call site that joins it
  // with `paths.blueprints` re-derives the setting instead of reading it, which is exactly how
  // the daemon came to ignore an operator's `paths.flows`.
  const offenders: string[] = [];
  for (const file of await productionSources()) {
    const source = codeOnly(await Deno.readTextFile(file));
    // The defaults table's own declaration is the one legitimate composition site — identified
    // by what the file declares rather than by path, so the rule survives the table moving.
    if (/export const ExaPathDefaults\b/.test(source)) continue;
    for (const statement of recompositionStatements(source)) {
      offenders.push(`${relative(REPO_ROOT, file)}: ${statement}`);
    }
  }
  assertEquals(
    offenders.sort(),
    [],
    "these files compose the flow catalog path from DEFAULT_FLOWS_PATH instead of reading " +
      `config.paths.flows:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("[flow-catalog] ExaPathDefaults.flows already composes the parts, so consumers need not", () => {
  // Pins the premise of the guard above: reading `paths.flows` yields the same directory the
  // recomposition produced, so the migration is behaviour-preserving on a default workspace.
  assertEquals(ExaPathDefaults.flows, "Blueprints/Flows");
  assertEquals(ExaPathDefaults.flows, `${ExaPathDefaults.blueprints}/Flows`);
});

Deno.test("[flow-catalog] a custom paths.flows resolves to one directory for every consumer", () => {
  // Every consumer must be `join(root, paths.flows)`. With an override, the recomposed form
  // (`root/<blueprints>/Flows`) is a *different* directory — which is the whole defect.
  const root = "/srv/workspace";
  const overridden = "Catalogs/MyFlows";

  const asConsumersResolveIt = join(root, overridden);
  const asTheDaemonUsedTo = join(root, ExaPathDefaults.blueprints, "Flows");

  assertEquals(asConsumersResolveIt, join("/srv/workspace", "Catalogs/MyFlows"));
  assertEquals(
    asTheDaemonUsedTo === asConsumersResolveIt,
    false,
    "the two rules must be demonstrably different under an override, or this test proves nothing",
  );
});

Deno.test("[path-defaults] a stale bare paths.flows value is rejected at config load", () => {
  // The exact value that produced "No flows found": the pre-Phase-142 default, which resolves to
  // `<root>/Flows` — a directory the catalog has never shipped in. Failing at load puts the error
  // where an operator can act on it, rather than four layers down as an empty catalog.
  const result = ConfigSchema.safeParse({ system: {}, paths: { flows: "Flows" } });

  assertEquals(result.success, false, 'a config carrying the stale bare `flows = "Flows"` must not parse');
  const message = result.success ? "" : result.error.issues.map((i) => i.message).join(" ");
  assertEquals(
    message.includes(ExaPathDefaults.flows),
    true,
    `the rejection must name the composite form (${ExaPathDefaults.flows}); got: ${message}`,
  );
});

Deno.test("[path-defaults] a deliberate non-legacy flows location still parses", () => {
  // The refinement targets one stale value, not bare subfolders in general — an operator who
  // genuinely keeps a catalog elsewhere must not be blocked.
  assertEquals(ConfigSchema.safeParse({ system: {}, paths: { flows: "Catalogs/MyFlows" } }).success, true);
  assertEquals(ConfigSchema.safeParse({ system: {}, paths: { flows: "MyFlows" } }).success, true);
  assertEquals(ConfigSchema.safeParse({ system: {} }).success, true);
});

Deno.test("[flow-catalog] the guard would catch the recomposition it replaced", () => {
  // Canary: the daemon's pre-fix statement, verbatim. A guard that no longer fires on the defect
  // it was written for is worse than none.
  const preFix = "new FlowLoader(join(config.system.root, config.paths.blueprints, DEFAULT_FLOWS_PATH))";
  assertEquals(recompositionStatements(preFix).length, 1);

  // And the legitimate shapes stay clean.
  assertEquals(recompositionStatements("if (paths.flows === DEFAULT_FLOWS_PATH) reject()").length, 0);
  assertEquals(recompositionStatements("const dir = join(root, config.paths.flows)").length, 0);
});
