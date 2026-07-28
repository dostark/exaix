/**
 * @module ScenarioPortalSourceTest
 * @path tests/eval/scenario_portal_source_test.ts
 * @architectural-layer Test
 * @description Phase 142 Step 24 (GAP-8) — no scenario mounts a portal from a machine-specific path.
 *
 *   `framework-smoke-validation` declared `source_path: "$HOME/git/Exaix"` and carries the `smoke`
 *   tag, so Step 7's `ci-core` tier — the per-PR gate — shipped one scenario that could not pass on
 *   any checkout not located at `~/git/Exaix` (including the one this repository develops on,
 *   which is lower-case). Step 7 measured the consequence as "29 scenarios, 28 passing" and
 *   recorded it without an owner.
 *
 *   A `$HOME`-relative path is worse than an absolute one: it looks portable. The rule is
 *   therefore positive — a portal source must resolve through a variable the runner substitutes
 *   to a location inside the repository or the sandbox.
 * @dependencies [@std/yaml]
 * @related-files [tests/eval/tools_pack_contract_test.ts, tests/scenario_framework/runner/config.ts]
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SCENARIOS_DIR = join(REPO_ROOT, "tests", "scenario_framework", "scenarios");

/**
 * Variables the runner substitutes to a repository- or sandbox-relative location.
 *
 * `$HOME` is deliberately absent: the runner does substitute it (the shell does), which is
 * exactly why the defect survived review — the path expanded to something, just not to a
 * directory that exists on any other machine.
 */
const PORTABLE_ROOTS: readonly string[] = ["$FRAMEWORK_HOME", "$WORKSPACE_ROOT", "$REPO_ROOT"];

interface IScenarioPortal {
  alias?: string;
  source_path?: string;
}

interface IScenarioFile {
  id?: string;
  portals?: IScenarioPortal[];
}

async function readScenarioPortals(): Promise<Array<{ file: string; id: string; source: string }>> {
  const declarations: Array<{ file: string; id: string; source: string }> = [];
  for await (const entry of walk(SCENARIOS_DIR, { includeDirs: false, exts: [".yaml"] })) {
    const scenario = parseYaml(await Deno.readTextFile(entry.path)) as IScenarioFile;
    for (const portal of scenario.portals ?? []) {
      if (!portal.source_path) continue;
      declarations.push({
        file: relative(REPO_ROOT, entry.path),
        id: scenario.id ?? entry.name,
        source: portal.source_path,
      });
    }
  }
  return declarations.sort((a, b) => a.file.localeCompare(b.file));
}

Deno.test("[scenario-contract] no scenario declares a portal source outside the repository", async () => {
  const offenders: string[] = [];
  for (const declaration of await readScenarioPortals()) {
    const portable = PORTABLE_ROOTS.some((root) => declaration.source.startsWith(root));
    if (portable) continue;
    offenders.push(`${declaration.id} (${declaration.file}): ${declaration.source}`);
  }
  assertEquals(
    offenders,
    [],
    "a portal source must start with a runner-substituted, repository-relative variable " +
      `(${PORTABLE_ROOTS.join(", ")}). These do not, so the scenario passes only on the machine ` +
      `that authored it:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("[scenario-contract] the guard would catch a $HOME-relative source", async () => {
  // Canary: the rule above is only worth having if it rejects the exact shape that shipped.
  const declarations = await readScenarioPortals();
  const seeded = [...declarations, { file: "seeded", id: "canary", source: "$HOME/git/Exaix" }];
  const rejected = seeded.filter((d) => !PORTABLE_ROOTS.some((root) => d.source.startsWith(root)));
  assertEquals(rejected.map((d) => d.id), ["canary"]);
});
