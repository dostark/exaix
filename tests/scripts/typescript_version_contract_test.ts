/**
 * @module TypeScriptVersionContractTest
 * @path tests/scripts/typescript_version_contract_test.ts
 * @description Phase 165 (P3): pins the npm `typescript` dependency to the 6.x line and
 * implements the TypeScript-7 migration trigger. TypeScript 7.0.x ships no stable
 * programmatic API — only ./unstable/* subpaths — so the five gate scripts that
 * use the legacy compiler API cannot move yet. The moment the pin moves to major 7 this
 * test fails the default suite with a pointer to the migration runbook.
 */

import ts from "typescript";

const RUNBOOK = "exaix-dev-docs/dev/TypeScript7_Migration.md";

function versionParts(version: string): number[] {
  return version.split(".").map((p) => parseInt(p, 10));
}

Deno.test("P3: typescript resolves to the 6.x line (TS 7 deferred by contract)", () => {
  if (typeof ts.version !== "string" || ts.version.length === 0) {
    throw new Error(`ts.version unavailable (${String(ts.version)}) — unexpected typescript build`);
  }
  const parts = versionParts(ts.version);
  if (parts.length < 1 || Number.isNaN(parts[0])) {
    throw new Error(`unexpected typescript version string: ${ts.version}`);
  }
  if (parts[0] >= 7) {
    throw new Error(
      `typescript resolved to ${ts.version} (major ${parts[0]}) — TypeScript 7 has no stable ` +
        `programmatic API (only ./unstable/* exports). Before bumping the pin, follow ${RUNBOOK}: ` +
        `migrate the five gate scripts (check_optional_params, check_code_style, check_magic_values, ` +
        `check_unused_exports + bare-optional test) off the legacy compiler API.`,
    );
  }
  if (parts[0] !== 6) {
    throw new Error(
      `typescript resolved to ${ts.version} — expected the 6.x line (npm:typescript@6.0.3 pin in deno.json).`,
    );
  }
});

Deno.test("P3: legacy compiler API required by the gate scripts is present", () => {
  const legacyApis = [
    { name: "createSourceFile", value: ts.createSourceFile },
    { name: "forEachChild", value: ts.forEachChild },
    { name: "ScriptTarget", value: ts.ScriptTarget },
    { name: "SyntaxKind", value: ts.SyntaxKind },
  ] as const;

  for (const { name, value } of legacyApis) {
    if (typeof value === "undefined") {
      throw new Error(
        `legacy compiler API member ts.${name} is missing in typescript@${ts.version} — ` +
          `the gate scripts cannot migrate yet; follow ${RUNBOOK}.`,
      );
    }
  }
});
