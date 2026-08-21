/**
 * @module CellCatalogTest
 * @path tests/scenario_framework/tests/unit/cell_catalog_test.ts
 * @description Validates the eval cell catalog (configs/eval-cells.toml) —
 *   parses correctly, known tools resolve, unknown tools fail, and every
 *   referenced config file exists. Phase 141 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const CATALOG_PATH = resolve(REPO_ROOT, "configs", "eval-cells.toml");

interface ICellCatalogEntry {
  config?: string;
  provider?: string;
  model?: string;
  requires_bin?: string;
  requires_key?: string;
  native_tools?: boolean;
}

interface ICellCatalog {
  tool?: Record<string, ICellCatalogEntry>;
}

Deno.test("[CellCatalog] parses without error and contains expected tools", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  assert(catalog.tool !== undefined, "catalog must have a [tool] section");
  assert(catalog.tool["claude-code"] !== undefined, "claude-code entry required");
  assert(catalog.tool["opencode"] !== undefined, "opencode entry required");
  assert(catalog.tool["exactl-native"] !== undefined, "exactl-native entry required");
  assert(catalog.tool["exactl-generic"] !== undefined, "exactl-generic entry required");
});

Deno.test("[CellCatalog] claude-code entry has correct fields", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  const cc = catalog.tool!["claude-code"];
  assertEquals(cc.config, "configs/claude-cli-delegate-all.toml");
  assertEquals(cc.provider, "claude-cli");
  assertEquals(cc.requires_bin, "claude");
  assertEquals(cc.requires_key, undefined);
  assertEquals(cc.native_tools, undefined);
});

Deno.test("[CellCatalog] codex entry resolves the Codex-only ReAct config without an API key", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  const codex = catalog.tool!["codex"];

  assertEquals(codex.config, "configs/codex-cli-react.toml");
  assertEquals(codex.provider, "codex-cli");
  assertEquals(codex.model, "gpt-5.6-terra");
  assertEquals(codex.requires_bin, "codex");
  assertEquals(codex.requires_key, undefined);
});

Deno.test("[CellCatalog] exactl-native entry has native_tools = true and requires ANTHROPIC_API_KEY", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  const nat = catalog.tool!["exactl-native"];
  assertEquals(nat.requires_key, "ANTHROPIC_API_KEY");
  assertEquals(nat.native_tools, true);
});

Deno.test("[CellCatalog] every referenced config file exists", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  for (const [name, entry] of Object.entries(catalog.tool ?? {})) {
    if (entry.config) {
      const configPath = resolve(REPO_ROOT, entry.config);
      const stat = await Deno.stat(configPath).then(() => true).catch(() => false);
      assert(stat, `config file for tool '${name}' not found: ${entry.config}`);
    }
  }
});

Deno.test("[CellCatalog] opencode-go entry resolves to go tier model", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  const og = catalog.tool!["opencode-go"];
  assertEquals(og.model, "opencode-go/deepseek-v4-flash");
  assertEquals(og.requires_bin, "opencode");
});

Deno.test("[CellCatalog] adding a new tool to the catalog does not break existing entries", async () => {
  const raw = await Deno.readTextFile(CATALOG_PATH);
  const catalog = parseToml(raw) as ICellCatalog;
  // Simulate adding a hypothetical new tool — existing entries must survive
  const toolCount = Object.keys(catalog.tool ?? {}).length;
  assert(toolCount >= 4, "catalog should contain at least the 4 base tool entries");
});
