/**
 * @module SweTaskPortalResetTest
 * @path tests/scenario_framework/tests/unit/swe_task_portal_reset_test.ts
 * @description Contract test for the swe_tasks corpus: every scenario must declare its
 * evaluated fixture portal in the `portals:` frontmatter (alias todo-app, a fixture
 * `source_path`, a `target_path` under $WORKSPACE_ROOT, git_init) and MUST NOT set it up via
 * an inline shell `setup-portal-repo` step. The clean reset (remove prior target, stale
 * worktrees, stale symlink) and the fixture staging are owned by the runner's
 * prepareDeclaredPortals — inline shell setup would bypass that isolation and re-introduce
 * cross-scenario / cross-model contamination of the benchmark in a shared sandbox.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/swe_tasks/async-ordering-bug.yaml, tests/scenario_framework/scenarios/swe_tasks/path-traversal-storage.yaml]
 */

import { assert } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SWE_TASKS_DIR = resolve(REPO_ROOT, "tests", "scenario_framework", "scenarios", "swe_tasks");

interface ISwePortalMount {
  alias?: string;
  source_path?: string;
  target_path?: string;
  git_init?: boolean;
}

interface ISweStep {
  id?: string;
  command?: string;
  args?: string[];
}

interface ISweScenario {
  portals?: ISwePortalMount[];
  steps?: ISweStep[];
}

/** The evaluated portal every swe_tasks scenario must declare (and nothing else mounts). */
const PORTAL_ALIAS = "todo-app";
const PORTAL_TARGET = "$WORKSPACE_ROOT/todo-app";

/** True when a shell step is the legacy inline fixture setup (cp fixture → todo-app). */
function isInlineFixtureSetup(step: ISweStep): boolean {
  if (step.command !== "sh" || !Array.isArray(step.args)) return false;
  const dashC = step.args.findIndex((a) => a === "-c");
  if (dashC < 0 || dashC + 1 >= step.args.length) return false;
  const shell = step.args[dashC + 1] ?? "";
  return shell.includes("cp ") && shell.includes(PORTAL_TARGET);
}

Deno.test(
  "[swe_tasks] every scenario declares its fixture portal declaratively (no inline setup shell)",
  async () => {
    const yamls: string[] = [];
    for (const entry of Deno.readDirSync(SWE_TASKS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".yaml")) yamls.push(resolve(SWE_TASKS_DIR, entry.name));
    }
    assert(yamls.length >= 30, `expected the swe_tasks corpus to be loaded, got ${yamls.length}`);

    const violations: string[] = [];
    for (const yamlPath of yamls) {
      const name = yamlPath.split("/").pop()!;
      const scenario = parseYaml(await Deno.readTextFile(yamlPath)) as ISweScenario;
      const portal = scenario.portals?.find((p) => p.alias === PORTAL_ALIAS);

      if (!portal) {
        violations.push(`${name}: missing portals entry alias="${PORTAL_ALIAS}"`);
        continue;
      }
      if (!portal.source_path || !portal.source_path.includes("fixtures/portals/")) {
        violations.push(`${name}: portals.todo-app must declare a fixtures/portals source_path`);
      }
      if (portal.target_path !== PORTAL_TARGET) {
        violations.push(`${name}: portals.todo-app must declare target_path = "${PORTAL_TARGET}"`);
      }
      if (portal.git_init !== true) {
        violations.push(`${name}: portals.todo-app must set git_init = true`);
      }

      const inlineSetup = (scenario.steps ?? []).find((s) => isInlineFixtureSetup(s));
      if (inlineSetup) {
        violations.push(
          `${name}: has an inline fixture-copy shell step (id=${inlineSetup.id}) — ` +
            "the runner's prepareDeclaredPortals owns staging",
        );
      }
      const addPortalStep = (scenario.steps ?? []).find((s) => s.id === "add-portal");
      if (addPortalStep) {
        violations.push(`${name}: has an inline 'add-portal' step — the runner mounts declared portals`);
      }
    }

    assert(
      violations.length === 0,
      `swe_tasks portal declaration violations:\n${violations.join("\n")}`,
    );
  },
);
