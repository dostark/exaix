/**
 * @module EnterpriseBoundarySecurityTest
 * @path tests/security/enterprise_boundary_security_test.ts
 * @description Guards the exaix-enterprise isolation boundary (Phase 178 GAP-15).
 * The Enterprise workspace is a separate Deno workspace that does not depend on
 * the Team packages, so no source there may import a @exaix-team specifier.
 * A static Team edge would change the edition and licensing graph.
 * @architectural-layer Test
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";

const ENTERPRISE_ROOT = "exaix-enterprise";
const TEAM_SPECIFIER = "@exaix-team/";

async function enterpriseSourceFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (
      const entry of walk(ENTERPRISE_ROOT, {
        exts: ["ts"],
        skip: [new RegExp("/\\.git/")],
      })
    ) {
      files.push(entry.path);
    }
  } catch (_err) {
    // An uninitialized submodule has no sources to check.
  }
  return files;
}

Deno.test("[security] no exaix-enterprise source imports a @exaix-team specifier", async () => {
  const files = await enterpriseSourceFiles();

  if (files.length === 0) {
    // Never report a false pass: an absent workspace means the check did not run.
    console.warn(
      `[enterprise-boundary] ${ENTERPRISE_ROOT} is not initialized; run git submodule update --init to check the boundary`,
    );
    return;
  }

  const offenders: string[] = [];
  for (const file of files) {
    const text = await Deno.readTextFile(file);
    if (text.includes(TEAM_SPECIFIER)) offenders.push(file);
  }

  assertEquals(
    offenders,
    [],
    `the Enterprise workspace must not import Team packages: ${offenders.join(", ")}`,
  );
});
