/**
 * @module RequestCreateOverlayValidationTest
 * @path apps/exactl/tests/request_create_overlay_validation_test.ts
 * @description Phase 203 Step 1 — `exactl request --overlay` clears the same file checks the
 *   daemon applies to operator overlays: a regular file, no symlink, and at most
 *   BINDING_OVERLAY_MAX_BYTES. Without these checks a request-time overlay path was read with
 *   no validation at all, so an agent-writable tree could redirect a run.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, packages/ai/src/bindings/binding_layers.ts]
 */

import { BINDING_OVERLAY_MAX_BYTES } from "@exaix/core";
import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

/** A minimal valid overlay document, so only the file-level check can fail. */
const VALID_OVERLAY = JSON.stringify({
  schema: 1,
  bindings: { "flow:research/step:compose": { service: "alpha" } },
});

Deno.test("[security] exactl request --overlay refuses a symlink with overlay_invalid", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const realPath = join(tempDir, "real-overlay.json");
    await Deno.writeTextFile(realPath, VALID_OVERLAY);
    const linkPath = join(tempDir, "link-overlay.json");
    await Deno.symlink(realPath, linkPath);

    const commands = new RequestCommands(context);
    await assertRejects(
      () => commands.create("run the flow", { flow: "research", overlays: [linkPath] }),
      Error,
      "overlay_invalid",
    );
    void db;
    void config;
    void tempDir;
  } finally {
    await cleanup();
  }
});

Deno.test("[security] exactl request --overlay refuses a directory with overlay_invalid", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const dirPath = join(tempDir, "overlay-dir");
    await Deno.mkdir(dirPath, { recursive: true });

    const commands = new RequestCommands(context);
    await assertRejects(
      () => commands.create("run the flow", { flow: "research", overlays: [dirPath] }),
      Error,
      "overlay_invalid",
    );
    void db;
    void config;
    void tempDir;
  } finally {
    await cleanup();
  }
});

Deno.test("[security] exactl request --overlay refuses a file above the byte ceiling with overlay_invalid", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const bigPath = join(tempDir, "big-overlay.json");
    // Valid JSON padded past the ceiling, so only the size check can fail.
    await Deno.writeTextFile(bigPath, VALID_OVERLAY + " ".repeat(BINDING_OVERLAY_MAX_BYTES));

    const commands = new RequestCommands(context);
    await assertRejects(
      () => commands.create("run the flow", { flow: "research", overlays: [bigPath] }),
      Error,
      "overlay_invalid",
    );
    void db;
    void config;
    void tempDir;
  } finally {
    await cleanup();
  }
});
