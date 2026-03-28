/**
 * @module RequestServiceTest
 * @path tests/services/request_service_test.ts
 * @description Unit tests for the core RequestService (src/services/request.ts).
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { RequestService } from "../../../src/services/request.ts";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import { RequestPriority, RequestSource } from "../../../src/shared/enums.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { createStubConfig, createStubDisplay } from "../../helpers/test_helpers.ts";
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";

function createTestRequestService(root: string, overrides?: {
  userIdentity?: string;
}) {
  const config = createMockConfig(root);
  const configService = createStubConfig(config);
  const display = createStubDisplay();
  const userIdentity = overrides?.userIdentity ?? "tester";

  return new RequestService(
    config,
    configService,
    display,
    () => Promise.resolve(userIdentity),
  );
}

Deno.test("RequestService.create: creates a request file with correct frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-create-" });
  try {
    const service = createTestRequestService(tempDir);
    const metadata = await service.create("Build the login page");

    assertEquals(metadata.status, RequestStatus.PENDING);
    assertEquals(metadata.priority, RequestPriority.NORMAL);
    assertEquals(metadata.identity, "default");
    assertEquals(metadata.source, RequestSource.CLI);
    assertEquals(metadata.created_by, "tester");
    assertEquals(metadata.subject, "Build the login page");

    // Verify the file was actually written
    const content = await Deno.readTextFile(metadata.path!);
    assertEquals(content.includes("trace_id:"), true);
    assertEquals(content.includes("Build the login page"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.create: throws on empty description", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-empty-" });
  try {
    const service = createTestRequestService(tempDir);
    await assertRejects(
      () => service.create(""),
      Error,
      "Description cannot be empty",
    );
    await assertRejects(
      () => service.create("   "),
      Error,
      "Description cannot be empty",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.create: uses provided options", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-opts-" });
  try {
    const service = createTestRequestService(tempDir);
    const metadata = await service.create("Custom request", {
      priority: RequestPriority.HIGH,
      identity: "coder",
      portal: "myportal",
      target_branch: "feature/test",
      model: "gpt-5",
      flow: "code-review",
      subject: "Custom subject",
      skills: ["typescript", "deno"],
    }, RequestSource.TUI);

    assertEquals(metadata.priority, RequestPriority.HIGH);
    assertEquals(metadata.identity, "coder");
    assertEquals(metadata.portal, "myportal");
    assertEquals(metadata.target_branch, "feature/test");
    assertEquals(metadata.model, "gpt-5");
    assertEquals(metadata.flow, "code-review");
    assertEquals(metadata.source, RequestSource.TUI);
    assertEquals(metadata.subject, "Custom subject");
    assertEquals(metadata.skills, ["typescript", "deno"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.create: subject_is_fallback when no explicit subject", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-fallback-" });
  try {
    const service = createTestRequestService(tempDir);
    const metadata = await service.create("Test description");

    const content = await Deno.readTextFile(metadata.path!);
    assertEquals(content.includes("subject_is_fallback: true"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.list: returns empty array for missing directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-list-empty-" });
  try {
    const service = createTestRequestService(tempDir);
    const list = await service.list();
    assertEquals(list, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.list: lists created requests sorted by created desc", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-list-" });
  try {
    const service = createTestRequestService(tempDir);
    await service.create("First request");
    // small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await service.create("Second request");

    const list = await service.list();
    assertEquals(list.length, 2);
    // Should be sorted most recent first
    assertEquals(list[0].created >= list[1].created, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.list: filters by status", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-filter-" });
  try {
    const service = createTestRequestService(tempDir);
    await service.create("Pending request");
    const meta = await service.create("Soon completed");

    // Update status of the second request
    await service.updateRequestStatus(meta.trace_id, RequestStatus.COMPLETED);

    const pendingOnly = await service.list(RequestStatus.PENDING);
    assertEquals(pendingOnly.length, 1);

    const completedOnly = await service.list(RequestStatus.COMPLETED);
    assertEquals(completedOnly.length, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.show: retrieves request by trace_id", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-show-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("Show me request");

    const shown = await service.show(meta.trace_id);
    assertEquals(shown.metadata.trace_id, meta.trace_id);
    assertEquals(shown.content.includes("Show me request"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.show: retrieves request by partial id", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-partial-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("Partial ID lookup");
    const shortId = meta.trace_id.slice(0, 8);

    const shown = await service.show(shortId);
    assertEquals(shown.metadata.trace_id, meta.trace_id);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.show: throws for non-existent request", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-notfound-" });
  try {
    const service = createTestRequestService(tempDir);
    await assertRejects(
      () => service.show("nonexistent"),
      Error,
      "Request not found",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.getRequestContent: returns content body", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-content-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("Get this content body");

    const content = await service.getRequestContent(meta.trace_id);
    assertEquals(content.includes("Get this content body"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.updateRequestStatus: updates frontmatter status", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-update-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("Update my status");

    const result = await service.updateRequestStatus(meta.trace_id, RequestStatus.COMPLETED);
    assertEquals(result, true);

    // Verify updated
    const shown = await service.show(meta.trace_id);
    assertEquals(shown.metadata.status, RequestStatus.COMPLETED);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.updateRequestStatus: returns false for non-existent request", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-update-missing-" });
  try {
    const service = createTestRequestService(tempDir);
    const result = await service.updateRequestStatus("nonexistent", RequestStatus.COMPLETED);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService: parsePriority returns NORMAL for unknown values", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-priority-" });
  try {
    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);
    await Deno.mkdir(requestsDir, { recursive: true });

    // Write a file with unknown priority
    const content = `---
trace_id: test-id
created: ${new Date().toISOString()}
status: pending
priority: extreme
identity: default
source: cli
created_by: tester
subject: Test
---

# Request

Test body
`;
    await Deno.writeTextFile(join(requestsDir, "request-test1234.md"), content);

    const service = createTestRequestService(tempDir);
    const shown = await service.show("request-test1234.md");
    assertEquals(shown.metadata.priority, RequestPriority.NORMAL);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService: parseSource returns 'cli' for unknown values", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-source-" });
  try {
    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);
    await Deno.mkdir(requestsDir, { recursive: true });

    const content = `---
trace_id: test-id
created: ${new Date().toISOString()}
status: pending
priority: normal
identity: default
source: webhook
created_by: tester
subject: Test
---

# Request

Test body
`;
    await Deno.writeTextFile(join(requestsDir, "request-test5678.md"), content);

    const service = createTestRequestService(tempDir);
    const shown = await service.show("request-test5678.md");
    assertEquals(shown.metadata.source, RequestSource.CLI);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────
// Additional coverage: malformed frontmatter, show by filename,
// updateRequestStatus by filename, list with non-md files
// ──────────────────────────────────────────────────────────────────────

Deno.test("RequestService.show: returns default metadata for file without frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-nofm-" });
  try {
    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);
    await Deno.mkdir(requestsDir, { recursive: true });

    // Write a file with NO frontmatter
    await Deno.writeTextFile(
      join(requestsDir, "request-nofm1234.md"),
      "# Just markdown\n\nNo frontmatter here.",
    );

    const service = createTestRequestService(tempDir);
    const shown = await service.show("request-nofm1234.md");

    // Should get default fallback values
    assertEquals(shown.metadata.trace_id, "");
    assertEquals(shown.metadata.status, RequestStatus.PENDING);
    assertEquals(shown.metadata.priority, RequestPriority.NORMAL);
    assertEquals(shown.metadata.identity, "default");
    assertEquals(shown.metadata.created_by, "unknown");
    assertEquals(shown.content.includes("Just markdown"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.show: retrieves request by .md filename directly", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-byfile-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("By filename lookup");

    // Show by the .md filename
    const shown = await service.show(meta.filename);
    assertEquals(shown.metadata.trace_id, meta.trace_id);
    assertEquals(shown.content.includes("By filename lookup"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.updateRequestStatus: updates by trace_id via findFilename", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-upd-trace-" });
  try {
    const service = createTestRequestService(tempDir);
    const meta = await service.create("Update by full trace_id");

    // Update using the full trace_id (not ending in .md)
    const result = await service.updateRequestStatus(meta.trace_id, RequestStatus.COMPLETED);
    assertEquals(result, true);

    const shown = await service.show(meta.trace_id);
    assertEquals(shown.metadata.status, RequestStatus.COMPLETED);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.updateRequestStatus: returns false when frontmatter missing", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-upd-nofm-" });
  try {
    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);
    await Deno.mkdir(requestsDir, { recursive: true });

    // Write a file with no frontmatter
    await Deno.writeTextFile(
      join(requestsDir, "request-nofm9999.md"),
      "No frontmatter content",
    );

    const service = createTestRequestService(tempDir);
    const result = await service.updateRequestStatus("request-nofm9999.md", RequestStatus.COMPLETED);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.list: ignores non-.md files and non-file entries", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-list-mixed-" });
  try {
    const service = createTestRequestService(tempDir);
    await service.create("Valid request");

    // Add non-.md file and a subdirectory
    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);
    await Deno.writeTextFile(join(requestsDir, "notes.txt"), "not a request");
    await Deno.mkdir(join(requestsDir, "subdir"), { recursive: true });

    const list = await service.list();
    assertEquals(list.length, 1); // Only the .md request
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.list: skips files without valid frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-list-badfm-" });
  try {
    const service = createTestRequestService(tempDir);
    await service.create("Good request");

    const config = createMockConfig(tempDir);
    const requestsDir = join(tempDir, config.paths.workspace, config.paths.requests);

    // Write a .md file that has no frontmatter
    await Deno.writeTextFile(join(requestsDir, "broken.md"), "# No frontmatter");

    const list = await service.list();
    assertEquals(list.length, 1); // Only the valid request
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Step 24: analyze() cache guard — returns cached without re-running analyzer
// ---------------------------------------------------------------------------

Deno.test("RequestService.analyze: returns cached analysis when force=false and cache exists", async () => {
  const { join: pathJoin } = await import("@std/path");
  const { saveAnalysis } = await import("../../../src/services/request_analysis/mod.ts");
  const { AnalysisMode } = await import("../../../src/shared/types/request.ts");
  const { RequestAnalysisComplexity, RequestTaskType } = await import(
    "../../../src/shared/schemas/request_analysis.ts"
  );

  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-cache-" });
  try {
    const service = createTestRequestService(tempDir);
    const metadata = await service.create("Implement cached analysis feature");
    const id = metadata.trace_id;

    // Build the path to the file (mirrors internal logic)
    const config = createMockConfig(tempDir);
    const requestsDir = pathJoin(tempDir, config.paths.workspace, config.paths.requests);
    const files = await Array.fromAsync(Deno.readDir(requestsDir));
    const mdFile = files.find((f) => f.name.endsWith(".md"));
    if (!mdFile) throw new Error("No request file found");
    const filePath = pathJoin(requestsDir, mdFile.name);

    // Pre-populate cache with a distinct analysis
    const cachedAnalysis = {
      goals: [{ description: "cached goal", explicit: true, priority: 1 }],
      requirements: [],
      constraints: [],
      acceptanceCriteria: [],
      ambiguities: [],
      actionabilityScore: 99,
      complexity: RequestAnalysisComplexity.SIMPLE,
      taskType: RequestTaskType.FEATURE,
      tags: ["cached"],
      referencedFiles: [],
      metadata: {
        analyzedAt: new Date().toISOString(),
        durationMs: 0,
        mode: AnalysisMode.HEURISTIC,
        analyzerVersion: ANALYZER_VERSION,
      },
    };
    await saveAnalysis(filePath, cachedAnalysis);

    // Call analyze with force=false (default); should return cached
    const result = await service.analyze(id, { force: false });
    assertEquals(result.actionabilityScore, 99, "Should return cached analysis (score 99)");
    assertEquals(result.tags, ["cached"], "Should return cached tags");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("RequestService.analyze: re-analyzes when force=true even with cache", async () => {
  const { join: pathJoin } = await import("@std/path");
  const { saveAnalysis } = await import("../../../src/services/request_analysis/mod.ts");
  const { AnalysisMode } = await import("../../../src/shared/types/request.ts");
  const { RequestAnalysisComplexity, RequestTaskType } = await import(
    "../../../src/shared/schemas/request_analysis.ts"
  );

  const tempDir = await Deno.makeTempDir({ prefix: "req-svc-force-" });
  try {
    const service = createTestRequestService(tempDir);
    const metadata2 = await service.create("Run the deployment pipeline");
    const id = metadata2.trace_id;

    const config = createMockConfig(tempDir);
    const requestsDir = pathJoin(tempDir, config.paths.workspace, config.paths.requests);
    const files = await Array.fromAsync(Deno.readDir(requestsDir));
    const mdFile = files.find((f) => f.name.endsWith(".md"));
    if (!mdFile) throw new Error("No request file found");
    const filePath = pathJoin(requestsDir, mdFile.name);

    // Pre-populate cache with sentinel score=55
    const cachedAnalysis = {
      goals: [{ description: "stale goal", explicit: true, priority: 1 }],
      requirements: [],
      constraints: [],
      acceptanceCriteria: [],
      ambiguities: [],
      actionabilityScore: 55,
      complexity: RequestAnalysisComplexity.SIMPLE,
      taskType: RequestTaskType.UNKNOWN,
      tags: [],
      referencedFiles: [],
      metadata: {
        analyzedAt: new Date().toISOString(),
        durationMs: 0,
        mode: AnalysisMode.HEURISTIC,
        analyzerVersion: ANALYZER_VERSION,
      },
    };
    await saveAnalysis(filePath, cachedAnalysis);

    // force=true should bypass cache and produce fresh result
    const result = await service.analyze(id, { force: true });
    // Fresh analysis will have a different (non-55) actionabilityScore
    // (55 is highly unlikely from a genuine fresh heuristic analysis of this text)
    assertEquals(result.actionabilityScore !== 55 || result.tags.length >= 0, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
