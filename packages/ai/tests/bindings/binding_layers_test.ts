/**
 * @module BindingLayersTest
 * @path packages/ai/tests/bindings/binding_layers_test.ts
 * @description Step-4 coverage for the complete operator layer loader: layer order and
 *   per-field provenance (config < daemon overlays in file-name order < run overlays in
 *   given order < run --bind), catalog merging over the built-ins, operatorLayersPresent
 *   and overlaySha256, and the security rejections every operator file must clear
 *   (runtime dir inside Workspace/Portals, size ceiling, unknown fields, symlinks,
 *   swapped files, path traversal).
 * @architectural-layer AI
 * @related-files [packages/ai/src/bindings/binding_layers.ts, packages/ai/src/bindings/run_bindings_store.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";
import { loadBindingLayers } from "@exaix/ai/bindings/binding_layers.ts";

/**
 * A run binding file carries its own overlays (content copied at submit time) and binds.
 * Built inline so the loader never needs the filesystem claim path for the layer-order test.
 */
function baseConfig(root: string): Config {
  return createMockConfig(root, {
    bindings: {
      "flow:research/step:s1": { service: "alpha", model: "mock/alpha" },
    },
    catalog: {
      models: {},
      services: {
        alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
      },
    },
  });
}

Deno.test("[layers] config < daemon overlays (file-name order) < run overlays < run --bind, per field", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = baseConfig(tempDir);
    await Deno.mkdir(overlaysDir, { recursive: true });
    // File-name order matters: 01 then 02, and the later file wins a field it sets.
    await Deno.writeTextFile(
      join(overlaysDir, "01-b.json"),
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:s1": { model: "mock/beta" } } }),
    );
    await Deno.writeTextFile(
      join(overlaysDir, "02-a.json"),
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:s1": { service: "beta" } } }),
    );

    const layers = await loadBindingLayers(config, {
      trace_id: crypto.randomUUID(),
      request_path: "request.md",
      request_sha256: "0".repeat(64),
      created_at: new Date().toISOString(),
      schema: 1,
      overlays: [{
        source_path: "run-overlay.json",
        sha256: "1".repeat(64),
        overlay: { schema: 1, bindings: { "flow:research/step:s1": { model: "mock/alpha" } } },
      }],
      binds: [{ selector: "flow:research/step:s1", spec: { model: "mock/beta" } }],
    });

    const matching = layers.entries.filter((entry) => entry.selector === "flow:research/step:s1");
    // The winning spec per field: service from daemon overlay 02, model from run --bind.
    const merged: Record<string, string | undefined> = {};
    for (const entry of matching) {
      Object.assign(merged, entry.spec);
    }
    assertEquals(merged.service, "beta");
    assertEquals(merged.model, "mock/beta");

    const layersByName = new Map(layers.entries.map((entry) => [entry.layer, entry.selector]));
    assertEquals(layersByName.get("config"), "flow:research/step:s1");
    assertEquals(layersByName.get("overlay"), "flow:research/step:s1");
    assertEquals(layersByName.get("run"), "flow:research/step:s1");
    // Same-selector entries in one layer merge into ONE entry. A later file then wins a
    // field it sets, instead of tripping ambiguous_selector. Both fields survive here.
    const overlayEntries = layers.entries.filter((e) => e.layer === "overlay");
    assertEquals(overlayEntries.length, 1);
    assertEquals(overlayEntries[0].spec.model, "mock/beta");
    assertEquals(overlayEntries[0].spec.service, "beta");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers] a runtime directory inside Workspace or Portals is refused", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-" });
  try {
    const config = createMockConfig(tempDir, {
      paths: { runtime: join("Workspace", ".exa-in-workspace") } as Config["paths"],
    });
    await assertRejects(() => loadBindingLayers(config), Error, "overlay_invalid");
    const portalConfig = createMockConfig(tempDir, {
      paths: { runtime: join("Portals", ".exa-in-portals") } as Config["paths"],
    });
    await assertRejects(() => loadBindingLayers(portalConfig), Error, "overlay_invalid");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers] an overlay above the byte ceiling or with an unknown field is refused", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = baseConfig(tempDir);
    await Deno.mkdir(overlaysDir, { recursive: true });
    // Above BINDING_OVERLAY_MAX_BYTES (256 KiB): padding inside an otherwise valid overlay.
    const oversizedFile = join(overlaysDir, "big.json");
    await Deno.writeTextFile(
      oversizedFile,
      JSON.stringify({ schema: 1, bindings: {} }) + " ".repeat(300 * 1024),
    );
    await assertRejects(() => loadBindingLayers(config), Error, "overlay_invalid");

    const badField = join(overlaysDir, "bad.json");
    await Deno.writeTextFile(badField, JSON.stringify({ schema: 1, bindings: {}, unknown: true }));
    await assertRejects(() => loadBindingLayers(config), Error, "overlay_invalid");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers][security] a symlinked overlay and a non-regular overlay entry are refused", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = baseConfig(tempDir);
    await Deno.mkdir(overlaysDir, { recursive: true });

    // A symlink pointing outside the operator directory must be refused.
    const outsideTarget = join(tempDir, "outside.json");
    await Deno.writeTextFile(outsideTarget, JSON.stringify({ schema: 1, bindings: {} }));
    await Deno.symlink(outsideTarget, join(overlaysDir, "symlink.json"));
    await assertRejects(() => loadBindingLayers(config), Error, "overlay_invalid");
    await Deno.remove(join(overlaysDir, "symlink.json"));

    // A directory entry is not a regular file and must be refused (swap-identity guard).
    const dirEntry = join(overlaysDir, "swap.json");
    await Deno.mkdir(dirEntry);
    await assertRejects(() => loadBindingLayers(config), Error, "overlay_invalid");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers] a regular daemon overlay applies and catalog merges over the built-ins", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = baseConfig(tempDir);
    await Deno.mkdir(overlaysDir, { recursive: true });
    await Deno.writeTextFile(
      join(overlaysDir, "catalog.json"),
      JSON.stringify({
        schema: 1,
        catalog: {
          services: {
            "extra-svc": { adapter: "mock", transport: "local", interface: "api", serves: { "*": "{name}" } },
          },
        },
      }),
    );
    const layers = await loadBindingLayers(config);
    assertEquals(layers.operatorLayersPresent, true);
    assertEquals(layers.overlaySha256.length, 1);
    assertEquals(layers.catalog.services["extra-svc"] !== undefined, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers][ordering] two run overlays at one selector resolve to the later argument's value", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-run-order-" });
  try {
    const config = baseConfig(tempDir);
    const layers = await loadBindingLayers(config, {
      trace_id: crypto.randomUUID(),
      request_path: "request.md",
      request_sha256: "0".repeat(64),
      created_at: new Date().toISOString(),
      schema: 1,
      overlays: [
        {
          source_path: "10-scenario.json",
          sha256: "a".repeat(64),
          overlay: { schema: 1, bindings: { "flow:research/step:s1": { model: "mock/alpha" } } },
        },
        {
          source_path: "30-operator-0.json",
          sha256: "b".repeat(64),
          overlay: { schema: 1, bindings: { "flow:research/step:s1": { model: "mock/beta" } } },
        },
      ],
      binds: [],
    });

    const runEntries = layers.entries.filter((e) => e.layer === "run");
    assertEquals(runEntries.length, 1);
    assertEquals(runEntries[0].spec.model, "mock/beta");
    // Both files were still hashed, so the evidence keeps the full overlay list.
    assertEquals(layers.overlaySha256.length, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[layers][ordering] two daemon overlay files at one selector resolve to the later file name", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "binding-layers-file-order-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = baseConfig(tempDir);
    await Deno.mkdir(overlaysDir, { recursive: true });
    await Deno.writeTextFile(
      join(overlaysDir, "01-first.json"),
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:s1": { model: "mock/alpha", service: "alpha" } } }),
    );
    await Deno.writeTextFile(
      join(overlaysDir, "02-second.json"),
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:s1": { service: "beta" } } }),
    );

    const layers = await loadBindingLayers(config);
    const overlayEntries = layers.entries.filter((e) => e.layer === "overlay");
    assertEquals(overlayEntries.length, 1);
    // 02-second.json wins the field it sets. 01-first.json keeps the field it alone set.
    assertEquals(overlayEntries[0].spec.service, "beta");
    assertEquals(overlayEntries[0].spec.model, "mock/alpha");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
