/**
 * @module CheckOptionalParamsBareOptionalTest
 * @path tests/scripts/check_optional_params_bare_optional_test.ts
 * @description Verifies the BARE_OPTIONAL rule of scripts/check_optional_params.ts: a parameter
 *   made optional via a bare `?` token OR a bare `| undefined` union (without the Opt<T, Reason>
 *   wrapper) is flagged — the two forms are treated identically because they are semantically
 *   equivalent. Opt-wrapped, plain-required, and default-valued params are not flagged. Guards
 *   the convention that optionality must be codified via Opt<T, Reason>.
 * @architectural-layer Tooling
 * @related-files [scripts/check_optional_params.ts, packages/core/src/types/optional_marker.ts]
 */

import { assert, assertEquals } from "@std/assert";
import ts from "typescript";
import { hasBareOptional, isOptType } from "../../scripts/check_optional_params.ts";

/** Parse a single function's first parameter from a source snippet. */
function firstParam(src: string): ts.ParameterDeclaration {
  const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
  let found: ts.ParameterDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.parameters.length > 0) {
      found = node.parameters[0];
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  if (!found) throw new Error("no parameter found in snippet");
  return found;
}

// ── `| undefined` union form ────────────────────────────────────────────────────

Deno.test("[bare-optional] flags `x: string | undefined`", () => {
  assertEquals(hasBareOptional(firstParam("function f(x: string | undefined) {}")), true);
});

Deno.test("[bare-optional] flags multi-member union containing undefined", () => {
  assertEquals(hasBareOptional(firstParam("function f(x: string | null | undefined) {}")), true);
});

Deno.test("[bare-optional] flags a bare `| undefined` in a NON-trailing param position", () => {
  const sf = ts.createSourceFile(
    "t.ts",
    "function f(a: string, b: number | undefined, c: string) {}",
    ts.ScriptTarget.Latest,
    true,
  );
  let mid: ts.ParameterDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n)) mid = n.parameters[1];
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  assert(mid, "expected the middle parameter");
  assertEquals(hasBareOptional(mid), true);
});

// ── `?` token form (now treated identically to `| undefined`) ────────────────────

Deno.test("[bare-optional] flags a bare `?` param `x?: string`", () => {
  assertEquals(hasBareOptional(firstParam("function f(x?: string) {}")), true);
});

Deno.test("[bare-optional] flags `x?: string | undefined` (both signals present)", () => {
  assertEquals(hasBareOptional(firstParam("function f(x?: string | undefined) {}")), true);
});

Deno.test("[bare-optional] flags a bare `?` with an object type", () => {
  assertEquals(hasBareOptional(firstParam("function f(x?: { a: number }) {}")), true);
});

// ── Compliant / out-of-scope forms (NOT flagged) ─────────────────────────────────

Deno.test("[bare-optional] does NOT flag a plain required param", () => {
  assertEquals(hasBareOptional(firstParam("function f(x: string) {}")), false);
});

Deno.test("[bare-optional] does NOT flag an Opt<T, Reason>-wrapped param (with `?`)", () => {
  const p = firstParam("function f(x?: Opt<string, Reason.TraceAbsent>) {}");
  assertEquals(hasBareOptional(p), false);
  assert(isOptType(p), "Opt-wrapped param must be recognized as Opt");
});

Deno.test("[bare-optional] does NOT flag an Opt<T, Reason> param without `?` (default form)", () => {
  assertEquals(hasBareOptional(firstParam("function f(x: Opt<number, Reason.SensibleDefault> = 10) {}")), false);
});

Deno.test("[bare-optional] does NOT flag a default-valued param `x = 5` (distinct intentional form)", () => {
  assertEquals(hasBareOptional(firstParam("function f(x = 5) {}")), false);
});

Deno.test("[bare-optional] does NOT flag a union WITHOUT undefined", () => {
  assertEquals(hasBareOptional(firstParam("function f(x: string | number) {}")), false);
});
