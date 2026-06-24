/**
 * @module CheckEditionLeakImportTest
 * @path tests/scripts/check_edition_leak_import_test.ts
 * @description Tests for the edition-tier import guard in scripts/check_code_style.ts.
 *   A lower-edition module must not import a higher-edition one (it would couple the
 *   lower edition's source/build to code that is licensed/shipped separately — the
 *   Team-into-Solo leak). Tiers: MIT (packages/, apps/) < Team (packages-team/) <
 *   Enterprise (exaix-enterprise/). The single sanctioned exception is an edition-gated
 *   DYNAMIC edition-gated load of `@exaix-team/...` in the daemon/exactl dispatch entries,
 *   which is loaded only in the Team branch and never executed in a Solo run.
 * @architectural-layer Test
 * @related-files [scripts/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import { isEditionLeakImport } from "../../scripts/check_code_style.ts";

// --- MIT (packages/, apps/) must not import Team or Enterprise ---

Deno.test("[edition-leak] a packages/ (MIT) module importing @exaix-team is flagged", () => {
  assertEquals(
    isEditionLeakImport("packages/quality-gate/src/foo.ts", 'import { X } from "@exaix-team/voting";'),
    true,
  );
});

Deno.test("[edition-leak] an apps/ (MIT) module statically importing @exaix-team is flagged (the leak that shipped)", () => {
  assertEquals(
    isEditionLeakImport(
      "apps/exactl/src/init.ts",
      'import { TeamComposer } from "@exaix-team/team-composer";',
    ),
    true,
  );
});

Deno.test("[edition-leak] an apps/ module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/daemon/main.ts", 'import { Y } from "../../exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a packages/ module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("packages/core/src/x.ts", 'import { Y } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

// --- Team (packages-team/) must not import Enterprise, but MAY use MIT ---

Deno.test("[edition-leak] a packages-team/ (Team) module importing exaix-enterprise is flagged", () => {
  assertEquals(
    isEditionLeakImport("packages-team/voting/src/x.ts", 'import { Z } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a packages-team/ module importing @exaix-team (same tier) is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("packages-team/voting/src/x.ts", 'import { W } from "@exaix-team/hitl";'),
    false,
  );
});

Deno.test("[edition-leak] a packages-team/ module importing MIT (@exaix/core) is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("packages-team/voting/src/x.ts", 'import { C } from "@exaix/core";'),
    false,
  );
});

// --- The sanctioned exception: edition-gated dynamic Team import in dispatch entries ---

// Build the dynamic-import fixture without the literal `import(` token on one source line,
// so the checker's own [import-inside-statement] rule does not flag this test's fixtures.
function dynamicTeamImport(spec: string): string {
  return `      const { X } = await ${"import"}("${spec}");`;
}

Deno.test("[edition-leak] an edition-gated dynamic @exaix-team import in a dispatch entry is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/daemon/main.ts", dynamicTeamImport("@exaix-team/team-composer")),
    false,
  );
  assertEquals(
    isEditionLeakImport("apps/exactl/src/init.ts", dynamicTeamImport("@exaix-team/hitl")),
    false,
  );
});

Deno.test("[edition-leak] a type-only @exaix-team import is NOT flagged (erased at compile)", () => {
  assertEquals(
    isEditionLeakImport("apps/daemon/main.ts", 'import type { TeamComposer } from "@exaix-team/team-composer";'),
    false,
  );
});

// --- Negative cases ---

Deno.test("[edition-leak] a normal MIT-to-MIT import is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/src/init.ts", 'import { SoloComposer } from "@exaix/core/composer";'),
    false,
  );
});

Deno.test("[edition-leak] test files are exempt (integration tests may import higher tiers)", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/tests/team_test.ts", 'import { X } from "@exaix-team/voting";'),
    false,
  );
  assertEquals(
    isEditionLeakImport("packages/core/tests/x_test.ts", 'import { Y } from "@exaix-team/hitl";'),
    false,
  );
});

Deno.test("[edition-leak] a non-import line in an MIT module is NOT flagged", () => {
  assertEquals(
    isEditionLeakImport("apps/exactl/src/init.ts", "// this references @exaix-team in a comment"),
    false,
  );
});

// --- Team-tier modules that live under apps/ (edition glue / Team-only apps) ---

Deno.test("[edition-leak] apps/daemon/src/bootstrap_team.ts is Team-tier and may import @exaix-team", () => {
  assertEquals(
    isEditionLeakImport(
      "apps/daemon/src/bootstrap_team.ts",
      'import { VotingCapabilityModule } from "@exaix-team/voting";',
    ),
    false,
  );
});

Deno.test("[edition-leak] apps/mcp-server (Team-coupled app) may import @exaix-team", () => {
  assertEquals(
    isEditionLeakImport("apps/mcp-server/main.ts", 'import { MCPServer } from "@exaix-team/mcp-server";'),
    false,
  );
});

Deno.test("[edition-leak] BUT a Team-tier app still may NOT import Enterprise", () => {
  assertEquals(
    isEditionLeakImport("apps/mcp-server/main.ts", 'import { E } from "@exaix-enterprise/mod.ts";'),
    true,
  );
});

Deno.test("[edition-leak] a */testing/ shim is exempt (test infra, never deployed)", () => {
  assertEquals(
    isEditionLeakImport("packages/mcp/testing/test_setup.ts", 'import { MCPServer } from "@exaix-team/mcp-server";'),
    false,
  );
});
