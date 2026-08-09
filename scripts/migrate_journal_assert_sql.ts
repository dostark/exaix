#!/usr/bin/env -S deno run -A
/**
 * @module MigrateJournalAssertSql
 * @path scripts/migrate_journal_assert_sql.ts
 * @description Migrates every `journal-assert` step that embeds a raw SQL query in its `args`
 *   to the declarative config fields (action_type, trace_scoped, payload_*, project, sums,
 *   expect_*).
 *   Raw SQL stays inside the framework (step_executor.ts builds the query from the fields).
 *   Idempotent: steps with no `args` (criteria-only) and already-migrated steps are left alone.
 *   Usage: deno run -A scripts/migrate_journal_assert_sql.ts [--check] [--dry-run]
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */
const ROOT = new URL("../tests/scenario_framework/scenarios/", import.meta.url);
const args = Deno.args;
const CHECK = args.includes("--check");
const DRY_RUN = args.includes("--dry-run");

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const SPECS: Array<{ key: string; build: (actionType: string) => string[] }> = [
  // SELECT 1 WHERE NOT EXISTS (... action_type='X' AND trace_id='$TRACE_ID') → count==0
  {
    key: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM activity WHERE action_type = 'X' AND trace_id = '$TRACE_ID')",
    build: (actionType) => [
      `action_type: "${actionType}"`,
      "trace_scoped: true",
      "expect_count: 0",
    ],
  },
  // SELECT 1 WHERE (COALESCE(SUM(files_changed)) ... ) > 0 → expect_sum
  {
    key:
      "SELECT 1 WHERE (SELECT COALESCE(SUM(json_extract(payload,'$.files_changed')),0) FROM activity WHERE action_type = 'X' AND trace_id = '$TRACE_ID') > 0",
    build: () => [
      'action_type: "agent.execution_completed"',
      "trace_scoped: true",
      "expect_sum:",
      '  path: "files_changed"',
      "  gt: 0",
    ],
  },
  // usage sums aggregate
  {
    key:
      "SELECT COALESCE(SUM(json_extract(payload,'$.usage.prompt_tokens')),0) AS prompt_tokens, COALESCE(SUM(json_extract(payload,'$.usage.completion_tokens')),0) AS completion_tokens, COALESCE(SUM(json_extract(payload,'$.usage.cost_usd_estimate')),0) AS cost_usd FROM activity WHERE action_type = 'X' AND trace_id = '$TRACE_ID'",
    build: () => [
      'action_type: "agent.execution_completed"',
      "trace_scoped: true",
      "sums:",
      '  prompt_tokens: "usage.prompt_tokens"',
      '  completion_tokens: "usage.completion_tokens"',
      '  cost_usd: "usage.cost_usd_estimate"',
    ],
  },
  // verify-journal: dynamic_tool_call tool_name projection
  {
    key:
      "SELECT action_type, json_extract(payload,'$.tool_name') AS tool_name FROM activity WHERE action_type = 'X' ORDER BY rowid",
    build: () => [
      'action_type: "dynamic_tool_call"',
      "project:",
      '  action_type: "action_type"',
      '  tool_name: "payload.tool_name"',
    ],
  },
  // verify-journal-entries: dynamic_tool_call tool_name + trace
  {
    key:
      "SELECT action_type, trace_id, json_extract(payload,'$.tool_name') AS tool_name FROM activity WHERE action_type = 'X' AND trace_id = '$TRACE_ID' ORDER BY rowid",
    build: () => [
      'action_type: "dynamic_tool_call"',
      "trace_scoped: true",
      "project:",
      '  action_type: "action_type"',
      '  trace_id: "trace_id"',
      '  tool_name: "payload.tool_name"',
    ],
  },
  // verify-single-trace: all rows under $TRACE_ID
  {
    key: "SELECT action_type, trace_id FROM activity WHERE trace_id = '$TRACE_ID' ORDER BY rowid",
    build: () => [
      "trace_scoped: true",
      "project:",
      '  action_type: "action_type"',
      '  trace_id: "trace_id"',
    ],
  },
  // guardrail prefix
  {
    key: "SELECT action_type FROM activity WHERE action_type LIKE 'guardrail.%' ORDER BY rowid",
    build: () => [
      'action_type_prefix: "guardrail."',
      "project:",
      '  action_type: "action_type"',
    ],
  },
  // edition_smoke model.resolved latest
  {
    key:
      "SELECT json_extract(payload,'$.selected') AS selected, json_extract(payload,'$.candidate_providers') AS candidate_providers FROM activity WHERE action_type = 'X' ORDER BY rowid DESC LIMIT 1",
    build: () => [
      'action_type: "model.resolved"',
      "latest_only: true",
      "project:",
      '  selected: "payload.selected"',
      '  candidate_providers: "payload.candidate_providers"',
    ],
  },
  // flow step with payload_contains strategy (started + completed variants)
  {
    key:
      'SELECT 1 WHERE EXISTS (SELECT 1 FROM activity WHERE action_type = \'X\' AND payload LIKE \'%"stepId":"react-step"%\' AND payload LIKE \'%"strategy":"react"%\')',
    build: (actionType) => [
      `action_type: "${actionType}"`,
      "payload_contains:",
      '  - \'"stepId":"react-step"\'',
      '  - \'"strategy":"react"\'',
    ],
  },
  {
    key:
      'SELECT 1 WHERE EXISTS (SELECT 1 FROM activity WHERE action_type = \'X\' AND payload LIKE \'%"stepId":"delegate-step"%\' AND payload LIKE \'%"strategy":"cli_delegate"%\')',
    build: (actionType) => [
      `action_type: "${actionType}"`,
      "payload_contains:",
      '  - \'"stepId":"delegate-step"\'',
      '  - \'"strategy":"cli_delegate"\'',
    ],
  },
  {
    key:
      "SELECT 1 WHERE EXISTS (SELECT 1 FROM activity WHERE action_type = 'X' AND payload LIKE '%\"stepId\":\"no-strategy-step\"%' AND payload NOT LIKE '%\"strategy\":%')",
    build: (actionType) => [
      `action_type: "${actionType}"`,
      "payload_contains:",
      '  - \'"stepId":"no-strategy-step"\'',
      "payload_not_contains:",
      "  - '\"strategy\":'",
    ],
  },
  // latest payload contains prompt_tokens (execution_completed / generation_completed)
  {
    key:
      "SELECT 1 WHERE (SELECT payload FROM activity WHERE action_type = 'X' ORDER BY rowid DESC LIMIT 1) LIKE '%prompt_tokens%'",
    build: (actionType) => [
      `action_type: "${actionType}"`,
      'expect_contains: ["prompt_tokens"]',
    ],
  },
  // verify-dynamic-step-completed: action_type + payload.stepId equality
  {
    key: "SELECT action_type FROM activity WHERE action_type = 'X' AND json_extract(payload,'$.stepId') = 'analyze'",
    build: (actionType) => [
      `action_type: "${actionType}"`,
      "payload_equals:",
      '  - path: "stepId"',
      '    value: "analyze"',
      "project:",
      '  action_type: "action_type"',
    ],
  },
  // verify-dynamic-step-ran: IN-list + payload.stepId equality
  {
    key:
      "SELECT action_type, json_extract(payload,'$.stepId') AS step_id FROM activity WHERE action_type IN ('flow.step.started','flow.step.completed') AND json_extract(payload,'$.stepId') = 'explore' ORDER BY rowid",
    build: () => [
      'action_types: ["flow.step.started", "flow.step.completed"]',
      "payload_equals:",
      '  - path: "stepId"',
      '    value: "explore"',
      "project:",
      '  action_type: "action_type"',
      '  step_id: "payload.stepId"',
    ],
  },
];

function migrateSql(sql: string): string[] | undefined {
  const n = normalize(sql);
  const actionType = n.match(/action_type = '([^']+)'/)?.[1];
  // Normalize the action_type literal to a placeholder so a single spec key covers every
  // action_type (e.g. dynamic_tool_call, flow.step.completed, model.resolved).
  const nKey = actionType ? n.replace(`action_type = '${actionType}'`, "action_type = 'X'") : n;
  for (const spec of SPECS) {
    if (nKey === spec.key) {
      return spec.build(actionType ?? "dynamic_tool_call");
    }
  }
  return undefined;
}

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

function rewriteFile(txt: string): { out: string; changed: number; errors: string[] } {
  const lines = txt.split("\n");
  const out: string[] = [];
  let changed = 0;
  const errors: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const argMatch = line.match(/^(\s*)args:\s*\[(.*)$/);
    if (!argMatch) {
      out.push(line);
      i++;
      continue;
    }
    const indent = argMatch[1];
    // collect args block: single-line or multiline
    let block = line;
    let j = i + 1;
    if (argMatch[2].trim() === "") {
      // multiline: consume until a line containing the closing ]
      while (j < lines.length && !lines[j].includes("]")) {
        block += "\n" + lines[j];
        j++;
      }
      if (j < lines.length) {
        block += "\n" + lines[j];
        j++;
      }
    }
    // args entries are double-quoted YAML strings that can contain escaped `\"` and literal
    // single quotes — match the full double-quoted token (with backslash escapes), not a
    // single-quote-delimited fragment.
    const sqlMatch = block.match(/"((?:[^"\\]|\\.)*)"/);
    const sql = sqlMatch?.[1]?.replaceAll('\\"', '"');
    if (!sql) {
      out.push(line);
      i++;
      continue;
    }
    // Determine the step type: look back for the nearest `type: "..."` at step indent.
    let stepType: string | undefined;
    for (let k = out.length - 1; k >= 0; k--) {
      const t = out[k].match(/^ {2}- id: "(.*)"$/);
      if (t) break;
      const ty = out[k].match(/^ {4}type: "([^"]+)"$/);
      if (ty) {
        stepType = ty[1];
        break;
      }
    }
    if (stepType !== "journal-assert") {
      out.push(line);
      i++;
      continue;
    }
    const decl = migrateSql(sql);
    if (!decl) {
      errors.push(`unmapped SQL: ${sql.slice(0, 120)}...`);
      out.push(line);
      i++;
      continue;
    }
    const replacement = decl.map((l) => indent + l);
    out.push(...replacement);
    i = j;
    changed++;
  }
  return { out: out.join("\n"), changed, errors };
}

async function main(): Promise<void> {
  const files = await collectYamlFiles();
  let totalChanged = 0;
  const allErrors: string[] = [];
  for (const file of files) {
    const path = new URL(file, ROOT);
    const txt = await Deno.readTextFile(path);
    const { out, changed, errors } = rewriteFile(txt);
    allErrors.push(...errors.map((e) => `${file}: ${e}`));
    if (changed > 0 && !DRY_RUN && !CHECK) {
      await Deno.writeTextFile(path, out);
    }
    totalChanged += changed;
    if (changed > 0) {
      console.log(`${changed}\t${file}`);
    }
  }
  console.log(`\ntotal journal-assert steps migrated: ${totalChanged}`);
  if (allErrors.length) {
    console.log(`\nERRORS (${allErrors.length}):`);
    for (const e of allErrors) console.log(`  ${e}`);
  }
}

await main();
