#!/usr/bin/env -S deno run -A
/**
 * @module MockSessionTool
 * @path scripts/mock_session_tool.ts
 * @description Phase 111 Step 3 — deterministic mock session-tool CLI. Reads a
 *   session brief from --brief <path>, validates it through SessionBriefSchema,
 *   and writes a schema-valid return.json atomically (tmp+rename) with the
 *   canonical success decision for the brief's gate and zeroed token stats.
 *   Sandbox-safe: only reads the brief file and writes the sibling return.
 *
 * Usage:
 *   deno run -A scripts/mock_session_tool.ts --brief <path-to-brief.json>
 *
 * Options:
 *   --brief <path>  Path to the session brief JSON file
 *   --help          Show this help message
 * @architectural-layer Scripts
 * @dependencies [@exaix/schemas, @std/path]
 * @related-files [tests/integration/mock_session_tool_test.ts, packages/schemas/src/session_delegate.ts]
 */

import { dirname, join } from "@std/path";
import { SESSION_GATE_DECISIONS, SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionGate } from "@exaix/schemas/session_delegate.ts";

const RETURN_FILE = "return.json";

async function main(): Promise<void> {
  const briefArg = Deno.args.find((a) => a.startsWith("--brief="))?.split("=")[1] ??
    (Deno.args.indexOf("--brief") >= 0 ? Deno.args[Deno.args.indexOf("--brief") + 1] : undefined);

  const briefPath = briefArg ?? Deno.env.get("MOCK_BRIEF_PATH");
  if (!briefPath) {
    console.error("Usage: mock_session_tool --brief <path-to-brief.json>");
    Deno.exit(1);
  }

  const raw = await Deno.readTextFile(briefPath);
  const brief = SessionBriefSchema.parse(JSON.parse(raw));
  const gate = brief.gate as SessionGate;

  // Canonical success verb for this gate (first entry in SESSION_GATE_DECISIONS)
  const decision = SESSION_GATE_DECISIONS[gate][0];

  // Derive in-scope paths_touched from permitted_paths: use the first 1-2 entries,
  // resolved to a concrete file by stripping wildcards
  const pathsTouched = brief.permitted_paths.slice(0, 2).map((p) =>
    p.endsWith("**") ? p.slice(0, -2) + "sample.ts" : p.endsWith("*") ? p.slice(0, -1) + "sample.ts" : p
  );

  const sessionReturn = SessionReturnSchema.parse({
    trace_id: brief.trace_id,
    resume_token: brief.resume_token,
    decision,
    summary: `Mock session tool completed with '${decision}' for gate '${gate}'.`,
    paths_touched: pathsTouched,
    token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  });

  const returnPath = join(dirname(briefPath), RETURN_FILE);
  const tmp = `${returnPath}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(sessionReturn, null, 2));
  await Deno.rename(tmp, returnPath);
}

if (import.meta.main) {
  await main();
}
