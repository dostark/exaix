// deno-lint-ignore-file no-explicit-any
/**
 * @module MCPToolsTest
 * @path packages-team/mcp-server/tests/tools_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Validates the exposure of internal Exaix tools via the MCP protocol, ensuring
 * correct parameter mapping, IActivity Journal logging, and robust error propagation to clients.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { DomainEventType } from "@exaix/core/events";

import { join } from "@std/path";
import {
  assertMCPContentIncludes,
  assertMCPError,
  assertMCPSuccess,
  assertMCPToolError,
  createMCPRequest,
  createToolCallRequest,
  type IMCPTestContext,
  initMCPTest,
  initMCPTestWithoutPortal,
} from "@exaix/mcp/testing";

interface IMCPResponseShape<TResult = any> {
  error?: { code: number; message: string };
  result?: TResult;
}

/** Tests read_file: success, portal/file existence checks, path-traversal prevention,
 * and activity-journal logging. */

// Helper for MCP Tool tests
async function withMCPToolTest(
  options: {
    createFiles?: boolean;
    fileContent?: Record<string, string>;
    skipPortal?: boolean;
  } = {},
  fn: (ctx: Pick<IMCPTestContext, "server" | "db" | "portalPath" | "tempDir">) => Promise<void>,
) {
  const ctx = options.skipPortal
    ? await initMCPTestWithoutPortal()
    : await initMCPTest({ createFiles: options.createFiles, fileContent: options.fileContent });

  try {
    await fn({
      server: ctx.server,
      db: ctx.db,
      portalPath: (ctx as IMCPTestContext).portalPath ?? "",
      tempDir: ctx.tempDir,
    });
  } finally {
    await ctx.cleanup();
  }
}

// read_file Tool Tests

Deno.test("read_file: successfully reads file from portal", async () => {
  await withMCPToolTest(
    {
      createFiles: true,
      fileContent: { "test.txt": "Hello from portal!" },
    },
    async ({ server }) => {
      const request = createToolCallRequest(McpToolName.READ_FILE, {
        portal: "TestPortal",
        path: "test.txt",
      });

      const response = await server.handleRequest(request);
      const result = assertMCPSuccess<{ content: Array<{ type: string; text: string }> }>(
        response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      );

      assertEquals(result.content.length, 1);
      assertEquals(result.content[0].type, "text");
      assertEquals(result.content[0].text, "Hello from portal!");
    },
  );
});

Deno.test("read_file: logs invocation to IActivity Journal", async () => {
  await withMCPToolTest(
    {
      fileContent: { "log-test.txt": "content" },
    },
    async ({ server, db }) => {
      const request = createToolCallRequest(McpToolName.READ_FILE, {
        portal: "TestPortal",
        path: "log-test.txt",
      });

      const response = await server.handleRequest(request);
      const result = assertMCPSuccess<{ content: Array<{ type: string; text: string }> }>(
        response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      );
      assertEquals(result.content[0]?.text, "content");

      // Allow time for batched logging
      await new Promise((resolve) => setTimeout(resolve, 150));

      // The handler's own journal row is the one carrying the portal in its payload (a
      // second, SDK-dispatch wrapper row for the same tool/action also exists).
      const logs = db.instance.prepare(
        "SELECT * FROM activity WHERE action_type = ? AND target = ? AND payload LIKE ?",
      ).all(DomainEventType.McpToolExecuted, McpToolName.READ_FILE, '%"portal":"TestPortal"%');

      assertEquals(logs.length, 1);
      const log = logs[0] as { target: string; payload: string };
      assertEquals(log.target, McpToolName.READ_FILE);
      const payload = JSON.parse(log.payload);
      assertEquals(payload.path, "log-test.txt");
      assertEquals(payload.success, true);
      assertEquals(payload.portal, "TestPortal");
    },
  );
});

Deno.test("read_file: rejects non-existent portal", async () => {
  await withMCPToolTest({ skipPortal: true }, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.READ_FILE, {
      portal: "NonExistentPortal",
      path: "test.txt",
    });

    const response = await server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "not found");
  });
});

Deno.test("read_file: rejects non-existent file", async () => {
  await withMCPToolTest({}, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.READ_FILE, {
      portal: "TestPortal",
      path: "nonexistent.txt",
    });

    const response = await server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "not found");
  });
});

Deno.test("read_file: prevents path traversal attack", async () => {
  await withMCPToolTest({}, async ({ server, tempDir }) => {
    // Create a file outside portal that attacker wants to read
    await Deno.writeTextFile(join(tempDir, "secret.txt"), "SECRET DATA");

    const request = createToolCallRequest(McpToolName.READ_FILE, {
      portal: "TestPortal",
      path: "../secret.txt",
    });

    const response = await server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "traversal");
  });
});

Deno.test("read_file: read_file appears in tools/list", async () => {
  await withMCPToolTest({ skipPortal: true }, async ({ server }) => {
    const request = createMCPRequest("tools/list", {});
    const response = await server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as { tools: Array<{ name: string; description: string }> };
    assertEquals(result.tools.length, Object.values(McpToolName).length);
    const toolNames = result.tools.map((t) => t.name);
    assert(toolNames.includes(McpToolName.READ_FILE));
    assert(toolNames.includes(McpToolName.WRITE_FILE));
    assert(toolNames.includes(McpToolName.LIST_DIRECTORY));
    assert(toolNames.includes(McpToolName.GIT_CREATE_BRANCH));
    assert(toolNames.includes(McpToolName.GIT_COMMIT));
    assert(toolNames.includes(McpToolName.GIT_STATUS));
    assert(toolNames.includes(McpToolName.CREATE_REQUEST));
    assert(toolNames.includes(McpToolName.LIST_PLANS));
    assert(toolNames.includes(McpToolName.APPROVE_PLAN));
    assert(toolNames.includes(McpToolName.QUERY_JOURNAL));
    const readTool = result.tools.find((t) => t.name === McpToolName.READ_FILE)!;
    assertStringIncludes(readTool.description, "Return");
  });
});

Deno.test("read_file: rejects invalid arguments schema", async () => {
  await withMCPToolTest({ skipPortal: true }, async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: McpToolName.READ_FILE,
        arguments: {
          // Missing 'path' field
          portal: "TestPortal",
        },
      },
    });

    assertMCPError(response, -32602); // Invalid params
  });
});

// write_file Tool Tests

Deno.test("write_file: successfully writes file to portal", async () => {
  await withMCPToolTest({}, async ({ server, portalPath }) => {
    const request = createToolCallRequest(McpToolName.WRITE_FILE, {
      portal: "TestPortal",
      path: "output.txt",
      content: "Hello from write_file!",
    });

    const response = await server.handleRequest(request);
    assertMCPSuccess(response);
    assertMCPContentIncludes(
      response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      "successfully",
    );

    // Verify file was actually written
    const written = await Deno.readTextFile(join(portalPath, "output.txt"));
    assertEquals(written, "Hello from write_file!");
  });
});

Deno.test("write_file: creates parent directories if needed", async () => {
  await withMCPToolTest({}, async ({ server, portalPath }) => {
    const request = createToolCallRequest(McpToolName.WRITE_FILE, {
      portal: "TestPortal",
      path: "deeply/nested/file.txt",
      content: "Nested content",
    });

    await server.handleRequest(request);

    // Verify file and directories were created
    const written = await Deno.readTextFile(join(portalPath, "deeply/nested/file.txt"));
    assertEquals(written, "Nested content");
  });
});

Deno.test("write_file: overwrites existing file", async () => {
  await withMCPToolTest(
    {
      fileContent: { "existing.txt": "Old content" },
    },
    async ({ server, portalPath }) => {
      const request = createToolCallRequest(McpToolName.WRITE_FILE, {
        portal: "TestPortal",
        path: "existing.txt",
        content: "New content",
      });

      await server.handleRequest(request);

      // Verify file was overwritten
      const written = await Deno.readTextFile(join(portalPath, "existing.txt"));
      assertEquals(written, "New content");
    },
  );
});

Deno.test("write_file: rejects non-existent portal", async () => {
  await withMCPToolTest({ skipPortal: true }, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.WRITE_FILE, {
      portal: "NonExistent",
      path: "test.txt",
      content: "content",
    });

    const response = await server.handleRequest(request);
    assertMCPError(response, -32602, "Resource not found");
  });
});

Deno.test("write_file: prevents path traversal", async () => {
  await withMCPToolTest({}, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.WRITE_FILE, {
      portal: "TestPortal",
      path: "../escape.txt",
      content: "malicious",
    });

    const response = await server.handleRequest(request);
    assertMCPError(response, -32602, "Access denied: Invalid path");
  });
});

Deno.test("write_file: logs invocation to IActivity Journal", async () => {
  await withMCPToolTest({}, async ({ server, db }) => {
    const request = createToolCallRequest(McpToolName.WRITE_FILE, {
      portal: "TestPortal",
      path: "logged.txt",
      content: "content",
    });

    await server.handleRequest(request);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The handler's own journal row is the one carrying the portal in its payload (a
    // second, SDK-dispatch wrapper row for the same tool/action also exists).
    const logs = db.instance.prepare(
      "SELECT * FROM activity WHERE action_type = ? AND target = ? AND payload LIKE ?",
    ).all(DomainEventType.McpToolExecuted, McpToolName.WRITE_FILE, '%"portal":"TestPortal"%');

    assertEquals(logs.length, 1);
    const log = logs[0] as { target: string; payload: string };
    assertEquals(log.target, McpToolName.WRITE_FILE);
    const payload = JSON.parse(log.payload);
    assertEquals(payload.path, "logged.txt");
    assertEquals(payload.success, true);
    assertEquals(payload.portal, "TestPortal");
  });
});

// list_directory Tool Tests

Deno.test("list_directory: lists files in portal root", async () => {
  await withMCPToolTest(
    {
      fileContent: {
        "file1.txt": "content1",
        "file2.txt": "content2",
        "subdir/placeholder.txt": "", // Creates subdir
      },
    },
    async ({ server }) => {
      const request = createToolCallRequest(McpToolName.LIST_DIRECTORY, {
        portal: "TestPortal",
      });

      const response = await server.handleRequest(request);
      assertMCPSuccess(response);

      const result = response.result as { content: Array<{ type: string; text: string }> };
      const listing = result.content[0].text;
      assertStringIncludes(listing, "file1.txt");
      assertStringIncludes(listing, "file2.txt");
      assertStringIncludes(listing, "subdir/");
    },
  );
});

Deno.test("list_directory: lists files in subdirectory", async () => {
  await withMCPToolTest(
    {
      fileContent: {
        "subdir/nested.txt": "nested",
      },
    },
    async ({ server }) => {
      const request = createToolCallRequest(McpToolName.LIST_DIRECTORY, {
        portal: "TestPortal",
        path: "subdir",
      });

      const response = await server.handleRequest(request);
      assertMCPSuccess(response);

      const result = response.result as { content: Array<{ type: string; text: string }> };
      assertStringIncludes(result.content[0].text, "nested.txt");
    },
  );
});

Deno.test("list_directory: handles empty directory", async () => {
  await withMCPToolTest({}, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.LIST_DIRECTORY, {
      portal: "TestPortal",
    });

    const response = await server.handleRequest(request);
    assertMCPSuccess(response);

    const result = response.result as { content: Array<{ type: string; text: string }> };
    assertStringIncludes(result.content[0].text, "empty");
  });
});

Deno.test("list_directory: rejects non-existent portal", async () => {
  await withMCPToolTest({ skipPortal: true }, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.LIST_DIRECTORY, {
      portal: "NonExistent",
    });

    const response = await server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "not found");
  });
});

Deno.test("list_directory: prevents path traversal", async () => {
  await withMCPToolTest({}, async ({ server }) => {
    const request = createToolCallRequest(McpToolName.LIST_DIRECTORY, {
      portal: "TestPortal",
      path: "../",
    });

    const response = await server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "traversal");
  });
});
