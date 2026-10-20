/**
 * @module CodeStyleReferenceTest
 * @path packages/lint-policy/tests/code_style_reference_test.ts
 * @description Checks the moved guide and rejects stale paths in active repository files.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/code_style_anchor_test.ts, scripts/build_agents_index.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const GUIDE_PATH = "docs/CODE_STYLE.md";
const GUIDE_NAME = GUIDE_PATH.slice(GUIDE_PATH.indexOf("/") + 1);
const ROOT_REFERENCE = /(?<![\w/.-])(?:\.\.?\/)*CODE_STYLE\.md\b/;
const NUMBERED_CITATION = /CODE_STYLE(?:\.md)?(?:`|\s)*§\s*\d/;

async function trackedFiles(repo: string): Promise<string[]> {
  const result = await new Deno.Command("git", {
    args: ["ls-files", "-z"],
    cwd: join(REPO_ROOT, repo),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).split("\0").filter(Boolean);
}

Deno.test("the style guide lives under docs and the root has no file or alias", async () => {
  assert((await Deno.stat(join(REPO_ROOT, GUIDE_PATH))).isFile);
  await assertRejects(() => Deno.lstat(join(REPO_ROOT, GUIDE_NAME)), Deno.errors.NotFound);
  assertEquals(await Deno.realPath(join(REPO_ROOT, ".copilot/docs", GUIDE_NAME)), join(REPO_ROOT, GUIDE_PATH));
});

Deno.test("active tracked files have no root guide path or numbered style citation", async () => {
  const offenders: string[] = [];
  for (const repo of [".", "exaix-dev-docs", "exaix-team", "unslop-ts"]) {
    for (const path of await trackedFiles(repo)) {
      if (repo === "exaix-dev-docs" && path.startsWith("planning/")) continue;
      // Standalone engine tests use arbitrary catalog document names as fixture data.
      if (repo === "unslop-ts" && path.startsWith("tests/")) continue;
      const fullPath = join(REPO_ROOT, repo, path);
      const stat = await Deno.lstat(fullPath);
      if (!stat.isFile || stat.isSymlink) continue;
      const text = await Deno.readTextFile(fullPath);
      if (text.includes("\0")) continue;
      for (const [index, line] of text.split("\n").entries()) {
        const references = line.replace(/\[[^\]]*\]\(/g, "](");
        if (ROOT_REFERENCE.test(references) || NUMBERED_CITATION.test(line)) {
          offenders.push(`${repo}/${path}:${index + 1}: ${line.slice(0, 160)}`);
        }
      }
    }
  }
  assertEquals(offenders, [], "active references must name the moved guide and stable anchors");
});
