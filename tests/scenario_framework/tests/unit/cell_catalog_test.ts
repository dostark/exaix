/**
 * @module CellCatalogTest
 * @path tests/scenario_framework/tests/unit/cell_catalog_test.ts
 * @description Validates the eval cell catalog (configs/eval-cells.toml). Phase 203 Step 2
 *   turns each `[tool.<name>]` row into a named preset that a scenario selects with
 *   `matrix.from_catalog`. This file asserts the preset fields, the `tool`/`requires_bin`
 *   defaults, the `bindings.default` model agreement with each row's own config, sentinel
 *   tolerance, and name resolution order. Phase 141 Step 1 wrote the first version.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/cell_catalog.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join, resolve } from "@std/path";
import type { IMatrixCell } from "../../runner/matrix_expander.ts";
import { loadCellCatalog, resolveCatalogCells } from "../../runner/cell_catalog.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const CATALOG_PATH = resolve(REPO_ROOT, "configs", "eval-cells.toml");

/** The `[ai]` block of a config TOML — the provider and model a preset's row pins. */
interface IConfigAiBlock {
  provider?: string;
  model?: string;
}

async function configAiBlock(configRelPath: string): Promise<IConfigAiBlock> {
  const raw = await Deno.readTextFile(resolve(REPO_ROOT, configRelPath));
  const parsed = parseToml(raw) as { ai?: IConfigAiBlock };
  return parsed.ai ?? {};
}

Deno.test("[CellCatalog] the catalog exposes every shipped preset by its row name", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  for (const name of ["claude-code", "codex", "opencode", "exactl-native", "exactl-generic", "openai-chat"]) {
    assert(catalog.presets[name] !== undefined, `preset '${name}' must exist`);
  }
  assert(Object.keys(catalog.presets).length >= 12, "the catalog must keep at least 12 presets");
});

Deno.test("[CellCatalog] a preset carries every field its row declares", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);

  const claudeCode = catalog.presets["claude-code"]!;
  assertEquals(claudeCode.tool, "claude-code");
  assertEquals(claudeCode.config, "configs/claude-cli-delegate-all.toml");
  assertEquals(claudeCode.provider, "claude-cli");
  assertEquals(claudeCode.model, "claude-sonnet-5");
  assertEquals(claudeCode.requires_bin, "claude");
  assertEquals(claudeCode.requires_key, undefined);
  assertEquals(claudeCode.native_tools, undefined);

  const codex = catalog.presets["codex"]!;
  assertEquals(codex.tool, "codex");
  assertEquals(codex.config, "configs/codex-cli-react.toml");
  assertEquals(codex.provider, "codex-cli");
  assertEquals(codex.model, "gpt-5.6-terra");
  assertEquals(codex.requires_bin, "codex");

  const opencodeGo = catalog.presets["opencode-go"]!;
  assertEquals(opencodeGo.tool, "opencode-go");
  assertEquals(opencodeGo.model, "opencode-go/deepseek-v4-flash");
  assertEquals(opencodeGo.requires_bin, "opencode");
});

Deno.test("[CellCatalog] the exactl presets name the exactl tool and keep native_tools documentary", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);

  const native = catalog.presets["exactl-native"]!;
  assertEquals(native.tool, "exactl");
  assertEquals(native.provider, "anthropic");
  assertEquals(native.requires_key, "ANTHROPIC_API_KEY");
  assertEquals(native.requires_bin, "true");
  assertEquals(native.native_tools, true);

  const generic = catalog.presets["exactl-generic"]!;
  assertEquals(generic.tool, "exactl");
  assertEquals(generic.native_tools, false);
  // Documentary only: both rows share one config, so native_tools cannot come from it.
  assertEquals(generic.config, native.config);

  const openai = catalog.presets["exactl-openai"]!;
  assertEquals(openai.tool, "exactl");
  assertEquals(openai.provider, "openai");
  assertEquals(openai.config, "configs/openai-no-delegate.toml");
  assertEquals(openai.requires_key, "OPENAI_API_KEY");
  assertEquals(openai.requires_bin, "true");

  const google = catalog.presets["exactl-google"]!;
  assertEquals(google.tool, "exactl");
  assertEquals(google.provider, "google");
  assertEquals(google.config, "configs/google-no-delegate.toml");
  assertEquals(google.requires_key, "GOOGLE_API_KEY");
  assertEquals(google.requires_bin, "true");
});

Deno.test("[CellCatalog] a row without a tool field defaults to the exactl tool", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cell-catalog-defaults-" });
  try {
    const path = join(dir, "eval-cells.toml");
    await Deno.writeTextFile(
      path,
      [
        "[tool.bare]",
        'config = "configs/anthropic-no-delegate.toml"',
        'provider = "anthropic"',
        'requires_key = "ANTHROPIC_API_KEY"',
        "",
      ].join("\n"),
    );
    const catalog = await loadCellCatalog(path);
    assertEquals(catalog.presets["bare"]?.tool, "exactl");
    assertEquals(catalog.presets["bare"]?.requires_bin, "true");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CellCatalog] every referenced config file exists", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  for (const [name, preset] of Object.entries(catalog.presets)) {
    const configPath = resolve(REPO_ROOT, preset.config);
    const exists = await Deno.stat(configPath).then(() => true).catch(() => false);
    assert(exists, `config file for preset '${name}' not found: ${preset.config}`);
  }
});

Deno.test("[CellCatalog] every preset agrees with the provider and model its config already pins", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  const names = Object.keys(catalog.presets);
  assert(names.length > 0, "the catalog must expose at least one preset");

  for (const [name, preset] of Object.entries(catalog.presets)) {
    const ai = await configAiBlock(preset.config);
    assertEquals(preset.provider, ai.provider, `preset '${name}' provider must match its config's [ai].provider`);
    if (preset.model !== undefined) {
      assertEquals(preset.model, ai.model, `preset '${name}' model must match its config's [ai].model`);
    }
  }
});

Deno.test("[CellCatalog] a preset's default binding names the canonical model its config already used", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);

  const withBindings = Object.entries(catalog.presets).filter(([, preset]) => preset.bindings !== undefined);
  assert(withBindings.length > 0, "at least one preset must declare a default binding");

  for (const [name, preset] of withBindings) {
    const ai = await configAiBlock(preset.config);
    assertEquals(
      preset.bindings?.default?.model,
      `${ai.provider}/${ai.model}`,
      `preset '${name}' must bind the canonical model its config pins`,
    );
  }

  // The CLI-delegate rows keep their config-driven delegate setup, so they bind nothing.
  assertEquals(catalog.presets["claude-code"]?.bindings, undefined);
  assertEquals(catalog.presets["opencode"]?.bindings, undefined);
  assertEquals(catalog.presets["exactl-native"]?.bindings?.default?.model, "anthropic/claude-sonnet-5");
});

Deno.test("[CellCatalog] a preset catalog carrying the fixture-port sentinel loads unresolved", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cell-catalog-sentinel-" });
  try {
    const path = join(dir, "eval-cells.toml");
    await Deno.writeTextFile(
      path,
      [
        "[tool.fixture]",
        'config = "configs/anthropic-no-delegate.toml"',
        'provider = "anthropic"',
        'requires_key = "ANTHROPIC_API_KEY"',
        "",
        "[tool.fixture.catalog.services.fixture]",
        'adapter = "openai-chat"',
        'profile = "self-hosted"',
        'endpoint = "http://127.0.0.1:__COMPAT_FIXTURE_PORT__/v1/chat/completions"',
        'transport = "local"',
        'interface = "api"',
        'serves = { "*" = "{name}" }',
        "",
      ].join("\n"),
    );

    // The endpoint schema is a URL, so the sentinel can only survive a sentinel-tolerant load.
    // Loading must not require the fixture port: substitution happens later, at overlay time.
    const catalog = await loadCellCatalog(path);
    assertEquals(
      catalog.presets["fixture"]?.catalog?.services?.fixture?.endpoint,
      "http://127.0.0.1:__COMPAT_FIXTURE_PORT__/v1/chat/completions",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CellCatalog] resolveCatalogCells keeps the declared order", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  const cells: IMatrixCell[] = resolveCatalogCells(catalog, ["opencode", "exactl-google", "claude-code"]);

  assertEquals(cells.map((cell) => cell.tool), ["opencode", "exactl", "claude-code"]);
  assertEquals(cells.map((cell) => cell.config), [
    "configs/opencode-cli-delegate-all.toml",
    "configs/google-no-delegate.toml",
    "configs/claude-cli-delegate-all.toml",
  ]);
  assertEquals(cells.map((cell) => cell.requires_bin), ["opencode", "true", "claude"]);
});

Deno.test("[CellCatalog] resolveCatalogCells throws on an unknown preset name", async () => {
  const catalog = await loadCellCatalog(CATALOG_PATH);
  assertThrows(() => resolveCatalogCells(catalog, ["no-such-preset"]), Error, "unknown cell preset");
});
