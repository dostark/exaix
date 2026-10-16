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

import { DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH } from "@exaix/shared";
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

    const knowledgePath = join(
      workspaceRoot,
      DEFAULT_MEMORY_PATH,
      DEFAULT_PROJECTS_MEMORY_PATH,
      alias,
      "knowledge.json",
    );
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

const ENTERPRISE_BINARY = join(REPO_ROOT, "dist", "bin", `exaix-enterprise-${Deno.build.target}`);

Deno.test({
  name: "[team-binary] the delivery vehicle is the Team artifact, and the enterprise artifact ships no feature",
  ignore: !(await binaryExists()),
  fn: async () => {
    // GAP-14: the isolated Enterprise workspace is a scaffold. It cannot import
    // the Team-owned extractor seam, so it cannot deliver this feature. This test
    // holds that down instead of leaving it as prose.
    assert(await binaryExists(), "the Team artifact must be the built delivery vehicle");

    let enterprisePresent = false;
    try {
      enterprisePresent = (await Deno.stat(ENTERPRISE_BINARY)).isFile;
    } catch {
      enterprisePresent = false;
    }

    if (!enterprisePresent) {
      console.warn(
        "[team-binary] no enterprise artifact present; build it with `deno run -A scripts/ci.ts build --edition enterprise -c` to check the boundary",
      );
      return;
    }

    // The two artifacts must stay distinct.
    // The enterprise one must not expose the analysis command.
    assert(TEAM_BINARY !== ENTERPRISE_BINARY);
    const probe = new Deno.Command(ENTERPRISE_BINARY, {
      args: ["portal", "analyze", "anything"],
      stdout: "piped",
      stderr: "piped",
      env: { ...Deno.env.toObject(), EXAIX_EDITION: EDITION_ENTERPRISE },
    });
    const { stdout, stderr } = await probe.output();
    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

    assert(
      /scaffold|no feature work/i.test(output),
      `the enterprise artifact must still report itself as a scaffold, got: ${output.slice(0, 200)}`,
    );

    // The Team binary, by contrast, does accept the analysis command.
    const teamProbe = new Deno.Command(TEAM_BINARY, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
      env: { ...Deno.env.toObject(), EXAIX_EDITION: EDITION_ENTERPRISE, EXA_LLM_PROVIDER: "mock" },
    });
    const teamOut = await teamProbe.output();
    const teamText = new TextDecoder().decode(teamOut.stdout) + new TextDecoder().decode(teamOut.stderr);
    assert(/exactl/i.test(teamText), `the Team artifact must be the real CLI, got: ${teamText.slice(0, 200)}`);
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
        await Deno.readTextFile(
          join(workspaceRoot, DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH, alias, "knowledge.json"),
        ),
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

/** A TS/Python fixture pair sharing one call-chain shape. */
const SCRIPTED_FIXTURES: Array<{
  label: string;
  files: { [path: string]: string };
  expected: string[];
}> = [
  {
    label: "typescript",
    files: {
      "src/core.ts": "export function ship(v: number): number {\n  return v * 2;\n}\n",
      "src/deep.ts":
        'import { ship } from "./core.ts";\n\nexport function level3(v: number): number {\n  return ship(v) + 1;\n}\n\nexport function level2(v: number): number {\n  return level3(v) * 2;\n}\n',
      "src/sibling.ts":
        'import { level2 } from "./deep.ts";\n\nexport function level1(v: number): number {\n  return level2(v) + 3;\n}\n',
      "src/remote.ts":
        'import { ship } from "./core.ts";\n\nexport function remote(v: number): number {\n  return ship(v);\n}\n',
    },
    expected: [
      "src/deep.ts#level2->src/deep.ts#level3",
      "src/deep.ts#level3->src/core.ts#ship",
      "src/remote.ts#remote->src/core.ts#ship",
      "src/sibling.ts#level1->src/deep.ts#level2",
    ],
  },
  {
    label: "javascript",
    files: {
      "src/core.js": "export function ship(v) {\n  return v * 2;\n}\n",
      "src/deep.js":
        'import { ship } from "./core.js";\n\nexport function level3(v) {\n  return ship(v) + 1;\n}\n\nexport function level2(v) {\n  return level3(v) * 2;\n}\n',
      "src/sibling.js":
        'import { level2 } from "./deep.js";\n\nexport function level1(v) {\n  return level2(v) + 3;\n}\n',
      "src/remote.js": 'import { ship } from "./core.js";\n\nexport function remote(v) {\n  return ship(v);\n}\n',
    },
    expected: [
      "src/deep.js#level2->src/deep.js#level3",
      "src/deep.js#level3->src/core.js#ship",
      "src/remote.js#remote->src/core.js#ship",
      "src/sibling.js#level1->src/deep.js#level2",
    ],
  },
  {
    label: "python",
    files: {
      "app/core.py": "def ship(v):\n    return v * 2\n",
      "app/deep.py":
        "from app.core import ship\n\ndef level3(v):\n    return ship(v) + 1\n\ndef level2(v):\n    return level3(v) * 2\n",
      "app/sibling.py": "from app.deep import level2\n\ndef level1(v):\n    return level2(v) + 3\n",
      "app/remote.py": "from app.core import ship\n\ndef remote(v):\n    return ship(v)\n",
    },
    expected: [
      "app/deep.py#level2->app/deep.py#level3",
      "app/deep.py#level3->app/core.py#ship",
      "app/remote.py#remote->app/core.py#ship",
      "app/sibling.py#level1->app/deep.py#level2",
    ],
  },
];

for (const fixture of SCRIPTED_FIXTURES) {
  Deno.test({
    name: `[team-binary] the compiled binary answers who-calls for ${fixture.label}`,
    ignore: !(await binaryExists()),
    fn: async () => {
      const workspaceRoot = await Deno.makeTempDir({ prefix: `exa_team_bin_${fixture.label}_` });
      const portalRoot = await Deno.makeTempDir({ prefix: `exa_team_portal_${fixture.label}_` });
      const alias = `scripted-${fixture.label}`;
      try {
        for (const [relative, content] of Object.entries(fixture.files)) {
          await Deno.mkdir(join(portalRoot, relative, ".."), { recursive: true });
          await Deno.writeTextFile(join(portalRoot, relative), content);
        }
        await Deno.writeTextFile(join(workspaceRoot, "config.toml"), configToml(workspaceRoot));
        assertEquals(await runTeamBinary(workspaceRoot, EDITION_ENTERPRISE, ["portal", "add", portalRoot, alias]), 0);
        assertEquals(
          await runTeamBinary(workspaceRoot, EDITION_ENTERPRISE, ["portal", "analyze", alias, "--mode", "standard"]),
          0,
        );

        const knowledge = JSON.parse(
          await Deno.readTextFile(
            join(workspaceRoot, DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH, alias, "knowledge.json"),
          ),
        ) as { relationships?: Array<{ from: string; to: string; kind: string }> };
        const pairs = (knowledge.relationships ?? [])
          .filter((e) => e.kind === SYMBOL_KIND)
          .map((e) => `${e.from}->${e.to}`)
          .sort();

        assertEquals(pairs, fixture.expected, `${fixture.label}: the persisted reference edges must match`);

        // The gate must hold for these languages too.
        const teamPairs = await (async () => {
          const teamAlias = `${alias}-team`;
          await Deno.writeTextFile(join(workspaceRoot, "config.toml"), configToml(workspaceRoot));
          assertEquals(await runTeamBinary(workspaceRoot, EDITION_TEAM, ["portal", "add", portalRoot, teamAlias]), 0);
          assertEquals(
            await runTeamBinary(workspaceRoot, EDITION_TEAM, ["portal", "analyze", teamAlias, "--mode", "standard"]),
            0,
          );
          const teamKnowledge = JSON.parse(
            await Deno.readTextFile(
              join(workspaceRoot, DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH, teamAlias, "knowledge.json"),
            ),
          ) as { relationships?: Array<{ kind: string }> };
          return (teamKnowledge.relationships ?? []).filter((e) => e.kind === SYMBOL_KIND);
        })();
        assertEquals(teamPairs, [], `${fixture.label}: team edition must emit no symbol edge`);
      } finally {
        await Deno.remove(workspaceRoot, { recursive: true });
        await Deno.remove(portalRoot, { recursive: true });
      }
    },
  });
}
