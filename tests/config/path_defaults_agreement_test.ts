/**
 * @module ConfigPathDefaultsAgreementTest
 * @path tests/config/path_defaults_agreement_test.ts
 * @description Phase 142 Step 15 — the config schema's path defaults must resolve to the same
 *   directories `ExaPathDefaults` and the shipped `exa.config.toml` name.
 *
 *   `paths.flows` defaulted to the bare subfolder `"Flows"` while the catalog ships in
 *   `Blueprints/Flows`, so `FlowCommands` resolved `<root>/Flows` and `exactl flow list` reported
 *   "No flows found" against a workspace holding twenty flows. The repo's own `exa.config.toml`
 *   sets `flows = "Blueprints/Flows"` explicitly, which masked it everywhere development happens —
 *   the defect only appears in a workspace that relies on the defaults, which is what a scenario
 *   sandbox is. `ExaPathDefaults` had the composite right all along
 *   (`flows: "Blueprints/Flows"`); the schema and `getDefaultPaths` reached past it to the bare
 *   constant, and the same slip covers the seven `memory*` keys.
 *
 *   Three tables describing one directory layout is the shape of this defect; the test pins them
 *   to each other rather than to a fourth restatement.
 * @architectural-layer Test
 * @related-files [packages/schemas/src/config.ts, packages/core/src/config/paths.ts, packages/core/src/types/constants.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { ExaPathDefaults } from "@exaix/core";
import { getDefaultPaths } from "@exaix/core/config";
import { ConfigSchema } from "@exaix/schemas/config.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");

type PathTable = { [key: string]: string };

/** `system` has no whole-object default, so supply the empty object its own keys default from. */
function schemaDefaultPaths(): PathTable {
  return (ConfigSchema.parse({ system: {} }) as { paths: PathTable }).paths;
}

Deno.test("[path-defaults] the schema's defaults match ExaPathDefaults key for key", () => {
  const fromSchema = schemaDefaultPaths();
  const disagreements: string[] = [];
  for (const [key, expected] of Object.entries({ ...ExaPathDefaults } as PathTable)) {
    const actual = fromSchema[key];
    if (actual !== expected) disagreements.push(`paths.${key}: schema "${actual}" vs ExaPathDefaults "${expected}"`);
  }
  assertEquals(
    disagreements.sort(),
    [],
    `a workspace relying on defaults resolves these elsewhere:\n${disagreements.join("\n")}`,
  );
});

Deno.test("[path-defaults] getDefaultPaths agrees with ExaPathDefaults", () => {
  // The third table. `FlowCommands` and `RequestProcessor` both build their directory from
  // `config.paths.*`, so whichever of these populates the config decides where they look.
  const fromHelper: PathTable = { ...getDefaultPaths(REPO_ROOT) };
  const disagreements: string[] = [];
  for (const [key, expected] of Object.entries({ ...ExaPathDefaults } as PathTable)) {
    if (fromHelper[key] !== expected) {
      disagreements.push(`paths.${key}: getDefaultPaths "${fromHelper[key]}" vs ExaPathDefaults "${expected}"`);
    }
  }
  assertEquals(disagreements.sort(), [], disagreements.join("\n"));
});

Deno.test("[path-defaults] the shipped exa.config.toml agrees with the defaults it overrides", async () => {
  // The override is what hid the defect: development always ran with the correct value, so no
  // test, gate or manual run could see the wrong one.
  const shipped = parseToml(await Deno.readTextFile(join(REPO_ROOT, "exa.config.toml"))) as { paths?: PathTable };
  assert(shipped.paths, "expected the shipped config to declare a [paths] table");

  const disagreements: string[] = [];
  for (const [key, declared] of Object.entries(shipped.paths)) {
    const expected = ({ ...ExaPathDefaults } as PathTable)[key];
    if (expected !== undefined && declared !== expected) {
      disagreements.push(`paths.${key}: exa.config.toml "${declared}" vs ExaPathDefaults "${expected}"`);
    }
  }
  assertEquals(disagreements.sort(), [], disagreements.join("\n"));
});

Deno.test("[path-defaults] a default-configured workspace resolves flows to the shipped catalog", async () => {
  // The end the whole chain exists for: `Blueprints/Flows` is where the flows actually are.
  const flowsDir = join(REPO_ROOT, schemaDefaultPaths().flows);
  const stat = await Deno.stat(flowsDir).catch(() => null);
  assert(stat?.isDirectory, `paths.flows default resolves to ${flowsDir}, which is not a directory`);

  let flowFiles = 0;
  for await (const entry of Deno.readDir(flowsDir)) {
    if (entry.isFile && entry.name.endsWith(".flow.yaml")) flowFiles += 1;
  }
  assert(flowFiles > 0, `no .flow.yaml files under the default paths.flows (${flowsDir})`);
});
