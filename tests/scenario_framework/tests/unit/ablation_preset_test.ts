/**
 * @module AblationPresetTest
 * @path tests/scenario_framework/tests/unit/ablation_preset_test.ts
 * @description Phase 143 Step 2 — RED-first test for the ablation config presets
 *   (`configs/eval-ablate-{skills,quality-gate,portal-knowledge}.toml`): each preset
 *   parses through the real daemon schema (`ConfigSchema`), flips exactly its documented
 *   subsystem key to `false` while the other two subsystems stay enabled, and the three
 *   files are byte-identical apart from those toggle lines (config parity otherwise
 *   unchanged). Memory injection has no config toggle (constructor-gated), so the set is
 *   exactly three factors — no fourth preset.
 * @architectural-layer Test
 * @related-files [packages/schemas/src/config.ts]
 */

import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas/config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

const CONFIGS_DIR = join(REPO_ROOT, "configs");
const PRESET_NAMES = ["skills", "quality-gate", "portal-knowledge"] as const;

const TOGGLE_LINES = ["inject_in_prompt =", "injection_enabled =", "enabled ="];

function presetPath(name: string): string {
  return join(CONFIGS_DIR, `eval-ablate-${name}.toml`);
}

function readPreset(name: string): string {
  return Deno.readTextFileSync(presetPath(name));
}

function parsePreset(name: string): ReturnType<typeof ConfigSchema.parse> {
  return ConfigSchema.parse(parse(readPreset(name)));
}

function strippedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !TOGGLE_LINES.some((t) => l.startsWith(t)));
}

Deno.test("[AblationPreset] all three presets exist and parse through ConfigSchema", () => {
  for (const name of PRESET_NAMES) {
    const text = readPreset(name);
    assertExists(text, `${name} preset file exists`);
    const config = parsePreset(name);
    assertExists(config.skills, `${name}: skills block parses`);
    assertExists(config.quality_gate, `${name}: quality gate block parses`);
    assertExists(config.portal_knowledge, `${name}: portal knowledge block parses`);
  }
});

Deno.test("[AblationPreset] each preset flips exactly its documented key to false", () => {
  const skills = parsePreset("skills");
  const gate = parsePreset("quality-gate");
  const pk = parsePreset("portal-knowledge");

  assertEquals(skills.skills?.inject_in_prompt, false, "skills preset disables skills injection");
  assertEquals(gate.skills?.inject_in_prompt, true, "gate preset leaves skills injection enabled");
  assertEquals(pk.skills?.inject_in_prompt, true, "portal-knowledge preset leaves skills injection enabled");

  assertEquals(skills.quality_gate?.enabled, true, "skills preset leaves quality gate enabled");
  assertEquals(gate.quality_gate?.enabled, false, "gate preset disables the quality gate");
  assertEquals(pk.quality_gate?.enabled, true, "portal-knowledge preset leaves quality gate enabled");

  assertEquals(skills.portal_knowledge?.injection_enabled, true, "skills preset leaves portal injection enabled");
  assertEquals(gate.portal_knowledge?.injection_enabled, true, "gate preset leaves portal injection enabled");
  assertEquals(pk.portal_knowledge?.injection_enabled, false, "portal-knowledge preset disables portal injection");
});

Deno.test("[AblationPreset] config parity otherwise byte-identical across the three presets", () => {
  const stripped = PRESET_NAMES.map((name) => strippedLines(readPreset(name)).join("\n"));
  assertEquals(stripped[0], stripped[1], "skills and quality-gate presets differ only in toggle lines");
  assertEquals(stripped[1], stripped[2], "quality-gate and portal-knowledge presets differ only in toggle lines");
  assertEquals(stripped[0], stripped[2], "skills and portal-knowledge presets differ only in toggle lines");
});

Deno.test("[AblationPreset] no fourth (memory) preset ships — memory ablation is descoped", async () => {
  assertFalse(await exists(presetPath("memory")), "memory preset must not exist");
});
