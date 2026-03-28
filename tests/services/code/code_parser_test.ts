/**
 * @module CodeParserTest
 * @path tests/code_parser_test.ts
 * @description Verifies the specialized code parsing logic, ensuring that source code
 * symbols and structure are correctly extracted for agent context grounding.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { FileOperation } from "../../../src/shared/enums.ts";

import {
  countOperations,
  extractFilePaths,
  type IFileChange,
  parseCodeGeneration,
  validateFilePath,
} from "../../../src/services/code_parser.ts";

Deno.test("Code Parser - parseCodeGeneration()", async (t) => {
  const portalRoot = "/home/user/projects/MyApp";

  await t.step("should parse single file creation", () => {
    const llmResponse = `
## File Changes

### src/auth.ts (create)
\`\`\`typescript
export function authenticate(token: string): boolean {
  return token === "valid-token";
}
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 1);
    assertEquals(result.invalidPaths.length, 0);
    assertEquals(result.errors.length, 0);

    const change = result.changes[0];
    assertEquals(change.path, "src/auth.ts");
    assertEquals(change.operation, "create");
    assertExists(change.content);
    assertStringIncludes(change.content, "authenticate");
  });

  await t.step("should parse multiple file changes", () => {
    const llmResponse = `
### src/auth.ts (create)
\`\`\`typescript
export function auth() {}
\`\`\`

### src/config.ts (modify)
\`\`\`typescript
export const config = { auth: true };
\`\`\`

### src/old.ts (delete)
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 3);
    assertEquals(result.changes[0].operation, "create");
    assertEquals(result.changes[1].operation, "modify");
    assertEquals(result.changes[2].operation, FileOperation.DELETE);
  });

  await t.step("should handle delete operations without code blocks", () => {
    const llmResponse = `
### src/old_file.ts (delete)

This file is no longer needed.
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 1);
    assertEquals(result.changes[0].operation, FileOperation.DELETE);
    assertEquals(result.changes[0].content, undefined);
  });

  await t.step("should reject absolute paths", () => {
    const llmResponse = `
### /etc/passwd (modify)
\`\`\`
malicious content
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 0);
    assertEquals(result.invalidPaths.length, 1);
    assertEquals(result.invalidPaths[0], "/etc/passwd");
    assertStringIncludes(result.errors[0], "Absolute paths not allowed");
  });

  await t.step("should reject directory traversal", () => {
    const llmResponse = `
### ../../../etc/passwd (modify)
\`\`\`
malicious content
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 0);
    assertEquals(result.invalidPaths.length, 1);
    assertStringIncludes(result.errors[0], "Directory traversal not allowed");
  });

  await t.step("should detect duplicate file paths", () => {
    const llmResponse = `
### src/auth.ts (create)
\`\`\`typescript
export function auth1() {}
\`\`\`

### src/auth.ts (modify)
\`\`\`typescript
export function auth2() {}
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    // First occurrence should be parsed
    assertEquals(result.changes.length, 1);
    // Second occurrence should be flagged as error
    assertStringIncludes(result.errors[0], "Duplicate file path");
  });

  await t.step("should handle empty LLM response", () => {
    const llmResponse = "";

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 0);
    assertEquals(result.invalidPaths.length, 0);
    assertEquals(result.errors.length, 0);
  });

  await t.step("should handle response with no file changes", () => {
    const llmResponse = `
# Analysis

I've analyzed the request but determined no code changes are needed.
The existing implementation already handles this case.
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 0);
    assertEquals(result.errors.length, 0);
  });

  await t.step("should preserve code indentation", () => {
    const llmResponse = `
### src/example.ts (create)
\`\`\`typescript
export class Example {
  method() {
    return "test";
  }
}
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 1);
    assertStringIncludes(result.changes[0].content!, "  method()");
    assertStringIncludes(result.changes[0].content!, '    return "test"');
  });

  await t.step("should handle code blocks without language specifier", () => {
    const llmResponse = `
### config.json (create)
\`\`\`
{
  "version": "1.0.0"
}
\`\`\`
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 1);
    assertStringIncludes(result.changes[0].content!, '"version": "1.0.0"');
  });

  await t.step("should report missing code block for create operation", () => {
    const llmResponse = `
### src/auth.ts (create)

This file needs to be created but no code block was provided.
`;

    const result = parseCodeGeneration(llmResponse, portalRoot);

    assertEquals(result.changes.length, 0);
    assertStringIncludes(result.errors[0], "No code block found");
  });
});

Deno.test("Code Parser - validateFilePath()", async (t) => {
  const portalRoot = "/home/user/projects/MyApp";

  await t.step("should accept valid relative paths", () => {
    const validPaths = [
      "src/auth.ts",
      "tests/auth_test.ts",
      "lib/utils/helper.ts",
      "config.json",
    ];

    for (const path of validPaths) {
      const result = validateFilePath(path, portalRoot);
      assertEquals(result.valid, true, `Path should be valid: ${path}`);
      assertEquals(result.error, undefined);
    }
  });

  await t.step("should reject absolute paths", () => {
    const invalidPaths = [
      "/etc/passwd",
      "/home/other/file.ts",
      "/var/log/app.log",
    ];

    for (const path of invalidPaths) {
      const result = validateFilePath(path, portalRoot);
      assertEquals(result.valid, false, `Path should be invalid: ${path}`);
      assertStringIncludes(result.error!, "Absolute paths not allowed");
    }
  });

  await t.step("should reject directory traversal", () => {
    const invalidPaths = [
      "../etc/passwd",
      "../../sensitive.txt",
      "src/../../config.yml",
    ];

    for (const path of invalidPaths) {
      const result = validateFilePath(path, portalRoot);
      assertEquals(result.valid, false, `Path should be invalid: ${path}`);
      assertStringIncludes(result.error!, "Directory traversal not allowed");
    }
  });

  await t.step("should reject paths that escape portal root", () => {
    const result = validateFilePath("../../../etc/passwd", portalRoot);

    assertEquals(result.valid, false);
    // Should be caught by directory traversal check
    assertExists(result.error);
  });
});

Deno.test("Code Parser - extractFilePaths()", async (t) => {
  await t.step("should extract file paths from parse result", () => {
    const changes: IFileChange[] = [
      { path: "src/auth.ts", operation: FileOperation.CREATE, content: "..." },
      { path: "tests/auth_test.ts", operation: FileOperation.CREATE, content: "..." },
      { path: "src/old.ts", operation: FileOperation.DELETE },
    ];

    const paths = extractFilePaths({ changes, invalidPaths: [], errors: [] });

    assertEquals(paths.length, 3);
    assertEquals(paths[0], "src/auth.ts");
    assertEquals(paths[1], "tests/auth_test.ts");
    assertEquals(paths[2], "src/old.ts");
  });

  await t.step("should return empty array for no changes", () => {
    const paths = extractFilePaths({ changes: [], invalidPaths: [], errors: [] });

    assertEquals(paths.length, 0);
  });
});

Deno.test("Code Parser - countOperations()", async (t) => {
  await t.step("should count file operations", () => {
    const changes: IFileChange[] = [
      { path: "src/a.ts", operation: FileOperation.CREATE, content: "..." },
      { path: "src/b.ts", operation: FileOperation.CREATE, content: "..." },
      { path: "src/c.ts", operation: FileOperation.MODIFY, content: "..." },
      { path: "src/d.ts", operation: FileOperation.DELETE },
    ];

    const counts = countOperations(changes);

    assertEquals(counts.create, 2);
    assertEquals(counts.modify, 1);
    assertEquals(counts.delete, 1);
  });

  await t.step("should return zero counts for empty array", () => {
    const counts = countOperations([]);

    assertEquals(counts.create, 0);
    assertEquals(counts.modify, 0);
    assertEquals(counts.delete, 0);
  });
});
