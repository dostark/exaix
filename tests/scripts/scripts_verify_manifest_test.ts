/**
 * @module ManifestVerificationTest
 * @path tests/scripts_verify_manifest_test.ts
 * @description Verifies the integrity of the project manifest, ensuring that the
 * runtime manifest correctly matches the declared state in the repository.
 */

import { assert } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.203.0/path/mod.ts";
import { generateManifestObject } from "../../scripts/build_agents_index.ts";
import { REPO_ROOT, withRepoRoot } from "../helpers/repo_root.ts";

function normalize(obj: any) {
  const copy = JSON.parse(JSON.stringify(obj));
  delete copy.generated_at;
  if (Array.isArray(copy.docs)) {
    copy.docs.sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));
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
