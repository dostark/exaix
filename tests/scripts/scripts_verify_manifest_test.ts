/**
 * @module ManifestVerificationTest
 * @path tests/scripts/scripts_verify_manifest_test.ts
 * @description Verifies the integrity of the project manifest, ensuring that the
 * runtime manifest correctly matches the declared state in the repository.
 */

import { assert, assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { generateDocsIndex, generateManifestObject } from "../../scripts/build_agents_index.ts";
import { REPO_ROOT, withRepoRoot } from "@exaix/testing";

interface IManifestDoc {
  path?: string;
  chunks?: string[];
}

interface IManifestLike {
  generated_at?: string;
  docs?: IManifestDoc[];
}

function normalize<T extends IManifestLike>(obj: T): T {
  const copy = JSON.parse(JSON.stringify(obj)) as T;
  delete copy.generated_at;
  if (Array.isArray(copy.docs)) {
    copy.docs.sort((a: IManifestDoc, b: IManifestDoc) => String(a.path).localeCompare(String(b.path)));
    for (const d of copy.docs) {
      if (Array.isArray(d.chunks)) d.chunks.sort();
    }
  }
  return copy;
}

Deno.test("verify manifest matches generated manifest", async () => {
  await withRepoRoot(async () => {
    const generated = await generateManifestObject();
    const manifestPath = join(REPO_ROOT, ".copilot", "manifest.json");
    const existingText = await Deno.readTextFile(manifestPath);
    const existing = JSON.parse(existingText);

    const a = normalize(generated);
    const b = normalize(existing);

    assert(JSON.stringify(a) === JSON.stringify(b), "manifest.json must match generated manifest");
  });
});

Deno.test("the index discovers knowledge-base documents directly under docs and writes their catalog links", async () => {
  const root = await Deno.makeTempDir({ prefix: "agent-index-docs-" });
  const previous = Deno.cwd();
  try {
    await Deno.mkdir(join(root, ".copilot"));
    await Deno.mkdir(join(root, "docs", "nested"), { recursive: true });
    const marked = ["---", "title: Style fixture", "copilot_knowledge_base: true", "---", "# Style"].join("\n");
    await Deno.writeTextFile(join(root, "docs", "style.md"), marked);
    await Deno.writeTextFile(join(root, "docs", "nested", "hidden.md"), marked);
    await Deno.writeTextFile(join(root, "docs", "unmarked.md"), "---\ntitle: Unmarked\n---\n");
    await Deno.writeTextFile(join(root, "ROOT.md"), marked);
    Deno.chdir(root);
    const manifest = await generateManifestObject();
    const paths = manifest.docs.map((doc) => String(doc.path));
    assertArrayIncludes(paths, ["ROOT.md", "docs/style.md"]);
    assertFalse(paths.includes("docs/nested/hidden.md"));
    assertFalse(paths.includes("docs/unmarked.md"));
    assertEquals(paths.filter((path) => path === "docs/style.md").length, 1);
    const indexPath = join(root, "index.md");
    await generateDocsIndex(manifest.docs, indexPath);
    assert((await Deno.readTextFile(indexPath)).includes("[../docs/style.md](../docs/style.md)"));
  } finally {
    Deno.chdir(previous);
    await Deno.remove(root, { recursive: true });
  }
});
