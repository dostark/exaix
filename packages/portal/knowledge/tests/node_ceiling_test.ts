/**
 * @module NodeCeilingTest
 * @path packages/portal/knowledge/tests/node_ceiling_test.ts
 * @description Tests for the per-file syntax-node ceiling that bounds symbol
 * extraction. The ceiling must skip an over-budget file, and it must survive a
 * deeply nested tree without exhausting the call stack.
 * @architectural-layer Portal
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SYMBOL_EXTRACT_MAX_NODES } from "@exaix/core";
import { PythonSymbolExtractor } from "@exaix/portal/knowledge";

/** Writes a Python file whose call nesting produces a specified node depth. */
async function writeDeeplyNested(root: string, depth: number): Promise<void> {
  const expression = "f(".repeat(depth) + "1" + ")".repeat(depth);
  await Deno.writeTextFile(join(root, "huge.py"), `def big():\n    return ${expression}\n`);
}

Deno.test("[node ceiling] a deeply nested file does not exhaust the call stack", async () => {
  const root = await Deno.makeTempDir({ prefix: "exa_node_ceiling_" });
  try {
    // Nesting this deep is far past the value a recursive counter can walk.
    await writeDeeplyNested(root, 200_000);
    const stat = await Deno.stat(join(root, "huge.py"));
    // The byte bound alone would admit this file, so the node bound is what must hold.
    assertEquals(stat.size < 1_000_000, true, "the file must be small enough to reach the node check");

    // A RangeError here means the counter overflowed the stack instead of the
    // ceiling rejecting the file.
    const symbols = await new PythonSymbolExtractor().extractSymbols(root, ["huge.py"], {
      primaryLanguage: "python",
      allFilePaths: ["huge.py"],
    } as never);

    assertEquals(symbols, [], "an over-budget file must be skipped, not parsed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[node ceiling] an ordinary file is still extracted", async () => {
  const root = await Deno.makeTempDir({ prefix: "exa_node_ok_" });
  try {
    await Deno.writeTextFile(join(root, "normal.py"), "def small():\n    return 1\n");
    const symbols = await new PythonSymbolExtractor().extractSymbols(root, ["normal.py"], {
      primaryLanguage: "python",
      allFilePaths: ["normal.py"],
    } as never);
    assertEquals(symbols.map((s) => s.name).includes("small"), true, "the ceiling must not reject normal files");
    assertEquals(SYMBOL_EXTRACT_MAX_NODES > 0, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
