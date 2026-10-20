/**
 * @module PortOverlapTest
 * @path packages/lint-policy/tests/port_overlap_test.ts
 * @description Runs each generic rule's positive snippet through the Deno recommended rules and compares the codes with the table.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/fixtures/port/port_tables.json, packages/lint-policy/tests/helpers/port_tables.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadPortTables, OVERLAP_KIND } from "./helpers/port_tables.ts";

const TS_PRAGMA_PREFIX = "@ts-";

interface ILintDiagnostic {
  readonly code?: string;
  readonly filename?: string;
}

interface ILintReport {
  readonly diagnostics?: readonly ILintDiagnostic[];
}

/** A file-name safe form of a rule id. */
function snippetName(id: string): string {
  return id.replaceAll("/", "__");
}

/** Writes every positive snippet under one temp directory and returns the built-in codes per file. */
async function builtinCodesBySnippet(
  snippets: readonly { readonly key: string; readonly code: string }[],
): Promise<Map<string, string[]>> {
  const dir = await Deno.makeTempDir({ prefix: "port_overlap_" });
  try {
    for (const snippet of snippets) await Deno.writeTextFile(join(dir, `${snippet.key}.ts`), snippet.code);
    const command = new Deno.Command(Deno.execPath(), {
      args: ["lint", "--json", dir],
      cwd: dir,
      env: { EXAIX_LINT_RULES: "" },
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await command.output();
    const report: ILintReport = JSON.parse(new TextDecoder().decode(stdout));
    const codes = new Map<string, string[]>(snippets.map((snippet) => [snippet.key, []]));
    for (const diagnostic of report.diagnostics ?? []) {
      const key = (diagnostic.filename ?? "").split("/").pop()?.replace(/\.ts$/, "") ?? "";
      if (diagnostic.code) codes.get(key)?.push(diagnostic.code);
    }
    return codes;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("each declared built-in overlap matches a live deno lint run on the positive snippets", async () => {
  const tables = await loadPortTables();
  const snippets = tables.rules.flatMap((row) =>
    row.positive.map((positive, index) => ({ key: `${snippetName(row.id)}_${index}`, code: positive.code }))
  );
  const actual = await builtinCodesBySnippet(snippets);
  for (const row of tables.rules) {
    const seen = new Set<string>();
    row.positive.forEach((_positive, index) =>
      actual.get(`${snippetName(row.id)}_${index}`)?.forEach((code) => seen.add(code))
    );
    if (row.positive.length === 0) continue;
    assertEquals([...seen].sort(), [...row.overlap.builtins].sort(), `${row.id}: built-in codes differ from the table`);
  }
});

Deno.test("a row that names built-in rules declares a kind, and a row that names none declares none", async () => {
  const tables = await loadPortTables();
  for (const row of tables.rules) {
    const named = row.overlap.builtins.length + row.overlap.related.length;
    if (named === 0) assertEquals(row.overlap.kind, OVERLAP_KIND.none, row.id);
    else assert(row.overlap.kind !== OVERLAP_KIND.none, `${row.id} names built-in rules but declares none`);
  }
});

Deno.test("a duplicate overlap states its outcome", async () => {
  const tables = await loadPortTables();
  for (const row of tables.rules.filter((candidate) => candidate.overlap.kind === OVERLAP_KIND.duplicate)) {
    assert(row.overlap.outcome !== undefined && row.overlap.outcome.length > 0, `${row.id} has no duplicate outcome`);
  }
});

Deno.test("the harness sees a built-in code on a seeded snippet, and the undescribed pragma is the built-in's case", async () => {
  const seeded = [
    { key: "undescribed_pragma", code: `// ${TS_PRAGMA_PREFIX}ignore\nexport const a: number = "x";\n` },
    {
      key: "described_pragma",
      code: `// ${TS_PRAGMA_PREFIX}expect-error: the literal is checked at run time\nexport const a: number = "x";\n`,
    },
  ];
  const actual = await builtinCodesBySnippet(seeded);
  assertEquals(actual.get("undescribed_pragma"), ["ban-ts-comment"]);
  assertEquals(actual.get("described_pragma"), []);
});
