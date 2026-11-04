/**
 * @module GodObjectsDocsTest
 * @path packages/lint-policy/tests/god_objects_docs_test.ts
 * @description Proves that the three development skills and the code style guide describe the God Class ceilings gate and the separate default seven-parameter gate, and that no skill still passes a threshold flag that the report script does not accept.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [.copilot/skills/exaix-development/SKILL.md, .copilot/skills/refactor/SKILL.md, .copilot/skills/clean-codebase/SKILL.md]
 */

import { assertMatch, assertNotMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const SKILLS = [
  ".copilot/skills/exaix-development/SKILL.md",
  ".copilot/skills/refactor/SKILL.md",
  ".copilot/skills/clean-codebase/SKILL.md",
];

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, path));
}

Deno.test("docs-skills: the three skills name the ceilings gate on WMC, TCC and ATFD and pass no threshold flag", async () => {
  for (const path of SKILLS) {
    const text = await read(path);
    assertStringIncludes(text, "check:god-objects", path);
    for (const metric of ["WMC", "TCC", "ATFD"]) assertMatch(text, new RegExp(`\\b${metric}\\b`), `${path}: ${metric}`);
    assertStringIncludes(text, "ceiling", path);
    assertNotMatch(text, /--threshold/, path);
    assertNotMatch(text, /6 metrics|six metrics/i, path);
  }
});

Deno.test("docs-checks: the code style guide states the god class gate and the separate default seven-parameter gate", async () => {
  const guide = await read("docs/CODE_STYLE.md");
  const section = guide.slice(guide.indexOf("## Complexity Limits"), guide.indexOf("## No Magic Values"));
  assertStringIncludes(section, "check:god-objects");
  assertStringIncludes(section, "God Class");
  assertStringIncludes(section, "exaix/max-params");
  assertStringIncludes(section, "deno task lint");
  assertMatch(section, /options object[^.]*(not prove|does not prove|do not prove)/i);
});
