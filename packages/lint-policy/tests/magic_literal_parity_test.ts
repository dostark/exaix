/**
 * @module MagicLiteralParityTest
 * @path packages/lint-policy/tests/magic_literal_parity_test.ts
 * @description Checks that check:magic with the unslop-ts detector prints the same report as the old script on a corpus of trees.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, zod]
 * @related-files [packages/lint-policy/tests/fixtures/port/magic_literal_corpus.ts, packages/lint-policy/src/checkers/check_magic_values.ts]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { z } from "zod";
import { MAGIC_LITERAL_CORPUS } from "./fixtures/port/magic_literal_corpus.ts";
import goldenJson from "./fixtures/port/magic_literal_golden.json" with { type: "json" };

const GoldenSchema = z.record(z.string(), z.object({ stdout: z.string(), stderr: z.string() }));
const golden = GoldenSchema.parse(goldenJson);
const REPO_ROOT = fromFileUrl(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "packages/lint-policy/src/checkers/check_magic_values.ts");
const ROOT_PLACEHOLDER = "<root>";
const DUPLICATE_NOISE = "[duplicate-constant]";

interface IReport {
  readonly stdout: string;
  readonly stderr: string;
}

/** The text without the root path and without the duplicate-constant lines, which depend on the Exaix catalog. */
function normalize(text: string, root: string): string {
  return text.replaceAll(root, ROOT_PLACEHOLDER).split("\n").filter((line) => !line.includes(DUPLICATE_NOISE)).join(
    "\n",
  );
}

async function reportFor(files: Readonly<Record<string, string>>, args: readonly string[]): Promise<IReport> {
  const root = await Deno.makeTempDir({ prefix: "magic_parity_" });
  try {
    for (const [path, text] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(root, path)), { recursive: true });
      await Deno.writeTextFile(join(root, path), text);
    }
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", `--config=${join(REPO_ROOT, "deno.json")}`, SCRIPT, `--root=${root}`, ...args],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      stdout: normalize(decoder.decode(output.stdout), root),
      stderr: normalize(decoder.decode(output.stderr), root),
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("magic literal parity: every corpus tree prints the report of the old script", async () => {
  const reports = await Promise.all(MAGIC_LITERAL_CORPUS.map((entry) => reportFor(entry.files, entry.args)));
  MAGIC_LITERAL_CORPUS.forEach((entry, index) => {
    assertEquals(reports[index], golden[entry.name], `report differs for: ${entry.name}`);
  });
});
