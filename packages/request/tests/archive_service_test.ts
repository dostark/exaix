/**
 * @module ArchiveServiceTest
 * @path tests/services/archive/archive_service_test.ts
 * @description Unit tests for ArchiveService (src/services/archive_service.ts).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ArchiveEntrySchema, ArchiveService } from "@exaix/core/artifact";
import { ArchiveStatus } from "@exaix/core";

function createSampleEntry(overrides: Partial<ReturnType<typeof ArchiveEntrySchema.parse>> = {}) {
  return ArchiveEntrySchema.parse({
    trace_id: overrides.trace_id ?? crypto.randomUUID(),
    request_id: overrides.request_id ?? "req-1",
    identity_id: overrides.identity_id ?? "agent-1",
    archived_at: overrides.archived_at ?? new Date().toISOString(),
    completed_at: overrides.completed_at ?? new Date().toISOString(),
    status: overrides.status ?? ArchiveStatus.COMPLETED,
    step_count: overrides.step_count ?? 3,
    duration_ms: overrides.duration_ms ?? 1500,
    tags: overrides.tags ?? ["test"],
  });
}

Deno.test("ArchiveService: archivePlan creates directory structure and files", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-" });
  try {
    const service = new ArchiveService(tempDir);
    const entry = createSampleEntry({ archived_at: "2025-06-15T10:00:00.000Z" });

    await service.archivePlan(entry, "# Plan Content", "# Request Content");

    // Verify directory structure: archiveRoot/2025/06/<trace_id>/
    const planPath = join(tempDir, "2025", "06", entry.trace_id, "plan.md");
    const planContent = await Deno.readTextFile(planPath);
    assertEquals(planContent, "# Plan Content");

    const requestPath = join(tempDir, "2025", "06", entry.trace_id, "request.md");
    const requestContent = await Deno.readTextFile(requestPath);
    assertEquals(requestContent, "# Request Content");

    const summaryPath = join(tempDir, "2025", "06", entry.trace_id, "summary.json");
    const summaryContent = JSON.parse(await Deno.readTextFile(summaryPath));
    assertEquals(summaryContent.trace_id, entry.trace_id);

    // Verify index was updated
    const indexPath = join(tempDir, "index.json");
    const index = JSON.parse(await Deno.readTextFile(indexPath));
    assertEquals(index.length, 1);
    assertEquals(index[0].trace_id, entry.trace_id);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: updateIndex appends to existing index", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-index-" });
  try {
    const service = new ArchiveService(tempDir);
    const entry1 = createSampleEntry();
    const entry2 = createSampleEntry();

    await service.updateIndex(entry1);
    await service.updateIndex(entry2);

    const indexPath = join(tempDir, "index.json");
    const index = JSON.parse(await Deno.readTextFile(indexPath));
    assertEquals(index.length, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: getByTraceId returns matching entry", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-get-" });
  try {
    const service = new ArchiveService(tempDir);
    const entry1 = createSampleEntry({ identity_id: "alpha" });
    const entry2 = createSampleEntry({ identity_id: "beta" });

    await service.updateIndex(entry1);
    await service.updateIndex(entry2);

    const result = await service.getByTraceId(entry2.trace_id);
    assertEquals(result !== undefined, true);
    assertEquals(result?.identity_id, "beta");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: getByTraceId returns undefined for missing id", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-missing-" });
  try {
    const service = new ArchiveService(tempDir);
    const entry = createSampleEntry();
    await service.updateIndex(entry);

    const result = await service.getByTraceId("nonexistent-id");
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: getByTraceId returns undefined when no index", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-noindex-" });
  try {
    const service = new ArchiveService(tempDir);
    const result = await service.getByTraceId("any-id");
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: searchByAgent filters by identity_id", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-agent-" });
  try {
    const service = new ArchiveService(tempDir);
    await service.updateIndex(createSampleEntry({ identity_id: "alpha" }));
    await service.updateIndex(createSampleEntry({ identity_id: "beta" }));
    await service.updateIndex(createSampleEntry({ identity_id: "alpha" }));

    const results = await service.searchByAgent("alpha");
    assertEquals(results.length, 2);
    results.forEach((e) => assertEquals(e.identity_id, "alpha"));
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: searchByAgent returns empty when no index", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-agent-noindex-" });
  try {
    const service = new ArchiveService(tempDir);
    const results = await service.searchByAgent("any");
    assertEquals(results, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: searchByDateRange filters between dates", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-date-" });
  try {
    const service = new ArchiveService(tempDir);
    await service.updateIndex(createSampleEntry({ archived_at: "2025-01-15T00:00:00.000Z" }));
    await service.updateIndex(createSampleEntry({ archived_at: "2025-06-15T00:00:00.000Z" }));
    await service.updateIndex(createSampleEntry({ archived_at: "2025-12-15T00:00:00.000Z" }));

    const results = await service.searchByDateRange(
      "2025-03-01T00:00:00.000Z",
      "2025-09-01T00:00:00.000Z",
    );
    assertEquals(results.length, 1);
    assertEquals(results[0].archived_at, "2025-06-15T00:00:00.000Z");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("ArchiveService: searchByDateRange returns empty when no index", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "archive-svc-date-noindex-" });
  try {
    const service = new ArchiveService(tempDir);
    const results = await service.searchByDateRange("2025-01-01", "2025-12-31");
    assertEquals(results, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
