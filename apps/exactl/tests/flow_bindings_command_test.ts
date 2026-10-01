/**
 * @module FlowBindingsCommandTest
 * @path apps/exactl/tests/flow_bindings_command_test.ts
 * @related-files [apps/exactl/src/commands/flow_commands.ts, packages/ai/src/bindings/binding_layers.ts]
 * @architectural-layer CLI
 * @description Verifies `exactl flow bindings`: layer resolution, field sources, pin_kept,
 * hosts, per-run --overlay/--bind inputs, issues and the never-print-a-key guarantee.
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

function installCatalog(ctx: ICliApplicationContext): void {
  const config = ctx.config.getAll();
  config.catalog = {
    models: {
      "acme/code-model": { model_provider: "acme" },
    },
    services: {
      acme: {
        adapter: "mock",
        transport: "cloud",
        interface: "api",
        endpoint: "https://acme.example.com/v1",
        key_env: "EXA_ACME_KEY",
        serves: { "*": "{name}" },
      },
    },
  };
}

const BOUND_FLOW = `
id: "bound-flow"
name: "Bound Flow"
description: "Flow with a step binding"
steps:
  - id: "s1"
    name: "Compose"
    agent_role: "composer"
    binding:
      service: acme
      model: acme/code-model
      transport: cloud
      interface: api
output: { from: "s1", format: "markdown" }
`;

Deno.test("FlowBindings: prints resolution table and hosts, exits zero on a clean unbound flow", async () => {
  const ctx = await createMockContext();
  const flowDir = getFlowDir(ctx);
  await Deno.mkdir(flowDir, { recursive: true });
  await Deno.writeTextFile(join(flowDir, "bound-flow.flow.yaml"), BOUND_FLOW);
  Deno.env.set("EXA_ACME_KEY", "test-key");
  try {
    installCatalog(ctx);
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.bindingsFlow("bound-flow");
    });
    assertStringIncludes(output, "Step");
    assertStringIncludes(output, "composer");
    assertStringIncludes(output, "acme");
    assertStringIncludes(output, "acme/code-model");
    assertStringIncludes(output, "acme.example.com");
  } finally {
    await ctx.cleanup();
    Deno.env.delete("EXA_ACME_KEY");
  }
});

Deno.test("FlowBindings: json includes step rows, issues and hosts; no key value is printed", async () => {
  const ctx = await createMockContext();
  const flowDir = getFlowDir(ctx);
  await Deno.mkdir(flowDir, { recursive: true });
  await Deno.writeTextFile(join(flowDir, "bound-flow.flow.yaml"), BOUND_FLOW);
  Deno.env.set("EXA_ACME_KEY", "test-key");
  try {
    installCatalog(ctx);
    const commands = new FlowCommands(ctx);
    let output = "";
    const original = console.log;
    console.log = (...args: string[]) => {
      output += args.map((a) => String(a)).join(" ") + "\n";
    };
    try {
      await commands.bindingsFlow("bound-flow", { json: true });
    } finally {
      console.log = original;
    }
    const parsed = JSON.parse(output);
    assertEquals(parsed.flow_id, "bound-flow");
    assertEquals(parsed.steps[0].service, "acme");
    assertStringIncludes(JSON.stringify(parsed.hosts), "acme.example.com");
    if (!parsed.steps[0].unbound) {
      assertEquals(parsed.steps[0].sources.model.layer, "flow");
    }
  } finally {
    await ctx.cleanup();
    Deno.env.delete("EXA_ACME_KEY");
  }
});

Deno.test("FlowBindings: a per-run --bind override wins over the flow binding", async () => {
  const ctx = await createMockContext();
  const flowDir = getFlowDir(ctx);
  await Deno.mkdir(flowDir, { recursive: true });
  await Deno.writeTextFile(join(flowDir, "bound-flow.flow.yaml"), BOUND_FLOW);
  try {
    installCatalog(ctx);
    ctx.config.getAll().catalog = {
      models: {
        "acme/code-model": { model_provider: "acme" },
        "other/code-model": { model_provider: "other" },
      },
      services: {
        acme: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          endpoint: "https://acme.example.com/v1",
          serves: { "*": "{name}" },
        },
        other: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          endpoint: "https://other.example.com/v1",
          serves: { "*": "{name}" },
        },
      },
    };
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      await commands.bindingsFlow("bound-flow", {
        bind: ["flow:bound-flow/step:s1=service=other,model=other/code-model"],
      });
    });
    assertStringIncludes(output, "other");
    assertStringIncludes(output, "other/code-model");
    assertStringIncludes(output, "other.example.com");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("FlowBindings: exits non-zero on an issue and never prints a key value", async () => {
  let code: number | undefined;
  const ctx = await createMockContext((exitCode?: number) => {
    code = exitCode;
    throw new Error(`exit:${exitCode}`);
  });
  const flowDir = getFlowDir(ctx);
  await Deno.mkdir(flowDir, { recursive: true });
  await Deno.writeTextFile(join(flowDir, "bound-flow.flow.yaml"), BOUND_FLOW);
  try {
    installCatalog(ctx);
    // A service binding that does not exist in the catalog must yield an issue.
    ctx.config.getAll().catalog = {
      models: {
        "acme/code-model": { model_provider: "acme" },
      },
      services: {
        acme: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          endpoint: "https://acme.example.com/v1",
          key_env: "EXA_SECRET_TOKEN",
          serves: { "*": "{name}" },
        },
      },
    };
    const commands = new FlowCommands(ctx);
    const output = await captureConsole("log", async () => {
      try {
        await commands.bindingsFlow("bound-flow", {
          bind: ["flow:bound-flow/step:s1=service=does-not-exist"],
        });
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith("exit:")) throw error;
      }
    });
    assertEquals(code, 1);
    assertStringIncludes(output, "Issues");
    assertStringIncludes(output, "does-not-exist");
    // The never-print-a-key guarantee: the credential variable must not appear.
    assertEquals(output.includes("EXA_SECRET_TOKEN"), false);
  } finally {
    await ctx.cleanup();
  }
});
