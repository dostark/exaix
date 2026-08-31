/**
 * @module ScenarioFrameworkArtefactCatalogTest
 * @path tests/scenario_framework/tests/unit/artefact_catalog_test.ts
 * @description Tests for Phase 158 Step 7's live-catalog reader: enumerates the real
 * `Blueprints/{Identities,Skills,Flows}` trees into the `IArtefactRef[]` shape
 * `assertArtefactDecisionCoverage` consumes, applying the same exclusions Phase 158
 * has used throughout (README files, the non-curated `mock-agent`/`default`
 * identities, flow ids read from each file's declared `id:` rather than its
 * filename — the historical `api_design` vs `api-design` bug this repo already hit
 * once in `flow_eval_parity_test.ts`).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/artefact_catalog.ts, tests/scenario_framework/runner/artefact_decision_coverage.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadArtefactCatalog } from "../../runner/artefact_catalog.ts";
import { ArtefactKind } from "../../runner/artefact_decision_coverage.ts";

async function writeFixtureBlueprints(root: string): Promise<void> {
  const identitiesDir = join(root, "Identities");
  const skillsDir = join(root, "Skills");
  const flowsDir = join(root, "Flows");
  const templatesDir = join(flowsDir, "templates");
  await Deno.mkdir(identitiesDir, { recursive: true });
  await Deno.mkdir(skillsDir, { recursive: true });
  await Deno.mkdir(templatesDir, { recursive: true });

  await Deno.writeTextFile(join(identitiesDir, "README.md"), "# not an identity");
  await Deno.writeTextFile(join(identitiesDir, "senior-coder.md"), "---\nmodel: x\n---\nbody");
  await Deno.writeTextFile(join(identitiesDir, "mock-agent.md"), "---\nmodel: mock:x\n---\nbody");
  await Deno.writeTextFile(join(identitiesDir, "default.md"), "---\nmodel: x\n---\nbody");

  await Deno.writeTextFile(join(skillsDir, "README.md"), "# not a skill");
  await Deno.writeTextFile(join(skillsDir, "response-contract.skill.md"), "---\nid: response-contract\n---\nbody");

  await Deno.writeTextFile(join(flowsDir, "README.md"), "# not a flow");
  await Deno.writeTextFile(
    join(flowsDir, "feature-development.flow.yaml"),
    "id: feature-development\nsteps: []\n",
  );
  await Deno.writeTextFile(
    join(templatesDir, "pipeline.flow.template.yaml"),
    "id: pipeline-template\nsteps: []\n",
  );
}

Deno.test("[ArtefactCatalog] a fixture catalog resolves to the expected refs", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeFixtureBlueprints(root);
    const catalog = await loadArtefactCatalog(root);

    assertEquals(
      catalog.sort((a, b) => `${a.kind}:${a.artefactId}`.localeCompare(`${b.kind}:${b.artefactId}`)),
      [
        { kind: ArtefactKind.FLOW, artefactId: "feature-development" },
        { kind: ArtefactKind.IDENTITY, artefactId: "senior-coder" },
        { kind: ArtefactKind.SKILL, artefactId: "response-contract" },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[ArtefactCatalog] README files never appear in any kind", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeFixtureBlueprints(root);
    const catalog = await loadArtefactCatalog(root);
    assertEquals(catalog.some((ref) => ref.artefactId === "README"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[ArtefactCatalog] mock-agent and default are excluded (non-curated identities)", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeFixtureBlueprints(root);
    const catalog = await loadArtefactCatalog(root);
    const identityIds = catalog.filter((r) => r.kind === ArtefactKind.IDENTITY).map((r) => r.artefactId);
    assertEquals(identityIds, ["senior-coder"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[ArtefactCatalog] a flow's id comes from its declared `id:` field, not the filename", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "Identities"), { recursive: true });
    await Deno.mkdir(join(root, "Skills"), { recursive: true });
    await Deno.mkdir(join(root, "Flows"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "Flows", "mismatched-filename.flow.yaml"),
      "id: real-declared-id\nsteps: []\n",
    );

    const catalog = await loadArtefactCatalog(root);
    assertEquals(catalog, [{ kind: ArtefactKind.FLOW, artefactId: "real-declared-id" }]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[ArtefactCatalog] flow templates under Flows/templates/ are not enumerated", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeFixtureBlueprints(root);
    const catalog = await loadArtefactCatalog(root);
    const flowIds = catalog.filter((r) => r.kind === ArtefactKind.FLOW).map((r) => r.artefactId);
    assertEquals(flowIds, ["feature-development"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[ArtefactCatalog] the real repo catalog matches the published counts (16/27/20)", async () => {
  const repoRoot = join(new URL("../../../../", import.meta.url).pathname);
  const catalog = await loadArtefactCatalog(join(repoRoot, "Blueprints"));

  const byKind = (kind: ArtefactKind) => catalog.filter((r) => r.kind === kind).length;

  // Blueprints/Identities/aci-react.md (a real-daemon scenario fixture identity) is included,
  // bringing the curated count to 16.
  assertEquals(byKind(ArtefactKind.IDENTITY), 16, "curated identities (excluding README, mock-agent, default)");
  assertEquals(byKind(ArtefactKind.SKILL), 27, "skills");
  // Includes 3 mechanism-proof fixture flows (strategy-comparison-cli-delegate,
  // strategy-comparison-react, strategy-routing-smoke), each with NON_COVERAGE entries in
  // scripts/check_artefact_decision_coverage.ts's FLOW_DECISIONS.
  assertEquals(byKind(ArtefactKind.FLOW), 20, "runnable flows (excluding templates/)");
});
