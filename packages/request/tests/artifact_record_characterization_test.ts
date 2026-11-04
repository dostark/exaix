/**
 * @module ArtifactRecordCharacterizationTest
 * @path packages/request/tests/artifact_record_characterization_test.ts
 * @description Pins the stored fields of an artifact record, so that the record keeps its shape when createArtifactRecord takes one named record instead of nine positional parameters.
 * @architectural-layer Test
 * @related-files [packages/core/src/artifact/artifact_repository.ts, packages/core/src/artifact/artifact_registry.ts]
 */

import { assertEquals, assertMatch } from "@std/assert";
import { ArtifactRegistry, DatabaseArtifactRepository } from "@exaix/core/artifact";
import { ReviewStatus } from "@exaix/core/status";
import { initTestDbService } from "@exaix/testing";

Deno.test("artifact-record-characterization: a created artifact stores every field the registry sets", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseArtifactRepository(db);
    const registry = new ArtifactRegistry(repo, tempDir);
    const id = await registry.createArtifact("request-9", "code-analyst", "# Body", "my-project", "  feat/x  ");
    const row = await repo.getArtifactRecord(id);
    assertEquals(row?.id, id);
    assertEquals(
      [row?.status, row?.type, row?.agent_role, row?.portal, row?.target_branch, row?.request_id],
      [ReviewStatus.PENDING, "analysis", "code-analyst", "my-project", "feat/x", "request-9"],
    );
    assertMatch(row?.created ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assertMatch(row?.file_path ?? "", new RegExp(`${id}\\.md$`));
    assertEquals([row?.updated ?? null, row?.rejection_reason ?? null], [null, null]);
  } finally {
    await cleanup();
  }
});

Deno.test("artifact-record-characterization: a missing portal and branch are stored as null", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseArtifactRepository(db);
    const registry = new ArtifactRegistry(repo, tempDir);
    const id = await registry.createArtifact("request-10", "quality-judge", "Report");
    const row = await repo.getArtifactRecord(id);
    assertEquals([row?.portal, row?.target_branch], [null, null]);
  } finally {
    await cleanup();
  }
});

Deno.test("artifact-record-characterization: the repository stores a record that names every field", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const repo = new DatabaseArtifactRepository(db);
    await repo.createArtifactRecord({
      id: "artifact-direct",
      status: ReviewStatus.PENDING,
      type: "analysis",
      agent_role: "code-analyst",
      portal: null,
      target_branch: "main",
      created: "2026-11-04T00:00:00.000Z",
      request_id: "request-direct",
      file_path: "Memory/Execution/artifact-direct.md",
    });
    const row = await repo.getArtifactRecord("artifact-direct");
    assertEquals([row?.portal, row?.target_branch, row?.request_id], [null, "main", "request-direct"]);
    assertEquals(row?.file_path, "Memory/Execution/artifact-direct.md");
  } finally {
    await cleanup();
  }
});
