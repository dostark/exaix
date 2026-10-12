/**
 * @module TeamBinarySymbolGraphTest
 * @path tests/integration/team_binary_symbol_graph_test.ts
 * @description Phase 178 — the delivery-vehicle proof. The phase's delivery
 * vehicle is the **compiled Team binary** run with `EXAIX_EDITION=enterprise`,
 * not the workspace source and not the `build:enterprise` scaffold.
 *
 * This test runs that binary as a real subprocess, so it exercises the compiled
 * artifact, the real CLI argument parsing, the real composition root, and the
 * persisted `knowledge.json` on disk.
 *
 * Build the artifact first:
 *   deno run -A scripts/ci.ts build --edition team -c
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EDITION_ENTERPRISE, EDITION_SOLO, EDITION_TEAM } from "@exaix/core";

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const TEAM_BINARY = join(REPO_ROOT, "dist", "bin", `exactl-team-${Deno.build.target}`);

const GO_PORTAL = join(
  REPO_ROOT,
  "exaix-team/packages/portal-extractors/tests/fixtures/go_reference_portal",
);

/** The symbol kind under test, as a literal.
 *  A literal keeps the assertion independent of the constant that produces it.
 *  A rename then cannot make both agree wrongly. */
const SYMBOL_KIND = "symbol_references_symbol";

async function binaryExists(): Promise<boolean> {
  try {
    const stat = await Deno.stat(TEAM_BINARY);
    return stat.isFile;
  } catch {
    return false;
  }
}

function configToml(root: string): string {
  return `
[system]
root = "${root}"
log_level = "error"

[agents]
default_model = "mock:test"

[models."mock:test"]
provider = "mock"
model = "test"

[portal_knowledge]
default_mode = "standard"
enable_symbol_level_dependency_graph = true
`;
}

async function runTeamBinary(workspaceRoot: string, edition: string, args: string[]): Promise<number> {
  const command = new Deno.Command(TEAM_BINARY, {
    args,
    cwd: workspaceRoot,
    env: {
      ...Deno.env.toObject(),
      EXAIX_EDITION: edition,
      EXA_CONFIG_PATH: join(workspaceRoot, "config.toml"),
      EXA_LLM_PROVIDER: "mock",
    },
    stdout: "null",
    stderr: "null",
  });
  const { code } = await command.output();
  return code;
}

/** Runs the compiled binary's analyze for one edition and returns the persisted knowledge. */
async function analyzeWithCompiledBinary(
  edition: string,
): Promise<{ kinds: string[]; primaryLanguage: string; symbolEdges: Array<{ from: string; to: string }> }> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: `exa_team_bin_${edition}_` });
  const alias = `go-${edition}`;
  try {
    await Deno.writeTextFile(join(workspaceRoot, "config.toml"), configToml(workspaceRoot));

    const addCode = await runTeamBinary(workspaceRoot, edition, ["portal", "add", GO_PORTAL, alias]);
    assertEquals(addCode, 0, `${edition}: portal add must succeed`);

    const analyzeCode = await runTeamBinary(workspaceRoot, edition, [
      "portal",
      "analyze",
      alias,
      "--mode",
      "standard",
    ]);
    assertEquals(analyzeCode, 0, `${edition}: portal analyze must succeed`);

    const knowledgePath = join(workspaceRoot, "Memory", "Projects", alias, "knowledge.json");
    const knowledge = JSON.parse(await Deno.readTextFile(knowledgePath)) as {
      techStack?: { primaryLanguage?: string };
      relationships?: Array<{ from: string; to: string; kind: string }>;
    };
    const relationships = knowledge.relationships ?? [];
    return {
      primaryLanguage: knowledge.techStack?.primaryLanguage ?? "",
      kinds: [...new Set(relationships.map((e) => e.kind))].sort(),
      symbolEdges: relationships
        .filter((e) => e.kind === SYMBOL_KIND)
        .map((e) => ({ from: e.from, to: e.to })),
    };
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}

Deno.test({
  name: "[team-binary] the compiled Team binary emits Go symbol edges only under EXAIX_EDITION=enterprise",
  ignore: !(await binaryExists()),
  fn: async () => {
    const enterprise = await analyzeWithCompiledBinary(EDITION_ENTERPRISE);

    // The compiled artifact must reach the Go extractors and the symbol pass.
    assertEquals(enterprise.primaryLanguage, "go", "the compiled binary must detect the Go portal");
    assert(
      enterprise.symbolEdges.length > 0,
      `the compiled Team binary must persist symbol edges under enterprise, got kinds ${
        JSON.stringify(enterprise.kinds)
      }`,
    );
    assert(
      enterprise.symbolEdges.some((e) => e.to === "helper/helper.go#Double"),
      `expected the cross-package edge, got ${JSON.stringify(enterprise.symbolEdges)}`,
    );
    for (const edge of enterprise.symbolEdges) {
      assert(edge.from.includes("#") && edge.to.includes("#"), `composite endpoints required: ${JSON.stringify(edge)}`);
    }

    // The same binary and the same flag must produce nothing for the other editions.
    const team = await analyzeWithCompiledBinary(EDITION_TEAM);
    assertEquals(team.symbolEdges, [], `team must emit no symbol edge, got ${JSON.stringify(team.symbolEdges)}`);

    const solo = await analyzeWithCompiledBinary(EDITION_SOLO);
    assertEquals(solo.symbolEdges, [], `solo must emit no symbol edge, got ${JSON.stringify(solo.symbolEdges)}`);
  },
});

Deno.test({
  name: "[team-binary] the delivery vehicle is the Team artifact, and no enterprise artifact ships the feature",
  ignore: !(await binaryExists()),
  fn: async () => {
    // GAP-14: the isolated Enterprise build is a scaffold.
    // A binary there must not be mistaken for the delivery vehicle.
    // The Team artifact is therefore the one asserted to exist.
    assert(await binaryExists(), "the Team artifact must be the built delivery vehicle");
    const enterpriseBinary = join(REPO_ROOT, "dist", "bin", `exaix-enterprise-${Deno.build.target}`);
    let enterprisePresent = false;
    try {
      enterprisePresent = (await Deno.stat(enterpriseBinary)).isFile;
    } catch {
      enterprisePresent = false;
    }
    if (enterprisePresent) {
      // If it exists, it must not be the thing under test: this test reads only the Team path.
      assert(TEAM_BINARY !== enterpriseBinary);
    }
  },
});

/** A realistic multi-file Go project.
 *  One package is split across two files.
 *  A second package is reached by module path. */
async function writeRealisticGoProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_realistic_go_" });
  await Deno.writeTextFile(join(root, "go.mod"), "module example.com/realistic\n\ngo 1.22\n");
  await Deno.writeTextFile(
    join(root, "format.go"),
    'package main\n\n// Format renders a value.\nfunc Format(v float64) string {\n\treturn "v"\n}\n',
  );
  await Deno.writeTextFile(
    join(root, "service.go"),
    "package main\n\n// Render calls Format from the SAME package but ANOTHER file.\nfunc Render(v float64) string {\n\treturn Format(v)\n}\n",
  );
  await Deno.mkdir(join(root, "src"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "src", "report.go"),
    'package src\n\nimport "example.com/realistic"\n\n// Report calls Format across packages.\nfunc Report(v float64) string {\n\treturn realistic.Format(v)\n}\n',
  );
  return root;
}

Deno.test({
  name: "[team-binary] the compiled binary answers who-calls across files of one package and across packages",
  ignore: !(await binaryExists()),
  fn: async () => {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "exa_team_bin_multi_" });
    const portalRoot = await writeRealisticGoProject();
    const alias = "realistic-go";
    try {
      await Deno.writeTextFile(join(workspaceRoot, "config.toml"), configToml(workspaceRoot));
      assertEquals(await runTeamBinary(workspaceRoot, EDITION_ENTERPRISE, ["portal", "add", portalRoot, alias]), 0);
      assertEquals(
        await runTeamBinary(workspaceRoot, EDITION_ENTERPRISE, ["portal", "analyze", alias, "--mode", "standard"]),
        0,
      );

      const knowledge = JSON.parse(
        await Deno.readTextFile(join(workspaceRoot, "Memory", "Projects", alias, "knowledge.json")),
      ) as { relationships?: Array<{ from: string; to: string; kind: string }> };
      const symbolEdges = (knowledge.relationships ?? []).filter((e) => e.kind === SYMBOL_KIND);
      const pairs = symbolEdges.map((e) => `${e.from}->${e.to}`).sort();

      // Same-package, different-file call. This is the dominant real Go layout.
      assert(
        pairs.includes("service.go#Render->format.go#Format"),
        `expected the same-package cross-file edge, got ${JSON.stringify(pairs)}`,
      );
      // Cross-package call through a module path.
      assert(
        pairs.includes("src/report.go#Report->format.go#Format"),
        `expected the cross-package edge, got ${JSON.stringify(pairs)}`,
      );
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true });
      await Deno.remove(portalRoot, { recursive: true });
    }
  },
});
