/**
 * @module CheckOptionalParamsBareUnionTest
 * @path tests/scripts/check_optional_params_bare_union_test.ts
 * @description Verifies the BARE_UNDEFINED_UNION rule of scripts/check_optional_params.ts:
 *   a parameter typed `T | undefined` (without the Opt<T, Reason> wrapper) is flagged, and
 *   the Opt-wrapped form is accepted. Guards the strict-optionality convention that
 *   optionality must be codified via Opt, never via a bare `?` or a bare `| undefined` union.
 * @architectural-layer Tooling
 * @related-files [scripts/check_optional_params.ts, packages/core/src/types/optional_marker.ts]
 */

import { assert, assertEquals } from "@std/assert";
import ts from "typescript";
import { hasBareUndefinedUnion, isOptType } from "../../scripts/check_optional_params.ts";

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

Deno.test("[bare-union] flags `x: string | undefined`", () => {
  const p = firstParam("function f(x: string | undefined) {}");
  assertEquals(hasBareUndefinedUnion(p), true);
});

Deno.test("[bare-union] flags `x?: string | undefined` (question token + union)", () => {
  const p = firstParam("function f(x?: string | undefined) {}");
  assertEquals(hasBareUndefinedUnion(p), true);
});

Deno.test("[bare-union] flags multi-member union containing undefined", () => {
  const p = firstParam("function f(x: string | null | undefined) {}");
  assertEquals(hasBareUndefinedUnion(p), true);
});

Deno.test("[bare-union] does NOT flag a plain required param", () => {
  const p = firstParam("function f(x: string) {}");
  assertEquals(hasBareUndefinedUnion(p), false);
});

Deno.test("[bare-union] does NOT flag a bare `?` param (that is REDUNDANT/UNUSED's job)", () => {
  const p = firstParam("function f(x?: string) {}");
  assertEquals(hasBareUndefinedUnion(p), false);
});

Deno.test("[bare-union] does NOT flag an Opt<T, Reason>-wrapped param", () => {
  const p = firstParam("function f(x?: Opt<string, Reason.TraceAbsent>) {}");
  assertEquals(hasBareUndefinedUnion(p), false);
  assert(isOptType(p), "Opt-wrapped param must be recognized as Opt");
});

Deno.test("[bare-union] does NOT flag a union WITHOUT undefined", () => {
  const p = firstParam("function f(x: string | number) {}");
  assertEquals(hasBareUndefinedUnion(p), false);
});

Deno.test("[bare-union] flags a bare-union in a NON-trailing param position", () => {
  // A bare `T | undefined` is a type-shape violation regardless of position — it is not
  // required to be a trailing/optional param (that is what distinguishes it from `?`).
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
  assertEquals(hasBareUndefinedUnion(mid), true);
});
