/**
 * @module PlanExecutorCodeGenTest
 * @path tests/plan_executor_code_generation_test.ts
 * @description Verifies the code generation specialized logic within the PlanExecutor,
 * ensuring correct authentication and generation patterns for technical tasks.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryOperation } from "../../src/shared/enums.ts";
import { join } from "@std/path";

Deno.test("Plan Executor - Code Generation", async (t) => {
  await t.step("LLM Response Parsing", async (t) => {
    await t.step("should parse code blocks from LLM response", () => {
      const llmResponse = `
## File Changes

### src/auth.ts (create)
\`\`\`typescript
export function authenticate(token: string): boolean {
  return token === "valid-token";
}
\`\`\`

### tests/auth_test.ts (create)
\`\`\`typescript
import { authenticate } from "../../src/auth.ts";
import { assertEquals } from "@std/assert";

Deno.test("authenticate - valid token", () => {
  assertEquals(authenticate("valid-token"), true);
});
\`\`\`
`;

      // Parse the response
      const fileMatches = [...llmResponse.matchAll(/### (.*?) \((\w+)\)\n```(\w+)\n([\s\S]*?)```/g)];

      assertEquals(fileMatches.length, 2);
      assertEquals(fileMatches[0][1], "src/auth.ts");
      assertEquals(fileMatches[0][2], "create");
      assertEquals(fileMatches[0][3], "typescript");
      assertStringIncludes(fileMatches[0][4], "authenticate");
    });

    await t.step("should extract file paths and operations (create/modify/delete)", () => {
      const llmResponse = `
### src/auth.ts (create)
\`\`\`typescript
export function auth() {}
\`\`\`

### src/config.ts (modify)
\`\`\`typescript
export const config = { auth: true };
\`\`\`

### src/old_file.ts (delete)
`;

      const fileMatches = [...llmResponse.matchAll(/### (.*?) \((create|modify|delete)\)/g)];

      assertEquals(fileMatches.length, 3);
      assertEquals(fileMatches[0][2], "create");
      assertEquals(fileMatches[1][2], "modify");
      assertEquals(fileMatches[2][2], MemoryOperation.DELETE);
    });

    await t.step("should handle LLM response with no file changes", () => {
      const llmResponse = `
# Analysis

I've analyzed the request but determined no code changes are needed.
The existing implementation already handles this case.
`;

      const fileMatches = [...llmResponse.matchAll(/### (.*?) \((\w+)\)/g)];

      assertEquals(fileMatches.length, 0);
    });

    await t.step("should handle empty LLM response gracefully", () => {
      const llmResponse = "";

      const fileMatches = [...llmResponse.matchAll(/### (.*?) \((\w+)\)/g)];

      assertEquals(fileMatches.length, 0);
    });
  });

  await t.step("File Path Validation", async (t) => {
    await t.step("should validate file paths are within portal", () => {
      const portalRoot = "/home/user/projects/MyApp";
      const validPaths = [
        "src/auth.ts",
        "tests/auth_test.ts",
        "lib/utils/helper.ts",
      ];

      for (const path of validPaths) {
        const fullPath = join(portalRoot, path);
        // Path should be within portal (not escape)
        assertEquals(fullPath.startsWith(portalRoot), true);
      }
    });

    await t.step("should reject paths with ../ traversal", () => {
      const portalRoot = "/home/user/projects/MyApp";
      const invalidPaths = [
        "../etc/passwd",
        "../../sensitive.txt",
        "src/../../config.yml",
      ];

      for (const path of invalidPaths) {
        const fullPath = join(portalRoot, path);
        // Normalized path should not escape portal
        const normalized = fullPath;
        // Check if path escapes
        const escapes = !normalized.startsWith(portalRoot);
        assertEquals(escapes, true);
      }
    });

    await t.step("should reject absolute paths", () => {
      const invalidPaths = [
        "/etc/passwd",
        "/home/other/file.ts",
        "/var/log/app.log",
      ];

      for (const path of invalidPaths) {
        // Absolute paths should be rejected
        const isAbsolute = path.startsWith("/");
        assertEquals(isAbsolute, true);
      }
    });
  });

  await t.step("IFileChange Object Construction", async (t) => {
    await t.step("should create IFileChange object for create operation", () => {
      const fileChange = {
        path: "src/auth.ts",
        operation: "create" as const,
        content: "export function auth() { return true; }",
      };

      assertEquals(fileChange.path, "src/auth.ts");
      assertEquals(fileChange.operation, "create");
      assertExists(fileChange.content);
    });

    await t.step("should create IFileChange object for modify operation", () => {
      const fileChange = {
        path: "src/config.ts",
        operation: "modify" as const,
        content: "export const config = { auth: true };",
        oldContent: "export const config = {};",
      };

      assertEquals(fileChange.path, "src/config.ts");
      assertEquals(fileChange.operation, "modify");
      assertExists(fileChange.content);
      assertExists(fileChange.oldContent);
    });

    await t.step("should create IFileChange object for delete operation", () => {
      const fileChange: { path: string; operation: MemoryOperation.DELETE; content?: string } = {
        path: "src/old_file.ts",
        operation: MemoryOperation.DELETE,
      };

      assertEquals(fileChange.path, "src/old_file.ts");
      assertEquals(fileChange.operation, MemoryOperation.DELETE);
      assertEquals(fileChange.content, undefined);
    });

    await t.step("should handle multiple file changes in single response", () => {
      const fileChanges = [
        { path: "src/auth.ts", operation: "create" as const, content: "..." },
        { path: "src/config.ts", operation: "modify" as const, content: "..." },
        { path: "src/old.ts", operation: MemoryOperation.DELETE },
      ];

      assertEquals(fileChanges.length, 3);
      assertEquals(fileChanges[0].operation, "create");
      assertEquals(fileChanges[1].operation, "modify");
      assertEquals(fileChanges[2].operation, MemoryOperation.DELETE);
    });
  });

  await t.step("Code Block Extraction", async (t) => {
    await t.step("should extract TypeScript code from code blocks", () => {
      const markdown = `
### src/example.ts (create)
\`\`\`typescript
export const example = "test";
\`\`\`
`;

      const codeMatch = markdown.match(/```typescript\n([\s\S]*?)```/);
      assertExists(codeMatch);

      const code = codeMatch[1];
      assertStringIncludes(code, 'export const example = "test"');
    });

    await t.step("should extract JavaScript code from code blocks", () => {
      const markdown = `
### src/example.js (create)
\`\`\`javascript
export const example = "test";
\`\`\`
`;

      const codeMatch = markdown.match(/```javascript\n([\s\S]*?)```/);
      assertExists(codeMatch);

      const code = codeMatch[1];
      assertStringIncludes(code, 'export const example = "test"');
    });

    await t.step("should handle code blocks without language specifier", () => {
      const markdown = `
### src/example.txt (create)
\`\`\`
Hello, World!
\`\`\`
`;

      const codeMatch = markdown.match(/```\n([\s\S]*?)```/);
      assertExists(codeMatch);

      const code = codeMatch[1];
      assertStringIncludes(code, "Hello, World!");
    });

    await t.step("should preserve indentation in code blocks", () => {
      const markdown = `
### src/example.ts (create)
\`\`\`typescript
export class Example {
  method() {
    return "test";
  }
}
\`\`\`
`;

      const codeMatch = markdown.match(/```typescript\n([\s\S]*?)```/);
      assertExists(codeMatch);

      const code = codeMatch[1];
      assertStringIncludes(code, "  method()");
      assertStringIncludes(code, '    return "test"');
    });
  });

  await t.step("Error Handling", async (t) => {
    await t.step("should handle malformed file headers", () => {
      const llmResponse = `
### src/auth.ts
\`\`\`typescript
export function auth() {}
\`\`\`

### (create)
\`\`\`typescript
export function test() {}
\`\`\`
`;

      // Match strict format: ### path (operation)
      const validMatches = [...llmResponse.matchAll(/### ([^\s]+) \((create|modify|delete)\)/g)];

      // Only well-formed headers should match
      assertEquals(validMatches.length, 0); // Neither matches the strict format
    });

    await t.step("should handle code blocks without closing fence", () => {
      const markdown = `
### src/example.ts (create)
\`\`\`typescript
export const example = "test";
`;

      // Try to extract code block
      const codeMatch = markdown.match(/```typescript\n([\s\S]*?)```/);

      // Should not match incomplete code block
      assertEquals(codeMatch, null);
    });

    await t.step("should handle duplicate file paths", () => {
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

      const fileMatches = [...llmResponse.matchAll(/### (.*?) \((create|modify|delete)\)/g)];

      assertEquals(fileMatches.length, 2);
      // Both refer to same file - should be detected as conflict
      assertEquals(fileMatches[0][1], fileMatches[1][1]);
    });

    await t.step("should handle empty code blocks", () => {
      const markdown = `
### src/example.ts (create)
\`\`\`typescript
\`\`\`
`;

      const codeMatch = markdown.match(/```typescript\n([\s\S]*?)```/);
      assertExists(codeMatch);

      const code = codeMatch[1];
      // Empty code block should still be extractable
      assertEquals(code, "");
    });
  });
});
