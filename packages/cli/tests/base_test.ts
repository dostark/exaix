// deno-lint-ignore-file no-explicit-any
/**
 * @module CLIBaseTest
 * @path packages/cli/tests/base_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies pure BaseCommand utilities (frontmatter, timestamps, truncation,
 * user identity) without requiring runtime context (no daemon, no filesystem, no database).
 */

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { MemoryStatus } from "@exaix/core/status";
import { describe, it } from "@std/testing/bdd";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { createStubCliContext, createStubGitService } from "@exaix/cli/testing";

/** Read a fixture file from packages/cli/tests/fixtures/base_test/ */
function readFixture(name: string): string {
  const dir = new URL(".", import.meta.url).pathname;
  return Deno.readTextFileSync(join(dir, "fixtures", "base_test", name));
}

// Concrete implementation of BaseCommand for testing — only pure methods exposed
class TestCommand extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  public testExtractFrontmatter(content: string) {
    return this.extractFrontmatter(content);
  }

  public testSerializeFrontmatter(frontmatter: Record<string, string>): string {
    return this.serializeFrontmatter(frontmatter);
  }

  public testUpdateFrontmatter(content: string, updates: Record<string, string>): string {
    return this.updateFrontmatter(content, updates);
  }

  public testValidateFrontmatter(
    frontmatter: Record<string, string>,
    required: string[],
    filePath: string,
  ): void {
    return this.validateFrontmatter(frontmatter, required, filePath);
  }

  public testFormatTimestamp(isoString: string): string {
    return this.formatTimestamp(isoString);
  }

  public testTruncate(str: string, maxLength: number): string {
    return this.truncate(str, maxLength);
  }

  public testGetUserIdentity(): Promise<string> {
    return this.getUserIdentity();
  }
}

// Pure string methods don't need a real context — just satisfy the type
const testCommand = new TestCommand({} as any);

describe("BaseCommand (extractFrontmatter)", () => {
  it("should extract valid YAML frontmatter from markdown", () => {
    const result = testCommand.testExtractFrontmatter(readFixture("markdown.md"));
    assertEquals(result.title, "Test Plan");
    assertEquals(result.status, "review");
    assertEquals(result.trace_id as string, "abc-123");
  });

  it("should handle quoted values in YAML", () => {
    const result = testCommand.testExtractFrontmatter(readFixture("markdown_1.md"));
    assertEquals(result.title, "Quoted Title");
    assertEquals(result.status, "single-quoted");
    assertEquals(result.description, "Value with: colon");
  });

  it("should return empty object for missing frontmatter", () => {
    const content = "# Just a heading\n\nNo frontmatter here.";
    const result = testCommand.testExtractFrontmatter(content);
    assertEquals(result, {});
  });

  it("should handle empty frontmatter block", () => {
    const content = "---\n---\n\nBody";
    const result = testCommand.testExtractFrontmatter(content);
    assertEquals(result, {});
  });

  it("should handle complex YAML values", () => {
    const result = testCommand.testExtractFrontmatter(readFixture("markdown_2.md"));
    assertEquals(result.title, "Valid");
    assertEquals(result.tags as string, "[feature, api]");
    assertEquals(result.nested as string, "value");
  });

  it("should handle UUIDs with hyphens", () => {
    const content = `---\ntrace_id: "550e8400-e29b-41d4-a716-446655440000"\nstatus: pending\n---\n\nBody`;
    const result = testCommand.testExtractFrontmatter(content);
    assertEquals(result.trace_id as string, "550e8400-e29b-41d4-a716-446655440000");
    assertEquals(result.status, MemoryStatus.PENDING);
  });
});

describe("BaseCommand (serializeFrontmatter)", () => {
  it("should serialize frontmatter to YAML format", () => {
    const frontmatter: Record<string, string> = {
      title: "Test",
      status: "review",
      trace_id: "abc-123",
    };

    const result = testCommand.testSerializeFrontmatter(frontmatter);
    assertEquals(result.startsWith("---\n"), true);
    assertEquals(result.endsWith("---"), true);
    assertStringIncludes(result, "title: Test");
    assertStringIncludes(result, "status: review");
    assertStringIncludes(result, "trace_id: abc-123");
  });

  it("should quote values with special characters", () => {
    const frontmatter: Record<string, string> = {
      simple: "value",
      with_colon: "value: with colon",
      with_space: "value with spaces",
    };

    const result = testCommand.testSerializeFrontmatter(frontmatter);
    assertStringIncludes(result, 'with_colon: "value: with colon"');
    assertStringIncludes(result, "with_space: value with spaces");
  });

  it("should handle empty frontmatter", () => {
    const frontmatter: Record<string, string> = {};
    const result = testCommand.testSerializeFrontmatter(frontmatter);
    assertEquals(result, "---\n---");
  });

  it("should quote UUIDs with hyphens", () => {
    const frontmatter: Record<string, string> = {
      trace_id: "550e8400-e29b-41d4-a716-446655440000",
    };

    const result = testCommand.testSerializeFrontmatter(frontmatter);
    assertStringIncludes(result, 'trace_id: "550e8400-e29b-41d4-a716-446655440000"');
  });

  it("should not quote ISO timestamps", () => {
    const frontmatter: Record<string, string> = {
      created: "2025-11-28T10:30:00.000Z",
    };

    const result = testCommand.testSerializeFrontmatter(frontmatter);
    assertStringIncludes(result, 'created: "2025-11-28T10:30:00.000Z"');
  });
});

describe("BaseCommand (updateFrontmatter)", () => {
  it("should update existing frontmatter fields", () => {
    const content = "---\ntitle: Original\nstatus: draft\n---\n\nBody content";

    const updated = testCommand.testUpdateFrontmatter(content, {
      status: "review",
      author: "TestUser",
    });

    const frontmatter = testCommand.testExtractFrontmatter(updated);
    assertEquals(frontmatter.title, "Original");
    assertEquals(frontmatter.status, "review");
    assertEquals(frontmatter.author as string, "TestUser");
    assertStringIncludes(updated, "Body content");
  });

  it("should preserve body content", () => {
    const updated = testCommand.testUpdateFrontmatter(readFixture("content.md"), {
      status: MemoryStatus.APPROVED,
    });

    assertStringIncludes(updated, "# Heading");
    assertStringIncludes(updated, "Paragraph 1");
    assertStringIncludes(updated, "Paragraph 2");
  });

  it("should handle content without frontmatter", () => {
    const content = "# Just content\n\nNo frontmatter.";
    const updated = testCommand.testUpdateFrontmatter(content, {
      status: "new",
    });
    const frontmatter = testCommand.testExtractFrontmatter(updated);
    assertEquals(frontmatter.status, "new");
    assertStringIncludes(updated, "Just content");
  });
});

describe("BaseCommand (validateFrontmatter)", () => {
  it("should pass validation when all required fields present", () => {
    const frontmatter: Record<string, string> = {
      trace_id: "abc-123",
      request_id: "req-001",
      status: "review",
    };

    testCommand.testValidateFrontmatter(
      frontmatter,
      ["trace_id", "request_id", "status"],
      "/test/file.md",
    );
  });

  it("should throw error when required field missing", () => {
    const frontmatter: Record<string, string> = {
      trace_id: "abc-123",
      status: "review",
    };

    assertThrows(
      () => {
        testCommand.testValidateFrontmatter(
          frontmatter,
          ["trace_id", "request_id", "status"],
          "/test/file.md",
        );
      },
      Error,
      "missing required field 'request_id'",
    );
  });

  it("should include file path in error message", () => {
    const frontmatter: Record<string, string> = {
      status: "review",
    };

    assertThrows(
      () => {
        testCommand.testValidateFrontmatter(
          frontmatter,
          ["trace_id"],
          "/path/to/plan.md",
        );
      },
      Error,
      "/path/to/plan.md",
    );
  });

  it("should handle empty required fields array", () => {
    const frontmatter: Record<string, string> = {
      title: "Test",
    };

    testCommand.testValidateFrontmatter(frontmatter, [], "/test/file.md");
  });
});

describe("BaseCommand (formatTimestamp)", () => {
  it("should format ISO timestamp to readable string", () => {
    const iso = "2025-11-25T14:30:00.000Z";
    const formatted = testCommand.testFormatTimestamp(iso);

    assertExists(formatted);
    assertEquals(typeof formatted, "string");
    assertEquals(formatted.length > 0, true);
  });

  it("should handle different ISO formats", () => {
    const timestamps = [
      "2025-11-25T14:30:00Z",
      "2025-11-25T14:30:00.123Z",
      "2025-11-25T14:30:00+00:00",
    ];

    for (const ts of timestamps) {
      const formatted = testCommand.testFormatTimestamp(ts);
      assertExists(formatted);
      assertEquals(typeof formatted, "string");
    }
  });
});

describe("BaseCommand (truncate)", () => {
  it("should truncate long strings", () => {
    const str = "This is a very long string that needs truncation";
    const result = testCommand.testTruncate(str, 20);

    assertEquals(result.length, 20);
    assertEquals(result.endsWith("..."), true);
    assertEquals(result, "This is a very lo...");
  });

  it("should not truncate short strings", () => {
    const str = "Short";
    const result = testCommand.testTruncate(str, 20);

    assertEquals(result, "Short");
    assertEquals(result.length, 5);
  });

  it("should handle exact length", () => {
    const str = "Exactly20Characters!";
    const result = testCommand.testTruncate(str, 20);

    assertEquals(result, "Exactly20Characters!");
    assertEquals(result.length, 20);
  });

  it("should handle edge case with maxLength less than 3", () => {
    const str = "Test";
    const result = testCommand.testTruncate(str, 2);

    assertEquals(result, "...");
    assertEquals(result.length, 3);
  });
});

describe("BaseCommand (getUserIdentity)", () => {
  it("should get user identity from git config", async () => {
    const ctx = createStubCliContext();
    const cmd = new TestCommand(ctx);
    const identity = await cmd.testGetUserIdentity();
    assertEquals(identity, "cli-user");
  });

  it("should fallback to unknown-user when git fails", async () => {
    const ctx = createStubCliContext({
      git: createStubGitService({
        getCurrentBranch: () => Promise.reject(new Error("git not available")),
      }),
    });
    const cmd = new TestCommand(ctx);
    const identity = await cmd.testGetUserIdentity();
    assertEquals(identity, "unknown-user");
  });
});
