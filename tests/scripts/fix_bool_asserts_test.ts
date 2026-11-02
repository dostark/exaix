/**
 * @module FixBoolAssertsTest
 * @path tests/scripts/fix_bool_asserts_test.ts
 * @description Behaviour of the typed boolean-assertion codemod (deslop, MIT): semantics, bindings, imports,
 *   the manifest validation and the real command line.
 * @architectural-layer Test
 * @related-files [scripts/fix_bool_asserts.ts]
 */

import { assert, assertEquals, assertFalse, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { fixSourceText, validateFileManifest } from "../../scripts/fix_bool_asserts.ts";

const FILE = "packages/x/tests/a_test.ts";
const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const SCRIPT = join(REPO_ROOT, "scripts/fix_bool_asserts.ts");
const REPO_CONFIG = join(REPO_ROOT, "deno.json");
const NAMED_IMPORT = 'import { assertEquals } from "@std/assert";\n';

/** A source text whose first line is the named import of the equality wrapper. */
function withImport(body: string, imports = NAMED_IMPORT): string {
  return `${imports}${body}`;
}

Deno.test("a string subject becomes assertStringIncludes and the import follows", () => {
  const result = fixSourceText(FILE, withImport('const s: string = "abc";\nassertEquals(s.includes("b"), true);\n'));
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertStringIncludes(s, "b")');
  assertStringIncludes(result.text, 'import { assertStringIncludes } from "@std/assert";');
  assertFalse(result.text.includes("assertEquals"), "the unused equality import is removed");
});

Deno.test("an import that is still used stays and the new name is added", () => {
  const source = withImport(
    'const s: string = "abc";\nassertEquals(s.includes("b"), true);\nassertEquals(s.length, 3);\n',
  );
  const result = fixSourceText(FILE, source);
  assertStringIncludes(result.text, 'import { assertEquals, assertStringIncludes } from "@std/assert";');
  assertStringIncludes(result.text, "assertEquals(s.length, 3);");
});

Deno.test("an array subject keeps its predicate in a named boolean instead of assertArrayIncludes", () => {
  const source = withImport("const arr: number[] = [1];\nassertEquals(arr.includes(1), true);\n");
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, "const includesResult: boolean = arr.includes(1);");
  assertStringIncludes(result.text, "assertEquals(includesResult, true);");
  assertFalse(result.text.includes("assertArrayIncludes"));
});

Deno.test("a named result avoids every identifier already in the file", () => {
  const source = withImport(
    "const includesResult: number = 1;\nconst arr: number[] = [1];\nassertEquals(arr.includes(includesResult), true);\n",
  );
  const result = fixSourceText(FILE, source);
  assertStringIncludes(result.text, "const includesResult2: boolean = arr.includes(includesResult);");
});

Deno.test("a union, custom or untyped subject is left unchanged and listed", () => {
  const cases = [
    'declare const u: string | string[];\nassertEquals(u.includes("b"), true);\n',
    'declare const c: { includes(v: string): boolean };\nassertEquals(c.includes("b"), true);\n',
    'declare const raw: unknown;\nassertEquals((raw as number).includes("a"), true);\n',
  ];
  for (const body of cases) {
    const source = withImport(body);
    const result = fixSourceText(FILE, source);
    assertEquals(result.changed, 0, body);
    assertEquals(result.text, source, body);
    assertEquals(result.skipped.length, 1, body);
  }
});

Deno.test("a false boolean argument keeps the original predicate in assertFalse", () => {
  const result = fixSourceText(FILE, withImport('const s: string = "abc";\nassertEquals(s.includes("b"), false);\n'));
  assertEquals(result.changed, 1);
  assertStringIncludes(result.text, 'assertFalse(s.includes("b"))');
  assertStringIncludes(result.text, 'import { assertFalse } from "@std/assert";');
});

Deno.test("a false assertion rewrites without the subject type and keeps the message", () => {
  const source = withImport(
    'declare const raw: unknown;\nassertEquals((raw as string).startsWith("a"), false, "why");\n',
  );
  const result = fixSourceText(FILE, source);
  assertStringIncludes(result.text, 'assertFalse((raw as string).startsWith("a"), "why")');
});

Deno.test("startsWith and endsWith become anchored assertMatch patterns with escaped literals", () => {
  const cases: Array<[string, string]> = [
    ['s.startsWith("a")', "assertMatch(s, /^a/)"],
    ['s.endsWith("c")', "assertMatch(s, /c$/)"],
    ['s.startsWith("---\\n")', "assertMatch(s, /^---\\n/)"],
    ['s.endsWith(",dst=/tmp/.local")', "assertMatch(s, /,dst=\\/tmp\\/\\.local$/)"],
    ['s.startsWith("a.b")', "assertMatch(s, /^a\\.b/)"],
  ];
  for (const [call, expected] of cases) {
    const result = fixSourceText(FILE, withImport(`const s: string = "x";\nassertEquals(${call}, true);\n`));
    assertEquals(result.changed, 1, call);
    assertStringIncludes(result.text, expected);
  }
});

Deno.test("method arity decides: a position argument or a non-literal match is skipped and listed", () => {
  const cases = [
    'const s: string = "abc";\nassertEquals(s.includes("b", 1), true);\n',
    'const s: string = "abc";\nassertEquals(s.startsWith("a", 1), true);\n',
    'const s: string = "abc";\nconst p: string = "a";\nassertEquals(s.startsWith(p), true);\n',
  ];
  for (const body of cases) {
    const source = withImport(body);
    const result = fixSourceText(FILE, source);
    assertEquals(result.changed, 0, body);
    assertEquals(result.text, source, body);
    assertEquals(result.skipped.length, 1, body);
  }
});

Deno.test("messages survive in every rewritten shape", () => {
  const bare = withImport(
    'import { assert } from "@std/assert";\nconst s: string = "abc";\nassert(s.includes("b"), "why");\n',
  );
  assertStringIncludes(fixSourceText(FILE, bare).text, 'assertStringIncludes(s, "b", "why")');
  const named = withImport("const arr: number[] = [1];\nassertEquals(arr.includes(1), true, 'why');\n");
  assertStringIncludes(fixSourceText(FILE, named).text, "assertEquals(includesResult, true, 'why');");
  const match = withImport('const s: string = "abc";\nassertEquals(s.startsWith("a"), true, "why");\n');
  assertStringIncludes(fixSourceText(FILE, match).text, 'assertMatch(s, /^a/, "why")');
});

Deno.test("a bare assert, an alias and a namespace call are each bound before they are rewritten", () => {
  const bare = 'import { assert } from "@std/assert";\nconst s: string = "abc";\nassert(s.includes("b"));\n';
  const bareResult = fixSourceText(FILE, bare);
  assertStringIncludes(bareResult.text, 'assertStringIncludes(s, "b")');
  assertStringIncludes(bareResult.text, 'import { assertStringIncludes } from "@std/assert";');

  const alias =
    'import { assertEquals as eq } from "@std/assert";\nconst s: string = "abc";\neq(s.includes("b"), true);\n';
  const aliasResult = fixSourceText(FILE, alias);
  assertStringIncludes(aliasResult.text, 'assertStringIncludes(s, "b")');
  assertFalse(aliasResult.text.includes("eq"), "the unused alias is removed");

  const namespace =
    'import * as asserts from "@std/assert";\nconst s: string = "abc";\nasserts.assertEquals(s.includes("b"), true);\n';
  const namespaceResult = fixSourceText(FILE, namespace);
  assertStringIncludes(namespaceResult.text, 'asserts.assertStringIncludes(s, "b")');
  assertStringIncludes(namespaceResult.text, 'import * as asserts from "@std/assert";');
});

Deno.test("an existing alias of the new assertion is reused", () => {
  const source =
    'import { assertEquals, assertStringIncludes as hasText } from "@std/assert";\nconst s: string = "abc";\nassertEquals(s.includes("b"), true);\n';
  const result = fixSourceText(FILE, source);
  assertStringIncludes(result.text, 'hasText(s, "b")');
  assertFalse(result.text.includes("assertStringIncludes(s"));
});

Deno.test("a callee that is not imported from the standard assertion module is unchanged and listed", () => {
  const cases = [
    'import { assertEquals } from "./local_asserts.ts";\nconst s: string = "abc";\nassertEquals(s.includes("b"), true);\n',
    'const s: string = "abc";\nassertEquals(s.includes("b"), true);\n',
  ];
  for (const source of cases) {
    const result = fixSourceText(FILE, source);
    assertEquals(result.changed, 0, source);
    assertEquals(result.text, source, source);
    assertEquals(result.skipped.length, 1, source);
    assertStringIncludes(result.skipped[0].reason, "not imported from @std/assert");
  }
});

Deno.test("the jsr specifier form is a supported binding", () => {
  const source =
    'import { assertEquals } from "jsr:@std/assert@1";\nconst s: string = "abc";\nassertEquals(s.includes("b"), true);\n';
  const result = fixSourceText(FILE, source);
  assertStringIncludes(result.text, 'import { assertStringIncludes } from "jsr:@std/assert@1";');
});

Deno.test("an assertion outside a statement list is skipped when it would need a named result", () => {
  const source = withImport("const arr: number[] = [1];\nif (arr.length) assertEquals(arr.includes(1), true);\n");
  const result = fixSourceText(FILE, source);
  assertEquals(result.changed, 0);
  assertEquals(result.skipped.length, 1);
});

Deno.test("the codemod is idempotent across every supported shape", () => {
  const source = withImport(
    'import { assert } from "@std/assert";\nconst s: string = "abc";\nconst arr: number[] = [1];\nassertEquals(s.includes("b"), true);\nassertEquals(s.endsWith("c"), false);\nassertEquals(arr.includes(1), true);\nassert(s.startsWith("a"));\n',
  );
  const once = fixSourceText(FILE, source);
  assert(once.changed >= 4);
  const twice = fixSourceText(FILE, once.text);
  assertEquals(twice.changed, 0);
  assertEquals(twice.text, once.text);
});

/** Runs `deno <args>` against the repository import map and resolves with its output and success. */
async function runDeno(args: string[], cwd: string): Promise<{ success: boolean; output: string; code: number }> {
  const out = await new Deno.Command(Deno.execPath(), { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const decoder = new TextDecoder();
  return { success: out.success, code: out.code, output: decoder.decode(out.stdout) + decoder.decode(out.stderr) };
}

/** Counterexamples whose original assertion fails, and controls whose original assertion passes. */
const SEMANTIC_DEFECTS = `import { assertEquals } from "@std/assert";
Deno.test("object identity is not deep containment", () => {
  const items: Array<{ a: number }> = [{ a: 1 }];
  assertEquals(items.includes({ a: 1 }), true);
});
Deno.test("an array element is not a substring", () => {
  const items: string[] = ["xx"];
  assertEquals(items.includes("x"), true);
});
Deno.test("a false expectation keeps its predicate", () => {
  const s: string = "abc";
  assertEquals(s.includes("b"), false);
});
Deno.test("an anchored literal stays anchored", () => {
  const s: string = "xabc";
  assertEquals(s.startsWith("abc"), true);
});
Deno.test("a final newline is not part of the expected suffix", () => {
  const s: string = "abc\\n";
  assertEquals(s.endsWith("abc"), true);
});
`;
const SEMANTIC_CONTROLS = `import { assertEquals } from "@std/assert";
Deno.test("NaN is found by SameValueZero", () => {
  const items: number[] = [Number.NaN];
  assertEquals(items.includes(Number.NaN), true);
});
Deno.test("the same object is found by identity", () => {
  const probe = { a: 1 };
  const items: Array<{ a: number }> = [probe];
  assertEquals(items.includes(probe), true);
});
Deno.test("a substring is found", () => {
  const s: string = "abc";
  assertEquals(s.includes("b"), true);
});
Deno.test("a dot in the literal is not a wildcard", () => {
  const s: string = "a.bc";
  assertEquals(s.startsWith("a.b"), true);
});
`;

Deno.test("seeded defects still fail and controls still pass after the rewrite, and the output type-checks", async () => {
  await withTempDir(async (dir) => {
    for (
      const [name, source, expectedFailures] of [["defects", SEMANTIC_DEFECTS, 5], [
        "controls",
        SEMANTIC_CONTROLS,
        0,
      ]] as const
    ) {
      const original = join(dir, `${name}_original_test.ts`);
      const rewritten = join(dir, `${name}_rewritten_test.ts`);
      const fixed = fixSourceText(FILE, source);
      assert(fixed.changed > 0, name);
      await Deno.writeTextFile(original, source);
      await Deno.writeTextFile(rewritten, fixed.text);
      const check = await runDeno(["check", "--config", REPO_CONFIG, rewritten], dir);
      assert(check.success, `${name} output must type-check: ${check.output}`);
      const before = await runDeno(["test", "--config", REPO_CONFIG, "--allow-all", original], dir);
      const after = await runDeno(["test", "--config", REPO_CONFIG, "--allow-all", rewritten], dir);
      const failedOf = (output: string): number => Number(/(\d+) failed/.exec(output)?.[1] ?? 0);
      assertEquals(failedOf(before.output), expectedFailures, `${name} original: ${before.output}`);
      assertEquals(failedOf(after.output), expectedFailures, `${name} rewritten: ${after.output}`);
    }
  });
});

Deno.test("an effectful argument is evaluated once and in the same order after the rewrite", async () => {
  const source = `import { assertEquals } from "@std/assert";
const order: string[] = [];
function mark(label: string): string {
  order.push(label);
  return label;
}
Deno.test("order", () => {
  const items: string[] = ["a"];
  assertEquals(items.includes(mark("needle")), false);
  assertEquals(order, ["needle"]);
});
`;
  const fixed = fixSourceText(FILE, source);
  assert(fixed.changed > 0);
  await withTempDir(async (dir) => {
    const file = join(dir, "order_test.ts");
    await Deno.writeTextFile(file, fixed.text);
    const run = await runDeno(["test", "--config", REPO_CONFIG, "--allow-all", file], dir);
    assert(run.success, run.output);
  });
});

/** Lays out a small consumer tree and returns the root directory. */
async function layoutProject(dir: string): Promise<void> {
  const body = `${NAMED_IMPORT}const s: string = "abc";\nassertEquals(s.includes("b"), true);\n`;
  for (
    const path of [
      "packages/x/tests/a_test.ts",
      "packages/x/tests/b_test.ts",
      "exaix-team/packages/y/tests/c_test.ts",
      "packages/x/src/prod.ts",
      "tests/scenario_framework/fixtures/fixture_test.ts",
    ]
  ) {
    await Deno.mkdir(join(dir, path, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, path), body);
  }
}

const DESCRIBE = (reasons: string[]): string => reasons.join(" | ");

Deno.test("a manifest is accepted only when every entry is a test-scope source file inside the consumer roots", async () => {
  await withTempDir(async (dir) => {
    await layoutProject(dir);
    const ok = await validateFileManifest(
      JSON.stringify(["packages/x/tests/a_test.ts", "exaix-team/packages/y/tests/c_test.ts"]),
      dir,
    );
    assertEquals(ok, ["packages/x/tests/a_test.ts", "exaix-team/packages/y/tests/c_test.ts"]);

    const rejected: Array<[string, string]> = [
      ["not json", "malformed"],
      ["{}", "array"],
      ["[]", "empty"],
      [JSON.stringify([7]), "string"],
      [JSON.stringify(["packages/x/tests/a_test.ts", "packages/x/tests/a_test.ts"]), "duplicate"],
      [JSON.stringify(["packages/x/tests/missing_test.ts"]), "missing"],
      [JSON.stringify(["packages/x/tests/notes.md"]), "TypeScript"],
      [JSON.stringify(["packages/x/src/prod.ts"]), "production"],
      [JSON.stringify(["tests/scenario_framework/fixtures/fixture_test.ts"]), "fixture"],
      [JSON.stringify(["../outside_test.ts"]), "canonical"],
      [JSON.stringify([join(dir, "packages/x/tests/a_test.ts")]), "canonical"],
      [JSON.stringify(["./packages/x/tests/a_test.ts"]), "canonical"],
      [JSON.stringify(["other/tests/a_test.ts"]), "consumer root"],
    ];
    await Deno.mkdir(join(dir, "other/tests"), { recursive: true });
    await Deno.writeTextFile(join(dir, "other/tests/a_test.ts"), "export {};\n");
    await Deno.writeTextFile(join(dir, "packages/x/tests/notes.md"), "notes\n");
    for (const [manifest, word] of rejected) {
      const error = await assertRejects(() => validateFileManifest(manifest, dir), Error);
      assertStringIncludes(error.message, word, DESCRIBE([manifest, error.message]));
    }
  });
});

Deno.test("a symlink that leaves the consumer roots is rejected before any write", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (outside) => {
      await Deno.writeTextFile(join(outside, "escape_test.ts"), "export {};\n");
      await Deno.mkdir(join(dir, "packages/x/tests"), { recursive: true });
      await Deno.symlink(join(outside, "escape_test.ts"), join(dir, "packages/x/tests/escape_test.ts"));
      const error = await assertRejects(
        () => validateFileManifest(JSON.stringify(["packages/x/tests/escape_test.ts"]), dir),
        Error,
      );
      assertStringIncludes(error.message, "outside");
    });
  });
});

Deno.test("the command line rewrites exactly the manifest files, including Team, and a second run changes nothing", async () => {
  await withTempDir(async (dir) => {
    await layoutProject(dir);
    const manifest = join(dir, "manifest.json");
    await Deno.writeTextFile(
      manifest,
      JSON.stringify(["packages/x/tests/a_test.ts", "exaix-team/packages/y/tests/c_test.ts"]),
    );
    const run = (): Promise<{ success: boolean; output: string; code: number }> =>
      runDeno(["run", "-A", "--config", REPO_CONFIG, SCRIPT, `--files-manifest=${manifest}`], dir);
    const first = await run();
    assert(first.success, first.output);
    const read = (path: string): Promise<string> => Deno.readTextFile(join(dir, path));
    assertStringIncludes(await read("packages/x/tests/a_test.ts"), "assertStringIncludes(s,");
    assertStringIncludes(await read("exaix-team/packages/y/tests/c_test.ts"), "assertStringIncludes(s,");
    for (
      const untouched of [
        "packages/x/tests/b_test.ts",
        "packages/x/src/prod.ts",
        "tests/scenario_framework/fixtures/fixture_test.ts",
      ]
    ) {
      assertStringIncludes(await read(untouched), "assertEquals(s.includes", untouched);
    }
    const second = await run();
    assert(second.success, second.output);
    assertMatch(second.output, /0 file\(s\)/);
  });
});

Deno.test("the command line rejects a bad manifest without writing and reports the reason", async () => {
  await withTempDir(async (dir) => {
    await layoutProject(dir);
    const manifest = join(dir, "manifest.json");
    await Deno.writeTextFile(manifest, JSON.stringify(["packages/x/tests/a_test.ts", "packages/x/src/prod.ts"]));
    const run = await runDeno(["run", "-A", "--config", REPO_CONFIG, SCRIPT, `--files-manifest=${manifest}`], dir);
    assertFalse(run.success);
    assertEquals(run.code, 2);
    assertStringIncludes(run.output, "production");
    assertStringIncludes(await Deno.readTextFile(join(dir, "packages/x/tests/a_test.ts")), "assertEquals(s.includes");

    const missing = await runDeno(
      ["run", "-A", "--config", REPO_CONFIG, SCRIPT, `--files-manifest=${join(dir, "nope.json")}`],
      dir,
    );
    assertEquals(missing.code, 2);
  });
});

Deno.test("the root mode never rewrites production or fixture files and lists residual sites", async () => {
  await withTempDir(async (dir) => {
    await layoutProject(dir);
    await Deno.writeTextFile(
      join(dir, "packages/x/tests/custom_test.ts"),
      `${NAMED_IMPORT}declare const c: { includes(v: string): boolean };\nassertEquals(c.includes("b"), true);\n`,
    );
    const run = await runDeno(["run", "-A", "--config", REPO_CONFIG, SCRIPT, "packages", "exaix-team", "tests"], dir);
    assert(run.success, run.output);
    assertStringIncludes(await Deno.readTextFile(join(dir, "packages/x/tests/a_test.ts")), "assertStringIncludes(s,");
    assertStringIncludes(await Deno.readTextFile(join(dir, "packages/x/src/prod.ts")), "assertEquals(s.includes");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "tests/scenario_framework/fixtures/fixture_test.ts")),
      "assertEquals(s.includes",
    );
    assertMatch(run.output, /custom_test\.ts:\d+: .*includes|custom_test\.ts:\d+:/);
  });
});
