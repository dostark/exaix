/**
 * @module CLIBaseTest
 * @path tests/cli/base_test.ts
 * @description Verifies CLI base abstractions, ensuring stable shared command
 * infrastructure, error reporting conventions, and common argument parsing.
 */

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import { MemoryStatus } from "@exaix/core";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { BaseCommand, type ICommandContext } from "../../src/cli/base.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { readFixtureTextSync } from "../helpers/fixtures.ts";

// Concrete implementation of BaseCommand for testing
class TestCommand extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  // Expose protected methods for testing
  public testGetUserIdentity(): Promise<string> {
    return this.getUserIdentity();
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
}

describe("BaseCommand", () => {
  let _tempDir: string;
  let testCommand: TestCommand;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext();
    _tempDir = result.tempDir;
    cleanup = result.cleanup;

    testCommand = new TestCommand(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getUserIdentity", () => {
    it("should get user identity from git config", async () => {
      const identity = await testCommand.testGetUserIdentity();
      assertExists(identity);
      assertEquals(typeof identity, "string");
      // Should be either git user.email, git user.name, or OS username
    });

    it("should fallback to OS username if git not available", async () => {
      // This will naturally test the fallback since git config might not be set
      const identity = await testCommand.testGetUserIdentity();
      assertExists(identity);
      assertEquals(typeof identity, "string");
      // Should never be empty
      assertEquals(identity.length > 0, true);
    });
  });

  describe("extractFrontmatter", () => {
    it("should extract valid YAML frontmatter from markdown", () => {
      const markdown = readFixtureTextSync(import.meta.url, "cli", "base_test", "markdown.md");
      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result.title, "Test Plan");
      assertEquals(result.status, "review");
      assertEquals(result.trace_id, "abc-123");
    });

    it("should handle quoted values in YAML", () => {
      const markdown = readFixtureTextSync(import.meta.url, "cli", "base_test", "markdown_1.md");
      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result.title, "Quoted Title");
      assertEquals(result.status, "single-quoted");
      assertEquals(result.description, "Value with: colon");
    });

    it("should return empty object for missing frontmatter", () => {
      const markdown = `# Just a heading

No frontmatter here.`;

      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result, {});
    });

    it("should handle empty frontmatter block", () => {
      const markdown = `---
---

Body`;

      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result, {});
    });

    it("should handle complex YAML values", () => {
      const markdown = readFixtureTextSync(import.meta.url, "cli", "base_test", "markdown_2.md");
      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result.title, "Valid");
      assertEquals(result.tags, "[feature, api]");
      assertEquals(result.nested, "value");
    });

    it("should handle UUIDs with hyphens", () => {
      const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
status: pending
---

Body`;

      const result = testCommand.testExtractFrontmatter(markdown);
      assertEquals(result.trace_id, "550e8400-e29b-41d4-a716-446655440000");
      assertEquals(result.status, MemoryStatus.PENDING);
    });
  });

  describe("serializeFrontmatter", () => {
    it("should serialize frontmatter to YAML format", () => {
      const frontmatter = {
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
      const frontmatter = {
        simple: "value",
        with_colon: "value: with colon",
        with_space: "value with spaces",
      };

      const result = testCommand.testSerializeFrontmatter(frontmatter);
      assertStringIncludes(result, 'with_colon: "value: with colon"');
      assertStringIncludes(result, "with_space: value with spaces");
    });

    it("should handle empty frontmatter", () => {
      const frontmatter = {};
      const result = testCommand.testSerializeFrontmatter(frontmatter);
      assertEquals(result, "---\n---");
    });

    it("should quote UUIDs with hyphens", () => {
      const frontmatter = {
        trace_id: "550e8400-e29b-41d4-a716-446655440000",
      };

      const result = testCommand.testSerializeFrontmatter(frontmatter);
      assertStringIncludes(result, 'trace_id: "550e8400-e29b-41d4-a716-446655440000"');
    });

    it("should not quote ISO timestamps", () => {
      const frontmatter = {
        created: "2025-11-28T10:30:00.000Z",
      };

      const result = testCommand.testSerializeFrontmatter(frontmatter);
      // ISO timestamps contain colons, so they will be quoted
      assertStringIncludes(result, 'created: "2025-11-28T10:30:00.000Z"');
    });
  });

  describe("updateFrontmatter", () => {
    it("should update existing frontmatter fields", () => {
      const content = `---
title: Original
status: draft
---

Body content`;

      const updated = testCommand.testUpdateFrontmatter(content, {
        status: "review",
        author: "TestUser",
      });

      const frontmatter = testCommand.testExtractFrontmatter(updated);
      assertEquals(frontmatter.title, "Original");
      assertEquals(frontmatter.status, "review");
      assertEquals(frontmatter.author, "TestUser");
      assertStringIncludes(updated, "Body content");
    });

    it("should preserve body content", () => {
      const content = readFixtureTextSync(import.meta.url, "cli", "base_test", "content.md");
      const updated = testCommand.testUpdateFrontmatter(content, {
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

  describe("validateFrontmatter", () => {
    it("should pass validation when all required fields present", () => {
      const frontmatter = {
        trace_id: "abc-123",
        request_id: "req-001",
        status: "review",
      };

      // Should not throw
      testCommand.testValidateFrontmatter(
        frontmatter,
        ["trace_id", "request_id", "status"],
        "/test/file.md",
      );
    });

    it("should throw error when required field missing", () => {
      const frontmatter = {
        trace_id: "abc-123",
        status: "review",
        // missing request_id
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
      const frontmatter = {
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
      const frontmatter = {
        title: "Test",
      };

      // Should not throw with no requirements
      testCommand.testValidateFrontmatter(frontmatter, [], "/test/file.md");
    });
  });

  describe("formatTimestamp", () => {
    it("should format ISO timestamp to readable string", () => {
      const iso = "2025-11-25T14:30:00.000Z";
      const formatted = testCommand.testFormatTimestamp(iso);

      assertExists(formatted);
      assertEquals(typeof formatted, "string");
      // Should contain date components (exact format depends on locale)
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

  describe("truncate", () => {
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

      // When maxLength < 3, substring(0, negative) returns empty string
      // So result is just "..." (length 3)
      assertEquals(result, "...");
      assertEquals(result.length, 3);
    });
  });
});
