/**
 * @module ManifestVerificationTest
 * @path tests/scripts/scripts_verify_manifest_test.ts
 * @description Verifies the integrity of the project manifest, ensuring that the
 * runtime manifest correctly matches the declared state in the repository.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { generateManifestObject } from "../../scripts/build_agents_index.ts";
import { REPO_ROOT, withRepoRoot } from "../helpers/repo_root.ts";

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
