/**
 * @module ApprovalIdTest
 * @path apps/exactl/tests/approval_id_test.ts
 * @description Verifies the typed approval id parser: each kind prefix, a bare id and the usage errors.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/approval_id.ts]
 * @related-files [apps/exactl/src/commands/approval_id.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ApprovalKind, parseApprovalId } from "../src/commands/approval_id.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";

const TOKEN = "550e8400-e29b-41d4-a716-446655440011";

Deno.test("parses each kind prefix", () => {
  for (const kind of Object.values(ApprovalKind)) {
    assertEquals(parseApprovalId(`${kind}:${TOKEN}`), { kind, id: TOKEN });
  }
});

Deno.test("rejects an unknown prefix", () => {
  const error = assertThrows(() => parseApprovalId(`secret:${TOKEN}`), ExaCtlError);
  assertEquals(error.code, ExaCtlExitCode.USAGE);
});

Deno.test("keeps a bare id bare", () => {
  assertEquals(parseApprovalId(TOKEN), { kind: undefined, id: TOKEN });
});

Deno.test("an empty id or an empty id after a prefix is a usage error", () => {
  for (const raw of ["", "wait:", ":", "tool: "]) {
    const error = assertThrows(() => parseApprovalId(raw), ExaCtlError, undefined, `raw "${raw}"`);
    assertEquals(error.code, ExaCtlExitCode.USAGE);
  }
});

Deno.test("only the first colon splits the prefix from the id", () => {
  assertEquals(parseApprovalId("skill:ns:name"), { kind: ApprovalKind.SKILL, id: "ns:name" });
});
