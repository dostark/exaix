/**
 * @module FlowBindingsOverlayValidationTest
 * @path apps/exactl/tests/flow_bindings_overlay_validation_test.ts
 * @description Verifies that `exactl flow bindings --overlay` applies the same file checks as `exactl request --overlay`.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/flow_commands.ts, packages/ai/src/bindings/overlay_file.ts]
 */
import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BINDING_OVERLAY_MAX_BYTES } from "@exaix/core";
import { FlowCommands } from "../src/commands/flow_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const OVERLAY = JSON.stringify({ schema: 1, bindings: { "flow:research/step:compose": { service: "alpha" } } });

async function previewErrors(overlayPath: (dir: string) => Promise<string>): Promise<string> {
  const { tempDir, context, cleanup } = await createCliTestContext();
  const original = console.error;
  let errors = "";
  console.error = (...args: string[]) => {
    errors += args.join(" ") + "\n";
  };
  try {
    const cfg = context.config.getAll();
    const flowDir = join(cfg.system.root, cfg.paths.flows);
    await Deno.mkdir(flowDir, { recursive: true });
    await Deno.writeTextFile(
      join(flowDir, "research.flow.yaml"),
      'id: "research"\nname: "Research"\ndescription: "d"\nsteps:\n  - id: "compose"\n    name: "Compose"\n    agent_role: "composer"\noutput: { from: "compose", format: "markdown" }\n',
    );
    const path = await overlayPath(tempDir);
    await new FlowCommands(context).bindingsFlow("research", { overlay: [path], json: true }).catch(() => {});
    return errors;
  } finally {
    console.error = original;
    Deno.exitCode = 0;
    await cleanup();
  }
}

Deno.test("[security] exactl flow bindings --overlay refuses a symlink with overlay_invalid", async () => {
  const errors = await previewErrors(async (dir) => {
    const real = join(dir, "real-overlay.json");
    await Deno.writeTextFile(real, OVERLAY);
    const link = join(dir, "link-overlay.json");
    await Deno.symlink(real, link);
    return link;
  });
  assertStringIncludes(errors, "overlay_invalid");
});

Deno.test("[security] exactl flow bindings --overlay refuses an oversize file with overlay_invalid", async () => {
  const errors = await previewErrors(async (dir) => {
    const big = join(dir, "big-overlay.json");
    await Deno.writeTextFile(big, " ".repeat(BINDING_OVERLAY_MAX_BYTES + 1) + OVERLAY);
    return big;
  });
  assertStringIncludes(errors, "overlay_invalid");
});

Deno.test("[cli] exactl flow bindings --overlay still accepts a regular overlay file", async () => {
  const errors = await previewErrors(async (dir) => {
    const ok = join(dir, "ok-overlay.json");
    await Deno.writeTextFile(ok, OVERLAY);
    return ok;
  });
  assert(!errors.includes("overlay_invalid"), errors);
});
