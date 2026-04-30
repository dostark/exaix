/**
 * @module ArtifactRegistryTest
 * @path tests/services/artifact/artifact_registry_test.ts
 * @description Verifies the ArtifactRegistry service, ensuring agent-produced files are
 * correctly indexed in the database and persisted within the Memory/Execution directory.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { DatabaseService } from "../../../src/services/core/db.ts";
import { join } from "@std/path";
import { ArtifactRegistry } from "../../../src/services/artifact/artifact_registry.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { ReviewStatus } from "@exaix/core/status/review_status.ts";

async function createTestContext(): Promise<{ tempDir: string; db: DatabaseService; cleanup: () => Promise<void> }> {
  const { db, tempDir, cleanup } = await initTestDbService();
  return { tempDir, db, cleanup };
}

Deno.test("[artifact] createArtifact() creates file with frontmatter in Memory/Execution/", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const artifactId = await registry.createArtifact(
      "request-123",
      "code-analyst",
      "# Analysis\n\nCode is good.",
      "my-project",
    );

    // Verify artifact ID format
    assertStringIncludes(artifactId, "artifact-", "Artifact ID should have prefix");

    // Verify file exists
    const expectedPath = join(tempDir, "Memory", "Execution", `${artifactId}.md`);
    const content = await Deno.readTextFile(expectedPath);

    // Verify frontmatter structure
    assertStringIncludes(content, `status: ${ReviewStatus.PENDING}`, "Should have pending status");
    assertStringIncludes(content, "identity: code-analyst", "Should have agent");
    assertStringIncludes(content, "portal: my-project", "Should have portal");
    assertStringIncludes(content, "request_id: request-123", "Should have request_id");
    assertStringIncludes(content, "# Analysis", "Should have content body");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] createArtifact() stores artifact in database", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const artifactId = await registry.createArtifact(
      "request-456",
      "quality-judge",
      "Quality report content",
    );

    // Verify database entry
    const artifact = await registry.getArtifact(artifactId);

    assertEquals(artifact.id, artifactId, "Should match artifact ID");
    assertEquals(artifact.status, ReviewStatus.PENDING, "Should be pending");
    assertEquals(artifact.identity, "quality-judge", "Should have agent");
    assertEquals(artifact.request_id, "request-456", "Should have request_id");
    assertExists(artifact.file_path, "Should have file path");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] updateStatus() changes status from pending to approved", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const artifactId = await registry.createArtifact(
      "request-789",
      "code-analyst",
      "Analysis content",
    );

    // Update status
    await registry.updateStatus(artifactId, ReviewStatus.APPROVED);

    // Verify frontmatter updated
    const artifact = await registry.getArtifact(artifactId);
    const content = await Deno.readTextFile(join(tempDir, artifact.file_path));

    assertStringIncludes(content, `status: ${ReviewStatus.APPROVED}`, "Frontmatter should show approved");
    assertEquals(artifact.status, ReviewStatus.APPROVED, "Database should show approved");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] updateStatus() changes status from pending to rejected with reason", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const artifactId = await registry.createArtifact(
      "request-999",
      "code-analyst",
      "Analysis content",
    );

    // Update status with rejection reason
    await registry.updateStatus(artifactId, ReviewStatus.REJECTED, "Analysis incomplete");

    // Verify frontmatter updated
    const artifact = await registry.getArtifact(artifactId);
    const content = await Deno.readTextFile(join(tempDir, artifact.file_path));

    assertStringIncludes(content, `status: ${ReviewStatus.REJECTED}`, "Frontmatter should show rejected");
    assertEquals(artifact.status, ReviewStatus.REJECTED, "Database should show rejected");
    assertEquals(artifact.rejection_reason, "Analysis incomplete", "Should store reason");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] listArtifacts() filters by status", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    // Create multiple artifacts
    const id1 = await registry.createArtifact("req-1", "agent1", "Content 1");
    const id2 = await registry.createArtifact("req-2", "agent2", "Content 2");
    await registry.createArtifact("req-3", "agent3", "Content 3");

    // Approve one, reject another
    await registry.updateStatus(id1, ReviewStatus.APPROVED);
    await registry.updateStatus(id2, ReviewStatus.REJECTED);

    // List by status
    const pending = await registry.listArtifacts({ status: ReviewStatus.PENDING });
    const approved = await registry.listArtifacts({ status: ReviewStatus.APPROVED });
    const rejected = await registry.listArtifacts({ status: ReviewStatus.REJECTED });

    assertEquals(pending.length, 1, "Should have 1 pending");
    assertEquals(approved.length, 1, "Should have 1 approved");
    assertEquals(rejected.length, 1, "Should have 1 rejected");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] listArtifacts() filters by agent", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    await registry.createArtifact("req-1", "code-analyst", "Content 1");
    await registry.createArtifact("req-2", "code-analyst", "Content 2");
    await registry.createArtifact("req-3", "quality-judge", "Content 3");

    const analystArtifacts = await registry.listArtifacts({ identity: "code-analyst" });
    const judgeArtifacts = await registry.listArtifacts({ identity: "quality-judge" });

    assertEquals(analystArtifacts.length, 2, "Should have 2 code-analyst artifacts");
    assertEquals(judgeArtifacts.length, 1, "Should have 1 quality-judge artifact");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] listArtifacts() filters by portal", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    await registry.createArtifact("req-1", "agent1", "Content 1", "portal-a");
    await registry.createArtifact("req-2", "agent2", "Content 2", "portal-a");
    await registry.createArtifact("req-3", "agent3", "Content 3", "portal-b");
    await registry.createArtifact("req-4", "agent4", "Content 4"); // No portal

    const portalA = await registry.listArtifacts({ portal: "portal-a" });
    const portalB = await registry.listArtifacts({ portal: "portal-b" });

    assertEquals(portalA.length, 2, "Should have 2 artifacts for portal-a");
    assertEquals(portalB.length, 1, "Should have 1 artifact for portal-b");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] getArtifact() returns artifact with content", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const content = "# Test Analysis\n\nThis is the analysis body.";
    const artifactId = await registry.createArtifact(
      "request-test",
      "code-analyst",
      content,
    );

    const artifact = await registry.getArtifact(artifactId);

    assertExists(artifact.content, "Should have content");
    assertStringIncludes(artifact.content, "# Test Analysis", "Should include body");
    assertStringIncludes(artifact.content, `status: ${ReviewStatus.PENDING}`, "Should include frontmatter");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] createArtifact() without portal creates artifact with null portal", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const registry = new ArtifactRegistry(db, tempDir);

    const artifactId = await registry.createArtifact(
      "request-no-portal",
      "code-analyst",
      "Content without portal",
    );

    const artifact = await registry.getArtifact(artifactId);

    assertEquals(artifact.portal, null, "Portal should be null");

    // Verify frontmatter
    const content = await Deno.readTextFile(join(tempDir, artifact.file_path));
    assertStringIncludes(content, "portal: null", "Frontmatter should show null portal");
  } finally {
    await cleanup();
  }
});

Deno.test("[artifact] Memory/Execution directory is created if missing", async () => {
  const { tempDir, db, cleanup } = await createTestContext();
  try {
    const executionDir = join(tempDir, "Memory", "Execution");
    // Remove Memory/Execution if it exists
    try {
      await Deno.remove(executionDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }

    const registry = new ArtifactRegistry(db, tempDir);

    await registry.createArtifact(
      "request-dir-test",
      "code-analyst",
      "Test content",
    );

    // Verify directory was created
    const stat = await Deno.stat(executionDir);
    assertEquals(stat.isDirectory, true, "Memory/Execution should be a directory");
  } finally {
    await cleanup();
  }
});
