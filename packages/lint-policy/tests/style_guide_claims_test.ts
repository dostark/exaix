/**
 * @module StyleGuideClaimsTest
 * @path packages/lint-policy/tests/style_guide_claims_test.ts
 * @description Proves that the rule status, the check tags, and the tasks that the Exaix style guides name match the catalog and deno.json.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/fixtures/catalog_v1.json, packages/lint-policy/tests/code_style_anchor_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { POLICY_CATALOG } from "../src/policy_config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const POLICY_GUIDE = "packages/lint-policy/docs/style_guide.md";
const GUIDES = ["docs/CODE_STYLE.md", POLICY_GUIDE, "unslop-ts/docs/style_guide.md"];
const ENFORCEMENT_HEADING = "## Enforcement Status";
const PLUGIN_NAME = "exaix";
const PLUGIN_ENGINE = "plugin";
const SCRIPT_ENGINE = "script";
const SEVERITY_ERROR = "error";
const SEVERITY_OFF = "off";
const SEVERITY_WARN = "warn";
const BACKTICKED_ID = /`((?:exaix\/)?[a-z][a-z0-9-]*)`/g;
const BACKTICKED_TAG = /`\[([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\]`/g;
const TASK_REFERENCE = /deno task ([a-z][a-z0-9:-]*)/g;
const RULE_ID_PREFIX = /^\*\*(.+?)\*\*/;

interface ICatalogRule {
  readonly engine: string;
  readonly severity: string;
}

interface IDenoConfig {
  readonly tasks: Readonly<Record<string, string>>;
}

const RULES: Readonly<Record<string, ICatalogRule>> = POLICY_CATALOG.rules;

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, path));
}

/** The ids that the Enforcement Status bullet with the given label names. */
function statusIds(section: string, label: string): string[] {
  const bullets = section.split(/\n(?=- )/).filter((bullet) => bullet.startsWith("- ")).map((bullet) =>
    bullet.split("\n\n")[0]
  );
  const bullet = bullets.find((candidate) => RULE_ID_PREFIX.exec(candidate.slice(2))?.[1].startsWith(label));
  assert(bullet !== undefined, `the section has no bullet that starts with ${label}`);
  return [...bullet.matchAll(BACKTICKED_ID)].map((match) => match[1]).filter((id) => id !== "severity: error");
}

function catalogIds(engine: string, severity: string): string[] {
  return Object.entries(RULES)
    .filter(([, rule]) => rule.engine === engine && rule.severity === severity)
    .map(([id]) => id)
    .sort();
}

Deno.test("the Enforcement Status lists equal the rule status of the catalog", async () => {
  const guide = await read(POLICY_GUIDE);
  const section = guide.slice(guide.indexOf(ENFORCEMENT_HEADING));
  const lists: ReadonlyArray<readonly [string, string, string]> = [
    ["Plugin gates", PLUGIN_ENGINE, SEVERITY_ERROR],
    ["Parked plugin rules", PLUGIN_ENGINE, SEVERITY_OFF],
    ["Script gates", SCRIPT_ENGINE, SEVERITY_ERROR],
    ["Script warnings", SCRIPT_ENGINE, SEVERITY_WARN],
  ];
  for (const [label, engine, severity] of lists) {
    const named = statusIds(section, label).filter((id) => id in RULES).sort();
    assertEquals(named, catalogIds(engine, severity), `${label} differs from the catalog`);
  }
});

Deno.test("every plugin rule and check tag that a guide names exists in the catalog", async () => {
  for (const path of GUIDES) {
    const text = await read(path);
    const pluginIds = [...text.matchAll(BACKTICKED_ID)].map((match) => match[1]).filter((id) =>
      id.startsWith(`${PLUGIN_NAME}/`)
    );
    for (const id of pluginIds) assert(id in RULES, `${path} names ${id}, which the catalog does not hold`);
    for (const match of text.matchAll(BACKTICKED_TAG)) {
      assert(match[1] in RULES, `${path} names the tag [${match[1]}], which the catalog does not hold`);
    }
  }
});

Deno.test("every task that a guide runs exists in deno.json", async () => {
  const config: IDenoConfig = JSON.parse(await read("deno.json"));
  for (const path of GUIDES) {
    const missing = [...(await read(path)).matchAll(TASK_REFERENCE)].map((match) => match[1])
      .filter((task) => !(task in config.tasks));
    assertEquals(missing, [], `${path} names a task that deno.json does not define`);
  }
});

Deno.test("final_guide_claims_match_policy_and_engine", async () => {
  const guide = await read(POLICY_GUIDE);
  for (
    const token of [
      "unslop.config.json",
      "layout.json",
      "lint:report",
      "lint:report:write",
      "unslop:write",
      "tests/fixtures/catalog_v1.json",
    ]
  ) {
    assert(guide.includes(token), `the guide does not name ${token}`);
  }
  assertEquals(POLICY_CATALOG.rules["duplicate-type"].limits !== null, true);
  assertEquals(POLICY_CATALOG.rules["exaix/no-explicit-unknown"].engine, "plugin");
});
