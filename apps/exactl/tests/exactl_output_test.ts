/**
 * @module ExaCtlOutputTest
 * @path apps/exactl/tests/exactl_output_test.ts
 * @description Verifies the exactl output renderer, the output format resolution, the terminal-control stripping and the color switch.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/cli, apps/exactl/src/output/exactl_output.ts]
 * @related-files [apps/exactl/src/output/exactl_output.ts, packages/cli/src/types/exactl_output_types.ts]
 */

import { assert, assertEquals, assertFalse, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import { ExaCtlOutputFormat, type IExaCtlColumn, type IExaCtlGlobalOptions, type IExaCtlOutputSink } from "@exaix/cli";
import type { JSONValue } from "@exaix/core";
import {
  createExaCtlRenderer,
  ExaCtlOutputRenderer,
  isColorDisabled,
  resolveOutputFormat,
  stripTerminalControls,
} from "../src/output/exactl_output.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";

interface IRow {
  [key: string]: JSONValue;
  id: string;
  title: string;
}

interface IArraySink {
  readonly sink: IExaCtlOutputSink;
  readonly out: string[];
  readonly err: string[];
}

const ROWS: IRow[] = [
  { id: "plan-a", title: "First plan" },
  { id: "plan-b", title: "Second plan" },
];
const COLUMNS: readonly IExaCtlColumn<IRow>[] = [
  { header: "ID", value: (row) => row.id },
  { header: "Title", value: (row) => row.title },
];
const OSC_CLIPBOARD = "\u001b]52;c;aGVsbG8=\u0007";
const CSI_RED = "\u001b[31m";
const NO_COLOR_ENV = "NO_COLOR";

function createArraySink(): IArraySink {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    sink: {
      out: (text) => {
        out.push(text);
        return Promise.resolve();
      },
      err: (text) => {
        err.push(text);
        return Promise.resolve();
      },
    },
  };
}

function rendererFor(
  format: ExaCtlOutputFormat,
  quiet = false,
): { renderer: ExaCtlOutputRenderer; captured: IArraySink } {
  const captured = createArraySink();
  return { renderer: new ExaCtlOutputRenderer(captured.sink, format, quiet), captured };
}

function globals(overrides: Partial<IExaCtlGlobalOptions> = {}): IExaCtlGlobalOptions {
  return {
    output: undefined,
    json: undefined,
    quiet: undefined,
    color: true,
    input: true,
    yes: undefined,
    ...overrides,
  };
}

Deno.test("list renders a JSON array whose objects equal the input rows", async () => {
  const { renderer, captured } = rendererFor(ExaCtlOutputFormat.JSON);
  await renderer.list(ROWS, COLUMNS, (row) => row.id);
  assertEquals(JSON.parse(captured.out.join("")), ROWS);
  assertEquals(captured.err, []);
});

Deno.test("jsonl renders one parseable object per line", async () => {
  const { renderer, captured } = rendererFor(ExaCtlOutputFormat.JSONL);
  await renderer.list(ROWS, COLUMNS, (row) => row.id);
  const lines = captured.out.join("").trimEnd().split("\n");
  assertEquals(lines.map((line) => JSON.parse(line)), ROWS);
});

Deno.test("quiet prints one id per line", async () => {
  const { renderer, captured } = rendererFor(ExaCtlOutputFormat.TABLE, true);
  await renderer.list(ROWS, COLUMNS, (row) => row.id);
  assertEquals(captured.out.join(""), ROWS.map((row) => `${row.id}\n`).join(""));
});

Deno.test("quiet with -o json prints the JSON array", async () => {
  const { renderer, captured } = rendererFor(ExaCtlOutputFormat.JSON, true);
  await renderer.list(ROWS, COLUMNS, (row) => row.id);
  assertEquals(JSON.parse(captured.out.join("")), ROWS);
});

Deno.test("table, md and text list formats print every header and value", async () => {
  for (const format of [ExaCtlOutputFormat.TABLE, ExaCtlOutputFormat.MD, ExaCtlOutputFormat.TEXT]) {
    const { renderer, captured } = rendererFor(format);
    await renderer.list(ROWS, COLUMNS, (row) => row.id);
    const text = captured.out.join("");
    for (const row of ROWS) {
      assertStringIncludes(text, row.id, format);
      assertStringIncludes(text, row.title, format);
    }
  }
});

Deno.test("item renders a JSON object, and its fields as text for humans", async () => {
  const json = rendererFor(ExaCtlOutputFormat.JSON);
  await json.renderer.item(ROWS[0], COLUMNS);
  assertEquals(JSON.parse(json.captured.out.join("")), ROWS[0]);
  const text = rendererFor(ExaCtlOutputFormat.TEXT);
  await text.renderer.item(ROWS[0], COLUMNS);
  const rendered = text.captured.out.join("");
  assertStringIncludes(rendered, "Title");
  assertStringIncludes(rendered, ROWS[0].title);
});

Deno.test("quiet item prints nothing in a human format", async () => {
  const { renderer, captured } = rendererFor(ExaCtlOutputFormat.TEXT, true);
  await renderer.item(ROWS[0], COLUMNS);
  assertEquals(captured.out, []);
});

Deno.test("event renders one JSON line and a human line for a text format", async () => {
  const machine = rendererFor(ExaCtlOutputFormat.JSONL);
  await machine.renderer.event({ type: "step", n: 1 });
  assertEquals(JSON.parse(machine.captured.out.join("").trimEnd()), { type: "step", n: 1 });
  const human = rendererFor(ExaCtlOutputFormat.TEXT);
  await human.renderer.event({ type: "step", n: 1 });
  assertStringIncludes(human.captured.out.join(""), "step");
});

Deno.test("an OSC 52 sequence in a row renders inert in table, md, text and quiet and escaped in JSON", async () => {
  const hostile: IRow = { id: `id${OSC_CLIPBOARD}`, title: `${CSI_RED}title${CSI_RED}` };
  for (const format of [ExaCtlOutputFormat.TABLE, ExaCtlOutputFormat.MD, ExaCtlOutputFormat.TEXT]) {
    const { renderer, captured } = rendererFor(format);
    await renderer.list([hostile], COLUMNS, (row) => row.id);
    assertFalse(captured.out.join("").includes("\u001b"), format);
  }
  const quiet = rendererFor(ExaCtlOutputFormat.TABLE, true);
  await quiet.renderer.list([hostile], COLUMNS, (row) => row.id);
  assertFalse(quiet.captured.out.join("").includes("\u001b"));
  const json = rendererFor(ExaCtlOutputFormat.JSON);
  await json.renderer.list([hostile], COLUMNS, (row) => row.id);
  const raw = json.captured.out.join("");
  assertFalse(raw.includes("\u001b"));
  assertEquals(JSON.parse(raw), [hostile]);
});

Deno.test("stripTerminalControls keeps newline and tab and drops C0, C1 and ESC sequences", () => {
  assertEquals(stripTerminalControls("a\tb\nc"), "a\tb\nc");
  assertEquals(stripTerminalControls(`x${OSC_CLIPBOARD}y`), "xy");
  assertEquals(stripTerminalControls(`x${CSI_RED}y\u0000z\u009bw`), "xyzw");
  assertEquals(stripTerminalControls("a\u0007b\u001bc"), "ab");
});

Deno.test("--json with -o table is a usage error", () => {
  const error = assertThrows(() =>
    resolveOutputFormat(globals({ json: true, output: ExaCtlOutputFormat.TABLE }), ExaCtlOutputFormat.TABLE)
  );
  assertInstanceOf(error, ExaCtlError);
  assertEquals(error.code, ExaCtlExitCode.USAGE);
});

Deno.test("--json with -o json is accepted", () => {
  assertEquals(
    resolveOutputFormat(globals({ json: true, output: ExaCtlOutputFormat.JSON }), ExaCtlOutputFormat.TABLE),
    ExaCtlOutputFormat.JSON,
  );
});

Deno.test("resolveOutputFormat falls back to the verb default and honors --json and -o", () => {
  assertEquals(resolveOutputFormat(globals(), ExaCtlOutputFormat.TEXT), ExaCtlOutputFormat.TEXT);
  assertEquals(resolveOutputFormat(globals({ json: true }), ExaCtlOutputFormat.TABLE), ExaCtlOutputFormat.JSON);
  assertEquals(
    resolveOutputFormat(globals({ output: ExaCtlOutputFormat.MD }), ExaCtlOutputFormat.TABLE),
    ExaCtlOutputFormat.MD,
  );
});

Deno.test("createExaCtlRenderer applies the resolved format and the quiet flag", async () => {
  const captured = createArraySink();
  const renderer = createExaCtlRenderer(globals({ json: true }), ExaCtlOutputFormat.TABLE, captured.sink);
  await renderer.list(ROWS, COLUMNS, (row) => row.id);
  assertEquals(JSON.parse(captured.out.join("")), ROWS);
});

Deno.test("isColorDisabled is true for --no-color and for a non-empty NO_COLOR", () => {
  const env = (values: Record<string, string>) => ({ get: (key: string) => values[key] });
  assert(isColorDisabled(["plan", "list", "--no-color"], env({})));
  assert(isColorDisabled(["plan", "list"], env({ [NO_COLOR_ENV]: "1" })));
  assertFalse(isColorDisabled(["plan", "list"], env({ [NO_COLOR_ENV]: "" })));
  assertFalse(isColorDisabled(["plan", "list"], env({})));
  assertFalse(isColorDisabled(["request", "create", "--", "--no-color"], env({})));
});
