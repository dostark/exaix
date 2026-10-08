/**
 * @module OverlayTomlFormatTest
 * @path apps/exactl/tests/overlay_toml_format_test.ts
 * @description Verifies that exactl accepts a TOML per-run overlay for request creation and flow binding preview.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, apps/exactl/src/commands/flow_commands.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { FlowCommands } from "../src/commands/flow_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TOML_OVERLAY = 'schema = 1\n\n[bindings."flow:research/step:compose"]\nservice = "alpha"\n';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("[cli] exactl request --overlay accepts a TOML overlay and stores the parsed overlay", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const overlayPath = join(tempDir, "overlay.toml");
    await Deno.writeTextFile(overlayPath, TOML_OVERLAY);

    await new RequestCommands(context).create("run the flow", { flow: "research", overlays: [overlayPath] });

    const dir = join(tempDir, ".exa", "run-bindings");
    const [file] = [...Deno.readDirSync(dir)];
    const runFile = JSON.parse(await Deno.readTextFile(join(dir, file.name)));
    assertEquals(runFile.overlays.length, 1);
    assertEquals(runFile.overlays[0].source_path, overlayPath);
    assertEquals(runFile.overlays[0].sha256, await sha256(TOML_OVERLAY));
    assertEquals(runFile.overlays[0].overlay, {
      schema: 1,
      bindings: { "flow:research/step:compose": { service: "alpha" } },
    });
  } finally {
    await cleanup();
  }
});

Deno.test("[cli] exactl request --overlay refuses malformed TOML with overlay_invalid", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const overlayPath = join(tempDir, "bad.toml");
    await Deno.writeTextFile(overlayPath, "schema = = 1");
    await assertRejects(
      () => new RequestCommands(context).create("run", { flow: "research", overlays: [overlayPath] }),
      Error,
      "overlay_invalid",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[cli] exactl flow bindings --overlay accepts a TOML overlay", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext();
  try {
    const cfg = context.config.getAll();
    const flowDir = join(cfg.system.root, cfg.paths.flows);
    await Deno.mkdir(flowDir, { recursive: true });
    await Deno.writeTextFile(
      join(flowDir, "research.flow.yaml"),
      'id: "research"\nname: "Research"\ndescription: "d"\nsteps:\n  - id: "compose"\n    name: "Compose"\n    agent_role: "composer"\noutput: { from: "compose", format: "markdown" }\n',
    );
    cfg.catalog = {
      models: { "acme/code-model": { model_provider: "acme" } },
      services: {
        alpha: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          endpoint: "https://alpha.example.com/v1",
          serves: { "*": "{name}" },
        },
      },
    };
    const overlayPath = join(tempDir, "overlay.toml");
    await Deno.writeTextFile(overlayPath, TOML_OVERLAY);
    let output = "";
    const original = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      // The preview exits 1 for an unresolvable binding, but the parsed run layer is still printed.
      await new FlowCommands(context).bindingsFlow("research", { overlay: [overlayPath], json: true }).catch(() => {});
    } finally {
      console.log = original;
      Deno.exitCode = 0;
    }
    assertStringIncludes(output, '"layer": "run"');
    assertStringIncludes(output, '"service": "alpha"');
  } finally {
    await cleanup();
  }
});
