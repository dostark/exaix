#!/usr/bin/env -S deno run -A
/**
 * @module MigrateWaitForJournalEventSteps
 * @path scripts/migrate_wait_for_journal_event.ts
 * @description Converts every `type: "wait-for-journal-event"` scenario step to an
 *   `exactl journal wait` step: `type: "exactl"` + `command: "journal"` +
 *   `args: ["wait", "--event", <event>, "--since-rowid", "$JOURNAL_BASELINE"]`, preserving the
 *   step's `timeout_sec` (also passed as `--timeout`). The framework substitutes
 *   `$JOURNAL_BASELINE` with the scenario's journal rowid baseline at step-execution time.
 *   Comments, `name:`, and criteria fields are preserved verbatim.
 *   Usage: deno run -A scripts/migrate_wait_for_journal_event.ts [--dry-run]
 * @related-files [apps/exactl/src/commands/journal_commands.ts, tests/scenario_framework/runner/step_executor.ts]
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

function transformBlock(block: string[]): string[] {
  const out: string[] = [];
  const timeout = block.find((l) => l.includes("timeout_sec:"))?.match(/timeout_sec:\s*(\d+)/)?.[1];
  // The step-level `event_type:` sits at the step field indent (4 spaces); an `event_type:`
  // inside a `journal-event-exists` output criterion sits deeper (8+ spaces) and must not be
  // rewritten.
  const eventLine = block.find((l) => /^\s{4}event_type:/.test(l));
  const event = eventLine?.match(/event_type:\s*"([^"]+)"/)?.[1];
  if (!event) throw new Error(`wait-for-journal-event step without step-level event_type`);
  for (const line of block) {
    if (line.includes('type: "wait-for-journal-event"')) {
      out.push(line.replace('type: "wait-for-journal-event"', 'type: "exactl"'));
    } else if (/^\s{4}event_type:/.test(line)) {
      const indent = line.match(/^\s*/)?.[0] ?? "    ";
      const timeoutArgs = timeout ? `, "--timeout", "${timeout}"` : "";
      out.push(`${indent}command: "journal"`);
      out.push(`${indent}args: ["wait", "--event", "${event}", "--since-rowid", "$JOURNAL_BASELINE"${timeoutArgs}]`);
    } else {
      out.push(line);
    }
  }
  return out;
}

function rewriteFile(txt: string): { out: string; changed: number } {
  const lines = txt.split("\n");
  const out: string[] = [];
  let changed = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^ {2}- id:/.test(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && !/^ {2}- id:/.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }
      if (block.some((l) => l.includes('type: "wait-for-journal-event"'))) {
        out.push(...transformBlock(block));
        changed++;
      } else {
        out.push(...block);
      }
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  return { out: out.join("\n"), changed };
}

async function main(): Promise<void> {
  const files = await collectYamlFiles();
  let total = 0;
  for (const file of files) {
    const path = new URL(file, ROOT);
    const txt = await Deno.readTextFile(path);
    const { out, changed } = rewriteFile(txt);
    if (changed > 0) {
      console.log(`${changed}\t${file}`);
      total += changed;
      if (!DRY_RUN) await Deno.writeTextFile(path, out);
    }
  }
  console.log(`total wait-for-journal-event steps converted: ${total}`);
}

await main();
