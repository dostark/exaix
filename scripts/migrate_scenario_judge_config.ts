#!/usr/bin/env -S deno run -A
/**
 * @module MigrateScenarioJudgeConfig
 * @path scripts/migrate_scenario_judge_config.ts
 * @description Moves the LLM judge's EXA_LLM_PROVIDER/EXA_LLM_MODEL out of judge-step env blocks
 *   into a scenario-level `judge:` block (provider/model). The framework injects the block into
 *   judge steps at run time, so scenarios no longer hardcode a judge model in the step env.
 *   Idempotent: scenarios without a judge env block (provider-live, process-env-based) are left
 *   alone.
 *   Usage: deno run -A scripts/migrate_scenario_judge_config.ts [--dry-run]
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

const ROOT = new URL("../tests/scenario_framework/scenarios/", import.meta.url);
const DRY_RUN = Deno.args.includes("--dry-run");

async function collectYamlFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(ROOT)) {
    if (!e.isDirectory) continue;
    for await (const f of Deno.readDir(new URL(`${e.name}/`, ROOT))) {
      if (f.name.endsWith(".yaml")) out.push(`${e.name}/${f.name}`);
    }
  }
  return out.sort();
}

/** Extract the judge env block (the one carrying EXA_EVAL_LLM_MOCK) and remove the
 *  EXA_LLM_PROVIDER/EXA_LLM_MODEL lines from it. Returns { lines, judge } where judge is the
 *  scenario-level block to insert, or undefined when the scenario has no judge env. */
function migrateJudgeEnv(lines: string[]): { lines: string[]; judge: string[] | undefined } {
  let provider: string | undefined;
  let model: string | undefined;
  let envIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("EXA_EVAL_LLM_MOCK")) continue;
    // The enclosing `env:` line sits at a smaller indent above.
    let envLine = i;
    while (envLine > 0 && !/^\s*env:\s*$/.test(lines[envLine]) && !/^  - id:/.test(lines[envLine])) envLine--;
    if (!/^\s*env:\s*$/.test(lines[envLine])) continue;
    envIndent = (lines[envLine].match(/^\s*/)?.[0] ?? "").length;
    // Scan the env block (deeper-indented lines) for provider/model.
    for (let j = envLine + 1; j < lines.length; j++) {
      const indent = (lines[j].match(/^\s*/)?.[0] ?? "").length;
      if (indent <= envIndent || lines[j].trim() === "" || /^  - id:/.test(lines[j])) break;
      const p = lines[j].match(/EXA_LLM_PROVIDER:\s*"([^"]*)"/);
      const m = lines[j].match(/EXA_LLM_MODEL:\s*"([^"]*)"/);
      if (p) provider = p[1];
      if (m) model = m[1];
    }
    break;
  }

  if (envIndent < 0 || (!provider && !model)) {
    return { lines, judge: undefined };
  }

  // Remove the provider/model lines from the env block (same indent-aware boundary).
  const filtered: string[] = [];
  let inJudgeEnv = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*env:\s*$/.test(lines[i])) {
      inJudgeEnv = true;
    } else if (inJudgeEnv) {
      const indent = (lines[i].match(/^\s*/)?.[0] ?? "").length;
      if (indent <= envIndent || lines[i].trim() === "" || /^  - id:/.test(lines[i])) inJudgeEnv = false;
    }
    if (inJudgeEnv && (lines[i].includes("EXA_LLM_PROVIDER:") || lines[i].includes("EXA_LLM_MODEL:"))) continue;
    filtered.push(lines[i]);
  }

  const judge = ["judge:", `  provider: "${provider}"`, ...(model ? [`  model: "${model}"`] : [])];
  return { lines: filtered, judge };
}

function rewriteFile(txt: string): { out: string; changed: boolean } {
  const lines = txt.split("\n");
  const { lines: migrated, judge } = migrateJudgeEnv(lines);
  if (!judge) return { out: txt, changed: false };
  // Insert the judge block before the scenario-level `steps:`.
  const stepsIdx = migrated.findIndex((l) => /^steps:/.test(l));
  const inserted = [...migrated.slice(0, stepsIdx), ...judge, ...migrated.slice(stepsIdx)];
  return { out: inserted.join("\n"), changed: true };
}

async function main(): Promise<void> {
  const files = await collectYamlFiles();
  let total = 0;
  for (const file of files) {
    const path = new URL(file, ROOT);
    const txt = await Deno.readTextFile(path);
    const { out, changed } = rewriteFile(txt);
    if (changed) {
      console.log(file);
      total++;
      if (!DRY_RUN) await Deno.writeTextFile(path, out);
    }
  }
  console.log(`total scenarios migrated: ${total}`);
}

await main();
