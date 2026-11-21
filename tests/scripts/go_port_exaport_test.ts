/**
 * @module GoPortExaportTest
 * @path tests/scripts/go_port_exaport_test.ts
 * @description Exercises the bounded exaport check prototype on seeded and clean fixtures.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/go_port/cost_comparison.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const TOOL = join(REPO_ROOT, "scripts", "go_port", "exaport", "src", "main.ts");

async function run(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", TOOL, ...args],
    cwd,
    env: { ...Deno.env.toObject() },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

Deno.test("exaport-prototype-finding: direct Deno and barrel imports are reported", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exaport_fixture_" });
  try {
    await Deno.writeTextFile(
      join(dir, "a.ts"),
      'import { x } from "@exaix/core";\nexport const value = Deno.readFileSync("x");\n',
    );
    const result = await run(["--root=.", "--rule=all", "--format=json"], dir);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, '"rule": "deno-api"');
    assertStringIncludes(result.stdout, '"rule": "barrel-import"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("exaport-prototype-clean: a clean fixture has no findings", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exaport_clean_" });
  try {
    await Deno.writeTextFile(
      join(dir, "a.ts"),
      'import { x } from "@exaix/core/sub";\nexport const value = x;\n',
    );
    const result = await run(["--root=.", "--rule=all", "--format=json"], dir);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, '"findings": []');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("exaport-prototype-loader-error: a missing root exits 2", async () => {
  const result = await run(
    ["--root=does-not-exist", "--format=json"],
    REPO_ROOT,
  );
  assertEquals(result.code, 2);
  assertStringIncludes(result.stderr, "cannot read root");
});

Deno.test(
  "exaport-convert-dry-run: the plan names families and writes nothing",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "exaport_convert_" });
    try {
      await Deno.writeTextFile(
        join(dir, "a.ts"),
        "export const value = Deno.cwd();\n",
      );
      const result = await run([
        "--root=.",
        "--format=json",
        "--convert",
        "--dry-run",
        "--package=fixture",
      ], dir);
      assertEquals(result.code, 0, result.stderr);
      assertStringIncludes(result.stdout, '"dry_run": true');
      assertStringIncludes(result.stdout, '"platform"');
      const entries: string[] = [];
      for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
      assertEquals(entries, ["a.ts"]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
