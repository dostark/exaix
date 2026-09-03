/**
 * @module FlowCommandsTest
 * @path apps/exactl/tests/flow_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI commands for multi-agent workflow management, ensuring
 * stable listing and introspection of complex flow definitions.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowCommands } from "../src/commands/flow_commands.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import { join } from "@std/path";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { createMockProvider } from "@exaix/testing";

async function createMockContext(
  exit?: (code?: number) => never,
): Promise<ICliApplicationContext & { exit?: (code?: number) => never; cleanup: () => Promise<void> }> {
  const { context, cleanup } = await createCliTestContext();
  return {
    ...context,
    provider: createMockProvider([]),
    exit,
    cleanup,
  };
}

function getFlowDir(ctx: ICliApplicationContext) {
  const cfg = ctx.config.getAll();
  return join(cfg.system.root, cfg.paths.flows);
}

async function withFlowsDir(
  ctx: ICliApplicationContext & { cleanup: () => Promise<void> },
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

async function captureConsole(kind: "log" | "error", fn: () => Promise<void>) {
  let output = "";
  const original = console[kind];
  console[kind] = (...args: string[]) => {
    output += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    await fn();
  } finally {
    console[kind] = original;
  }
  return output;
}

Deno.test("FlowCommands: listFlows returns empty when no flows", async () => {
  const ctx = await createMockContext();
  await withFlowsDir(ctx, async (_flowDir) => {
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.listFlows();
    });
    assertStringIncludes(output, "No flows found");
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
      await commands.listFlows();
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
      await commands.listFlows({ json: true });
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
      await commands.validateFlow("valid-cli-flow");
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
      await commands.validateFlow("fallback-flow");
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
      await commands.showFlow("show-flow", { json: true });
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
      await commands.showFlow("show-flow-2", { json: true });
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
      await commands.showFlow("full-flow");
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

    let errOut = "";
    const origErr = console.error;
    console.error = (...args: string[]) => {
      errOut += args.join(" ") + "\n";
    };

    ctx.exit = (_c?: number) => {
      throw new Error("DENO_EXIT");
    };

    try {
      let threw = false;
      try {
        await commands.listFlows();
      } catch (_e) {
        threw = true;
        if (!errOut.includes("Error listing flows: boom")) {
          throw new Error(`Expected error log not found. got: ${errOut}`);
        }
      }
      if (!threw) throw new Error("Expected Deno.exit to be called");
      Deno.readDir = originalReadDir;
    } finally {
      console.error = origErr;
      ctx.exit = undefined;
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
      await commands.validateFlow("valid-for-json", { json: true });
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

    let errOut = "";
    const origErr = console.error;
    console.error = (...args: string[]) => {
      errOut += args.join(" ") + "\n";
    };

    ctx.exit = (_c?: number) => {
      throw new Error("DENO_EXIT");
    };

    try {
      let threw = false;
      try {
        await commands.validateFlow("bad");
      } catch (_e) {
        threw = true;
      }
      assertEquals(threw, true);
      assertStringIncludes(out, "uh-oh");
    } finally {
      console.log = origLog;
      console.error = origErr;
      Deno.readTextFile = origReadText;
      ctx.exit = undefined;
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
    ctx.exit = (_c?: number) => {
      throw new Error("EXIT");
    };
    try {
      let caught = false;
      try {
        await commands.validateFlow("bad");
      } catch (e) {
        caught = true;
        assertStringIncludes((e as Error).message, "EXIT");
      }
      assertEquals(caught, true);
    } finally {
      //
    }
  });
});
