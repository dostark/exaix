/**
 * @module GoPortCoreL0ReferenceTest
 * @path tests/scripts/go_port_core_l0_reference_test.ts
 * @description Exercises the deterministic core-l0 reference fixture generator and digest manifest.
 * @architectural-layer Test
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { CORE_L0_REFERENCE_GROUPS, writeCoreL0Reference } from "../../scripts/go_port/core_l0_reference.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const COMMITTED_DIR = join(ROOT, "exaix-go", "internal", "core", "l0", "testdata", "reference");
const REFERENCE = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";

Deno.test("go-port-core-l0-reference: generator output is deterministic and covers every kept group", async () => {
  await withTempDir(async (dir) => {
    const firstDir = join(dir, "first");
    const secondDir = join(dir, "second");
    await writeCoreL0Reference(ROOT, firstDir);
    await writeCoreL0Reference(ROOT, secondDir);

    const manifest1 = await Deno.readTextFile(join(firstDir, "manifest.json"));
    const manifest2 = await Deno.readTextFile(join(secondDir, "manifest.json"));
    assertEquals(manifest1, manifest2);

    const parsed = JSON.parse(manifest1) as {
      reference_parent: string;
      files: Record<string, string>;
    };
    assertEquals(parsed.reference_parent, REFERENCE);
    for (const group of CORE_L0_REFERENCE_GROUPS) {
      const filename = `${group}.json`;
      assert(typeof parsed.files[filename] === "string" && parsed.files[filename].length === 64);
      const a = await Deno.readTextFile(join(firstDir, filename));
      const b = await Deno.readTextFile(join(secondDir, filename));
      assertEquals(a, b);
    }
  });
});

Deno.test("go-port-core-l0-reference: committed manifest matches generated fixture digests", async () => {
  const raw = await Deno.readTextFile(join(COMMITTED_DIR, "manifest.json"));
  const parsed = JSON.parse(raw) as { reference_parent: string; files: Record<string, string> };
  assertEquals(parsed.reference_parent, REFERENCE);
  for (const group of CORE_L0_REFERENCE_GROUPS) {
    assert(Boolean(parsed.files[`${group}.json`]), `missing fixture ${group}.json`);
  }
});
