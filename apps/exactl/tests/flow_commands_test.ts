/**
 * @module FlowCommandsTest
 * @path apps/exactl/tests/flow_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI commands for multi-agent workflow management, ensuring
 * stable listing and introspection of complex flow definitions.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { FlowCommands } from "../src/commands/flow_commands.ts";
import { join } from "@std/path";
import { captureConsole, createMockContext, type FlowTestContext, getFlowDir } from "./helpers/flow_test_context.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { createConsoleRenderer } from "./helpers/captured_output.ts";

async function withFlowsDir(
  ctx: FlowTestContext,
  fn: (flowDir: string) => Promise<void>,
) {
  const flowDir = getFlowDir(ctx);
  await Deno.mkdir(flowDir, { recursive: true });
  try {
    await fn(flowDir);
  } finally {
    await ctx.cleanup();
  }
}

Deno.test("FlowCommands: listFlows returns no rows when no flows", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (_flowDir) => {
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.listFlows(createConsoleRenderer(ExaCtlOutputFormat.JSON));
    });
    assertEquals(JSON.parse(output), []);
  });
});

Deno.test("FlowCommands: listFlows outputs table for valid flows", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const validFlow = `
id: "cli-flow"
name: "CLI Flow"
description: "Flow for CLI test"
steps: [{ id: "s1", name: "Step 1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/cli-flow.flow.yaml`, validFlow);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.listFlows(createConsoleRenderer());
    });
    assertStringIncludes(output, "CLI Flow");
    assertStringIncludes(output, "Flow for CLI test");
  });
});

Deno.test("FlowCommands: listFlows outputs JSON when requested", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const flowModule = `
id: "json-flow"
name: "JSON IFlow as Flow"
description: "IFlow as Flow for JSON test"
steps: [{ id: "s1", name: "Step 1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/json-flow.flow.yaml`, flowModule);

    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.listFlows(createConsoleRenderer(ExaCtlOutputFormat.JSON));
    });

    assertStringIncludes(output, '"id": "json-flow"');
  });
});

Deno.test({ name: "FlowCommands: validateFlow returns valid for correct flow", sanitizeExit: false }, async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const validFlow = `
id: "valid-cli-flow"
name: "Valid CLI IFlow as Flow"
description: "Valid flow for CLI test"
steps: [{ id: "s1", name: "Step 1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/valid-cli-flow.flow.yaml`, validFlow);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.validateFlow("valid-cli-flow", createConsoleRenderer());
    });
    assertStringIncludes(output, "is valid");
  });
});

Deno.test({ name: "FlowCommands: validateFlowWithoutService fallback works", sanitizeExit: false }, async () => {
  const ctx = await createMockContext();
  ctx.flowValidator = undefined;
  await withFlowsDir(ctx, async (flowDir) => {
    const validFlow = `
id: "fallback-flow"
name: "Fallback Flow"
description: "Test fallback validation"
steps: [{ id: "s1", name: "Step 1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(join(flowDir, "fallback-flow.flow.yaml"), validFlow);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.validateFlow("fallback-flow", createConsoleRenderer());
    });
    assertStringIncludes(output, "is valid");
  });
});

Deno.test("FlowCommands: showFlow outputs JSON when requested (id check)", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const flowDef = `
id: "show-flow"
name: "Show IFlow as Flow"
description: "IFlow as Flow to test show"
steps: [{ id: "s1", name: "Step 1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/show-flow.flow.yaml`, flowDef);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.showFlow("show-flow", createConsoleRenderer(ExaCtlOutputFormat.JSON));
    });
    const parsed = JSON.parse(output.trim());
    assertEquals(parsed.id, "show-flow");
  });
});

Deno.test("FlowCommands: showFlow prints JSON when requested (id & name)", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const flowModule = `
id: "show-flow-2"
name: "Show Flow 2"
description: "Flow for show test"
steps: [{ id: "s1", name: "Step 1", agent_role: "agentA", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/show-flow-2.flow.yaml`, flowModule);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.showFlow("show-flow-2", createConsoleRenderer(ExaCtlOutputFormat.JSON));
    });
    assertStringIncludes(output, '"id": "show-flow-2"');
    assertStringIncludes(output, '"name": "Show Flow 2"');
  });
});

Deno.test({ name: "FlowCommands: showFlow renders full view (non-JSON)", sanitizeExit: false }, async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const flowModule = `
id: "full-flow"
name: "Full IFlow as Flow"
description: "IFlow as Flow for full render test"
steps:
  - id: "a"
    name: "Step A"
    agent_role: "agentA"
    input: { source: "request", transform: "passthrough" }
  - id: "b"
    name: "Step B"
    agent_role: "agentB"
    dependsOn: ["a"]
    input: { source: "request", transform: "passthrough" }
settings: { maxParallelism: 2, failFast: true }
output: { from: "b", format: "markdown" }
`;
    await Deno.writeTextFile(`${flowDir}/full-flow.flow.yaml`, flowModule);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.showFlow("full-flow", createConsoleRenderer());
    });
    assertStringIncludes(output, "Dependency Graph:");
    assertStringIncludes(output, "Settings:");
    assertStringIncludes(output, "agentA");
    assertStringIncludes(output, "agentB");
  });
});

Deno.test({ name: "FlowCommands: listFlows handles loader errors and exits", sanitizeExit: false }, async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (_flowDir) => {
    const commands = new FlowCommands(ctx);
    const originalReadDir = Deno.readDir;
    Deno.readDir = function (..._args: Parameters<typeof Deno.readDir>): AsyncIterable<Deno.DirEntry> {
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error("boom"));
            },
          };
        },
      };
    };

    try {
      const failure = await assertRejects(
        () => commands.listFlows(createConsoleRenderer()),
        ExaCtlError,
        "Error listing flows: boom",
      );
      assertEquals(failure.code, ExaCtlExitCode.FAILURE);
    } finally {
      Deno.readDir = originalReadDir;
    }
  });
});

Deno.test("FlowCommands: validateFlow outputs JSON when requested and handles validator errors", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const validFlow = `
id: "valid-for-json"
name: "JSON IFlow as Flow"
description: "Valid flow"
steps: [{ id: "s1", name: "S1", agent_role: "agent1", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(join(flowDir, "valid-for-json.flow.yaml"), validFlow);

    const commands = new FlowCommands(ctx);
    let out = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      out += msg + "\n";
    };
    try {
      await commands.validateFlow("valid-for-json", createConsoleRenderer(ExaCtlOutputFormat.JSON));
    } finally {
      console.log = origLog;
    }
    if (!out.includes('"valid": true')) throw new Error("Expected JSON output with valid:true");
  });
});

Deno.test("FlowCommands: validateFlow throws on validator error", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    await Deno.writeTextFile(join(flowDir, "bad.flow.yaml"), "");
    const commands = new FlowCommands(ctx);

    const origReadText = Deno.readTextFile;
    Deno.readTextFile = (..._args: Parameters<typeof Deno.readTextFile>) => {
      return Promise.reject(new Error("uh-oh"));
    };

    let out = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      out += msg + "\n";
    };

    try {
      const failure = await assertRejects(() => commands.validateFlow("bad", createConsoleRenderer()), ExaCtlError);
      assertEquals(failure.code, ExaCtlExitCode.INVALID);
      assertStringIncludes(out, "uh-oh");
    } finally {
      console.log = origLog;
      Deno.readTextFile = origReadText;
    }
  });
});

Deno.test("FlowCommands: validateFlow prints invalid and exits", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (flowDir) => {
    const invalidFlow = `
id: "bad"
name: "Bad IFlow as Flow"
description: "Invalid flow"
steps: [{ id: "s1", name: "bad", agent_role: "", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;
    await Deno.writeTextFile(join(flowDir, "bad.flow.yaml"), invalidFlow);

    const commands = new FlowCommands(ctx);
    const failure = await assertRejects(() => commands.validateFlow("bad", createConsoleRenderer()), ExaCtlError);
    assertEquals(failure.code, ExaCtlExitCode.INVALID);
  });
});
