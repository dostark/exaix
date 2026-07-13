/**
 * @module ContextLoaderTest
 * @path packages/core/tests/context/context_loader_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the core context assembly logic, ensuring that relevant files,
 * memory, and portal data are correctly injected into the agent prompt.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { ContextLoader } from "@exaix/core/context";
import type { IContextLoadResult, IContextConfig } from "@exaix/core/context";
import type { IActivityRecord } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";

// ============================================================================
// Test Setup and Fixtures
// ============================================================================

let testDir: string;
const testFiles: string[] = [];

/**
 * Create a test file with specified content
 */
async function createTestFile(
  name: string,
  content: string,
): Promise<string> {
  const path = `${testDir}/${name}`;
  await Deno.writeTextFile(path, content);
  testFiles.push(path);
  return path;
}

/**
 * Generate content of specified token count (approximate)
 */
function generateContent(tokenCount: number): string {
  // 1 token ≈ 4 chars
  const charCount = tokenCount * 4;
  return "x".repeat(charCount);
}

beforeEach(async () => {
  // Create temporary test directory
  testDir = await Deno.makeTempDir({ prefix: "context_loader_test_" });
});

afterEach(async () => {
  // Clean up test files and directory
  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
  testFiles.length = 0;
});

// ============================================================================
// Test 1: Token Limit Enforcement
// ============================================================================

describe("Token Limit Enforcement", () => {
  it("should respect token limits with safety margin", async () => {
    // Create 10 files with 50k tokens each (500k total)
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      const file = await createTestFile(
        `file${i}.txt`,
        generateContent(50000),
      );
      files.push(file);
    }

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 0.8, // Use 80k tokens
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit(files);

    // Should only use 80% of max (80k tokens)
    assertEquals(result.totalTokens <= 80000, true);

    // Should have warnings about skipped files
    assertEquals(result.warnings.length > 0, true);

    // Should have skipped some files
    assertEquals(result.skippedFiles.length > 0, true);

    // Should not include all files
    assertEquals(result.includedFiles.length < files.length, true);
  });

  it("should include only files that fit within budget", async () => {
    // Create files: 10k, 20k, 30k, 40k, 50k tokens
    const file1 = await createTestFile("small.txt", generateContent(10000));
    const file2 = await createTestFile("medium1.txt", generateContent(20000));
    const file3 = await createTestFile("medium2.txt", generateContent(30000));
    const file4 = await createTestFile("large1.txt", generateContent(40000));
    const file5 = await createTestFile("large2.txt", generateContent(50000));

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 0.5, // Use 50k tokens
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([
      file5,
      file4,
      file3,
      file2,
      file1,
    ]);

    // With smallest-first, should load: 10k + 20k + 30k = ~60k (might exceed slightly)
    // or 10k + 20k = 30k (under budget)
    assertEquals(result.totalTokens <= 50000, true);

    // Should include smallest files
    assertEquals(result.includedFiles.includes(file1), true);
  });

  it("should track total tokens accurately", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(1000));
    const file2 = await createTestFile("file2.txt", generateContent(2000));
    const file3 = await createTestFile("file3.txt", generateContent(3000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2, file3]);

    // Should be approximately 6000 tokens (1000 + 2000 + 3000)
    // Allow some variance due to token counting approximation
    assertEquals(result.totalTokens >= 5800, true);
    assertEquals(result.totalTokens <= 6200, true);
  });
});

// ============================================================================
// Test 2: Warning Block Generation
// ============================================================================

describe("Warning Block Generation", () => {
  it("should include warning block when files are skipped", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(60000));
    const file2 = await createTestFile("file2.txt", generateContent(60000));

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Should contain warning header
    assertStringIncludes(result.content, "[System Warning: Context Truncated]");
    assertStringIncludes(result.content, "Token Budget");
    assertStringIncludes(result.content, "Files Affected");
  });

  it("should list skipped files in warnings", async () => {
    const file1 = await createTestFile("small.txt", generateContent(10000));
    const file2 = await createTestFile("huge.txt", generateContent(100000));

    const config: IContextConfig = {
      maxTokens: 50000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Should have warning about huge.txt being skipped
    assertEquals(result.warnings.length > 0, true);
    const warningText = result.warnings.join(" ");
    assertStringIncludes(warningText.toLowerCase(), "huge.txt");
    assertStringIncludes(warningText.toLowerCase(), "skipped");
  });

  it("should not include warning block when all files fit", async () => {
    const file1 = await createTestFile("tiny1.txt", generateContent(100));
    const file2 = await createTestFile("tiny2.txt", generateContent(100));

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Should have no warnings
    assertEquals(result.warnings.length, 0);

    // Should not contain warning block
    assertEquals(result.content.includes("[System Warning"), false);
  });
});

// ============================================================================
// Test 3: Agent Receives Warning and Can Reference It
// ============================================================================

describe("Agent Warning Accessibility", () => {
  it("should include warning in result that agent can parse", async () => {
    const file1 = await createTestFile("small.txt", generateContent(10000));
    const file2 = await createTestFile("huge.txt", generateContent(100000));

    const config: IContextConfig = {
      maxTokens: 50000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Agent receives structured warning data in result object
    assertExists(result.warnings);
    assertEquals(result.warnings.length > 0, true);

    // Warning content is in the main content block for agent visibility
    assertStringIncludes(result.content, "[System Warning");

    // Agent can reference the skipped file names from warnings
    const warningText = result.warnings.join(" ");
    assertStringIncludes(warningText.toLowerCase(), "huge.txt");
  });

  it("should provide actionable warning message for agent", async () => {
    const file1 = await createTestFile("a.txt", generateContent(60000));
    const file2 = await createTestFile("b.txt", generateContent(60000));

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Warning should mention token budget so agent understands the constraint
    assertStringIncludes(result.content, "Token Budget");

    // Warning should list affected files so agent knows what's missing
    assertStringIncludes(result.content, "Files Affected");
  });
});

// ============================================================================
// Test 3b: Context Content Format
// ============================================================================

describe("Context Content Format", () => {
  it("should format context with file paths as headers", async () => {
    const file1 = await createTestFile("test.txt", "Hello World");

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1]);

    assertStringIncludes(result.content, "## Context:");
    assertStringIncludes(result.content, "test.txt");
    assertStringIncludes(result.content, "Hello World");
  });

  it("should include file content in formatted output", async () => {
    const content = "This is test content\nWith multiple lines";
    const file = await createTestFile("multi.txt", content);

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    assertStringIncludes(result.content, content);
  });
});

// ============================================================================
// Test 4: Local Agent Behavior (No Limits)
// ============================================================================

describe("Local Agent Behavior", () => {
  it("should load all files for local agents", async () => {
    // Create large files that would exceed normal limits
    const files: string[] = [];
    for (let i = 0; i < 5; i++) {
      const file = await createTestFile(
        `large${i}.txt`,
        generateContent(50000),
      );
      files.push(file);
    }

    const config: IContextConfig = {
      maxTokens: 10000, // Would normally limit to 10k
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: true, // But local agent ignores limits
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit(files);

    // All files should be included
    assertEquals(result.includedFiles.length, files.length);
    assertEquals(result.skippedFiles.length, 0);
    assertEquals(result.warnings.length, 0);
  });

  it("should not generate warnings for local agents", async () => {
    const file = await createTestFile("huge.txt", generateContent(1000000));

    const config: IContextConfig = {
      maxTokens: 1000,
      safetyMargin: 0.8,
      truncationStrategy: "smallest-first",
      isLocalAgent: true,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    assertEquals(result.warnings.length, 0);
    assertEquals(result.content.includes("[System Warning"), false);
  });
});

// ============================================================================
// Test 5: Truncation Strategies
// ============================================================================

describe("Truncation Strategies", () => {
  it("smallest-first should prioritize smallest files", async () => {
    const small = await createTestFile("small.txt", generateContent(1000));
    const medium = await createTestFile("medium.txt", generateContent(5000));
    const large = await createTestFile("large.txt", generateContent(10000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // 8000 tokens
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([large, medium, small]);

    // Should include smallest files first
    assertEquals(result.includedFiles.includes(small), true);
  });

  it("drop-oldest should prioritize newest files", async () => {
    const old = await createTestFile("old.txt", generateContent(5000));
    await new Promise((resolve) => setTimeout(resolve, 100)); // Ensure time difference

    const recent = await createTestFile("recent.txt", generateContent(5000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // 8000 tokens
      truncationStrategy: "drop-oldest",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([old, recent]);

    // Should include the more recent file
    assertEquals(result.includedFiles.includes(recent), true);
  });

  it("truncate-each should include partial content from files", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(10000));
    const file2 = await createTestFile("file2.txt", generateContent(10000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // 8000 tokens
      truncationStrategy: "truncate-each",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // With truncate-each, both files should get at least some representation
    // Total should not exceed limit
    assertEquals(result.totalTokens <= 8000, true);

    // Should have truncation warnings
    assertEquals(result.truncatedFiles.length > 0, true);
  });

  it("different strategies should produce different results", async () => {
    const file1 = await createTestFile("a.txt", generateContent(3000));
    const file2 = await createTestFile("b.txt", generateContent(4000));
    const file3 = await createTestFile("c.txt", generateContent(5000));

    const baseConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8,
      isLocalAgent: false,
    };

    const strategies = [
      "smallest-first",
      "drop-largest",
      "truncate-each",
    ] as const;
    const results: IContextLoadResult[] = [];

    for (const strategy of strategies) {
      const config: IContextConfig = { ...baseConfig, truncationStrategy: strategy };
      const loader = new ContextLoader(config);
      const result = await loader.loadWithLimit([file1, file2, file3]);
      results.push(result);
    }

    // Results should differ (at least one pair should be different)
    let foundDifference = false;
    for (let i = 0; i < results.length - 1; i++) {
      if (
        results[i].includedFiles.length !== results[i + 1].includedFiles.length ||
        results[i].truncatedFiles.length !== results[i + 1].truncatedFiles.length
      ) {
        foundDifference = true;
        break;
      }
    }

    assertEquals(foundDifference, true, "Strategies should produce different results");
  });
});

// ============================================================================
// Test 6: Per-File Token Caps
// ============================================================================

describe("Per-File Token Caps", () => {
  it("should enforce per-file token caps", async () => {
    const huge = await createTestFile("huge.txt", generateContent(100000));

    const config: IContextConfig = {
      maxTokens: 150000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      perFileTokenCap: 10000, // Cap each file at 10k tokens
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([huge]);

    // File should be truncated to cap
    assertEquals(result.totalTokens <= 10000, true);
    assertEquals(result.truncatedFiles.length, 1);
    assertEquals(result.warnings.some((w) => w.includes("Per-file cap")), true);
  });

  it("should not enforce caps when not configured", async () => {
    const large = await createTestFile("large.txt", generateContent(50000));

    const config: IContextConfig = {
      maxTokens: 100000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      // No perFileTokenCap
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([large]);

    // Should include full file
    assertEquals(result.truncatedFiles.length, 0);
    assertEquals(result.totalTokens >= 45000, true); // Around 50k with variance
  });
});

// ============================================================================
// Test 7: Error Handling
// ============================================================================

describe("Error Handling", () => {
  it("should handle missing files gracefully", async () => {
    const existing = await createTestFile("exists.txt", generateContent(1000));
    const missing = `${testDir}/missing.txt`;

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([existing, missing]);

    // Should still load the existing file
    assertEquals(result.includedFiles.includes(existing), true);

    // Missing file should not cause failure
    assertEquals(result.includedFiles.includes(missing), false);
  });

  it("should continue loading when one file fails", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(1000));
    const file2 = await createTestFile("file2.txt", generateContent(1000));
    const missing = `${testDir}/nonexistent.txt`;

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, missing, file2]);

    // Should load both existing files
    assertEquals(result.includedFiles.length, 2);
    assertEquals(result.includedFiles.includes(file1), true);
    assertEquals(result.includedFiles.includes(file2), true);
  });
});

// ============================================================================
// Test 8: Result Structure
// ============================================================================

describe("Result Structure", () => {
  it("should return complete IContextLoadResult structure", async () => {
    const file = await createTestFile("test.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    // Verify all fields exist
    assertExists(result.content);
    assertExists(result.warnings);
    assertExists(result.totalTokens);
    assertExists(result.includedFiles);
    assertExists(result.skippedFiles);
    assertExists(result.truncatedFiles);

    // Verify types
    assertEquals(typeof result.content, "string");
    assertEquals(Array.isArray(result.warnings), true);
    assertEquals(typeof result.totalTokens, "number");
    assertEquals(Array.isArray(result.includedFiles), true);
    assertEquals(Array.isArray(result.skippedFiles), true);
    assertEquals(Array.isArray(result.truncatedFiles), true);
  });
});

// ============================================================================
// Test 9: Token Budget Boundary Cases
// ============================================================================

describe("Token Budget Boundary Cases", () => {
  it("should handle exact budget boundary", async () => {
    // Create a file that exactly matches the budget
    const file = await createTestFile("exact.txt", generateContent(8000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // Exactly 8000 tokens
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    // Should include the file since it fits exactly
    assertEquals(result.includedFiles.length, 1);
    assertEquals(result.skippedFiles.length, 0);
  });

  it("should skip files exceeding remaining budget by 1 token", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(7000));
    const file2 = await createTestFile("file2.txt", generateContent(1500)); // Exceeds budget

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // 8000 tokens
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // file1 should fit (smaller file loaded first with smallest-first)
    assertEquals(result.includedFiles.length >= 1, true);

    // Total should not exceed budget
    assertEquals(result.totalTokens <= 8000, true);
  });

  it("should skip files when remaining budget is insufficient (< 100 tokens)", async () => {
    const file1 = await createTestFile("file1.txt", generateContent(7950));
    const file2 = await createTestFile("file2.txt", generateContent(200));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.8, // 8000 tokens
      truncationStrategy: "truncate-each",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // file1 fits, file2 can't fit meaningfully (remaining < 100)
    assertEquals(result.includedFiles.includes(file1), true);

    // With truncate-each, file2 should be skipped if remaining < 100
    if (result.totalTokens > 7900) {
      assertEquals(result.skippedFiles.includes(file2), true);
    }
  });

  it("should handle zero budget (safety margin = 0)", async () => {
    const file = await createTestFile("file.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0, // Zero budget
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    // With zero budget, nothing should be included
    assertEquals(result.includedFiles.length, 0);
    assertEquals(result.skippedFiles.length, 1);
  });

  it("should prioritize files when budget allows only some", async () => {
    // Create files with different sizes
    const small1 = await createTestFile("small1.txt", generateContent(1000));
    const small2 = await createTestFile("small2.txt", generateContent(1500));
    const medium = await createTestFile("medium.txt", generateContent(3000));
    const large = await createTestFile("large.txt", generateContent(5000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 0.6, // 6000 tokens budget
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([large, medium, small2, small1]);

    // Should prioritize smallest files: small1 (1000) + small2 (1500) + medium (3000) = ~5500
    assertEquals(result.includedFiles.includes(small1), true);
    assertEquals(result.includedFiles.includes(small2), true);

    // Large should be skipped
    assertEquals(result.skippedFiles.includes(large), true);
  });
});

// ============================================================================
// Test 10: File System Error Handling
// ============================================================================

describe("File System Error Handling", () => {
  it("should handle permission denied errors gracefully", async () => {
    const readable = await createTestFile("readable.txt", generateContent(1000));
    const restricted = await createTestFile("restricted.txt", generateContent(1000));

    // Remove read permissions
    await Deno.chmod(restricted, 0o000);

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    try {
      const loader = new ContextLoader(config);
      const result = await loader.loadWithLimit([readable, restricted]);

      // Should load readable file
      assertEquals(result.includedFiles.includes(readable), true);

      // Restricted file should be excluded (not in included or skipped)
      assertEquals(result.includedFiles.includes(restricted), false);
    } finally {
      // Restore permissions for cleanup
      try {
        await Deno.chmod(restricted, 0o644);
      } catch {
        // Ignore if already cleaned up
      }
    }
  });

  it("should handle symbolic links correctly", async () => {
    const original = await createTestFile("original.txt", generateContent(1000));
    const symlinkPath = `${testDir}/symlink.txt`;

    // Create symlink
    await Deno.symlink(original, symlinkPath);
    testFiles.push(symlinkPath);

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([symlinkPath]);

    // Should follow symlink and load content
    assertEquals(result.includedFiles.length, 1);
    assertEquals(result.totalTokens > 900, true); // ~1000 tokens
  });

  it("should handle broken symbolic links", async () => {
    const brokenLink = `${testDir}/broken-link.txt`;
    const nonExistent = `${testDir}/does-not-exist.txt`;

    // Create broken symlink
    await Deno.symlink(nonExistent, brokenLink);
    testFiles.push(brokenLink);

    const validFile = await createTestFile("valid.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([brokenLink, validFile]);

    // Should skip broken link, load valid file
    assertEquals(result.includedFiles.includes(validFile), true);
    assertEquals(result.includedFiles.includes(brokenLink), false);
  });

  it("should handle empty files (zero tokens)", async () => {
    const empty = await createTestFile("empty.txt", "");
    const withContent = await createTestFile("content.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([empty, withContent]);

    // Empty file should be filtered out (zero tokens)
    assertEquals(result.includedFiles.includes(empty), false);

    // File with content should be included
    assertEquals(result.includedFiles.includes(withContent), true);
  });

  it("should handle files modified during loading", async () => {
    const file = await createTestFile("modified.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);

    // Start loading
    const resultPromise = loader.loadWithLimit([file]);

    // Modify file during load (though this is a race condition)
    await Deno.writeTextFile(file, generateContent(2000));

    const result = await resultPromise;

    // Should complete without error (may have either version)
    assertEquals(result.includedFiles.length <= 1, true);
  });
});

// ============================================================================
// Test 11: Edge Cases and Special Content
// ============================================================================

describe("Edge Cases and Special Content", () => {
  it("should handle very long file paths", async () => {
    const longName = "a".repeat(200) + ".txt";
    const file = await createTestFile(longName, generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    assertEquals(result.includedFiles.length, 1);
    assertStringIncludes(result.content, longName);
  });

  it("should handle unicode in file content", async () => {
    const unicodeContent = "Hello 世界 🌍 مرحبا Здравствуй";
    const file = await createTestFile("unicode.txt", unicodeContent);

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    assertStringIncludes(result.content, unicodeContent);
  });

  it("should handle special characters in file paths", async () => {
    const specialFile = await createTestFile("file with spaces & special!.txt", generateContent(1000));

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([specialFile]);

    assertEquals(result.includedFiles.length, 1);
  });

  it("should handle mixed line endings (CRLF, LF)", async () => {
    const mixedContent = "Line 1\nLine 2\r\nLine 3\rLine 4";
    const file = await createTestFile("mixed.txt", mixedContent);

    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "smallest-first",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file]);

    assertStringIncludes(result.content, mixedContent);
  });
});

// ============================================================================
// Test 12: Drop-Largest Strategy
// ============================================================================

describe("Drop-Largest Strategy", () => {
  it("should sort files smallest first with drop-largest", async () => {
    const small = await createTestFile("small.txt", generateContent(1000));
    const medium = await createTestFile("medium.txt", generateContent(3000));
    const large = await createTestFile("large.txt", generateContent(5000));

    const config: IContextConfig = {
      maxTokens: 6000,
      safetyMargin: 1.0,
      truncationStrategy: "drop-largest",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([large, medium, small]);

    // drop-largest sorts smallest first, so small (1000) + medium (3000) = 4000 should fit
    assertEquals(result.includedFiles.includes(small), true);
    // Large file should be skipped (dropped)
    assertEquals(result.skippedFiles.includes(large), true);
  });

  it("should drop largest files when budget exceeded", async () => {
    const file1 = await createTestFile("f1.txt", generateContent(2000));
    const file2 = await createTestFile("f2.txt", generateContent(4000));
    const file3 = await createTestFile("f3.txt", generateContent(6000));

    const config: IContextConfig = {
      maxTokens: 8000,
      safetyMargin: 1.0,
      truncationStrategy: "drop-largest",
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file3, file2, file1]);

    // Should include smaller files: 2000 + 4000 = 6000 tokens
    assertEquals(result.includedFiles.includes(file1), true);
    assertEquals(result.includedFiles.includes(file2), true);
    // Largest should be skipped
    assertEquals(result.skippedFiles.includes(file3), true);
  });
});

// ============================================================================
// Test 13: IActivity Logging with Database
// ============================================================================

describe("IActivity Logging with Database", () => {
  it("should log context loading to database when configured", async () => {
    const { db, cleanup } = await initTestDbService();

    try {
      const file = await createTestFile("logged.txt", generateContent(1000));

      const config: IContextConfig = {
        maxTokens: 10000,
        safetyMargin: 1.0,
        truncationStrategy: "smallest-first",
        isLocalAgent: false,
        db: db,
        logger: new EventLogger({ db }),
        traceId: "test-context-trace",
        requestId: "test-request",
        identityId: "test-agent",
      };

      const loader = new ContextLoader(config);
      await loader.loadWithLimit([file]);

      // Wait for batched logs
      await new Promise((resolve) => setTimeout(resolve, 150));

      const logs = db.getActivitiesByTrace("test-context-trace");
      const contextLog = logs.find((l: IActivityRecord) => l.action_type === "context.loaded");
      assertExists(contextLog, "context.loaded should be logged");

      const payload = JSON.parse(contextLog.payload);
      assertEquals(payload.included_files_count, 1);
      assertEquals(payload.strategy, "smallest-first");
    } finally {
      await cleanup();
    }
  });

  it("should log file load errors to database when configured", async () => {
    const { db, cleanup } = await initTestDbService();

    try {
      const missing = `${testDir}/nonexistent-for-logging.txt`;

      const config: IContextConfig = {
        maxTokens: 10000,
        safetyMargin: 1.0,
        truncationStrategy: "smallest-first",
        isLocalAgent: false,
        db: db,
        logger: new EventLogger({ db }),
        traceId: "test-error-trace",
        requestId: "test-request",
        identityId: "test-agent",
      };

      const loader = new ContextLoader(config);
      await loader.loadWithLimit([missing]);

      // Wait for batched logs
      await new Promise((resolve) => setTimeout(resolve, 150));

      const logs = db.getActivitiesByTrace("test-error-trace");
      const errorLog = logs.find((l: IActivityRecord) => l.action_type === "context.file_load_error");
      assertExists(errorLog, "context.file_load_error should be logged");

      const payload = JSON.parse(errorLog.payload);
      assertEquals(payload.error_type, "NotFound");
    } finally {
      await cleanup();
    }
  });

  it("should skip logging when no traceId provided", async () => {
    const { db, cleanup } = await initTestDbService();

    try {
      const file = await createTestFile("nolog.txt", generateContent(100));

      const config: IContextConfig = {
        maxTokens: 10000,
        safetyMargin: 1.0,
        truncationStrategy: "smallest-first",
        isLocalAgent: false,
        db: db,
        // No traceId - logging should be skipped
      };

      const loader = new ContextLoader(config);
      await loader.loadWithLimit([file]);

      // Wait for potential logs
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not have logged anything (no traceId)
      const allLogs = await db.getRecentActivity(100);
      const contextLogs = allLogs.filter((l: IActivityRecord) => l.action_type === "context.loaded");
      assertEquals(contextLogs.length, 0, "Should not log without traceId");
    } finally {
      await cleanup();
    }
  });
});

// ============================================================================
// Test 14: Default Strategy (fallback)
// ============================================================================

describe("Default Strategy Fallback", () => {
  it("should handle unknown strategy by returning files in original order", async () => {
    const file1 = await createTestFile("first.txt", generateContent(1000));
    const file2 = await createTestFile("second.txt", generateContent(1000));

    // Force an unknown strategy by casting
    const config: IContextConfig = {
      maxTokens: 10000,
      safetyMargin: 1.0,
      truncationStrategy: "unknown-strategy" as IContextConfig["truncationStrategy"],
      isLocalAgent: false,
    };

    const loader = new ContextLoader(config);
    const result = await loader.loadWithLimit([file1, file2]);

    // Should still work, returning files
    assertEquals(result.includedFiles.length, 2);
  });
});
