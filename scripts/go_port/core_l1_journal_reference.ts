#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1JournalReference
 * @path scripts/go_port/core_l1_journal_reference.ts
 * @description Records the activity rows and hash chain that the pinned DatabaseService stores for authored journal calls.
 * The calls use fixed ids and times so a second run produces the same bytes.
 * Usage: imported by core_l1_reference.ts.
 */
import { runPinnedAdapter } from "./core_l1_adapter.ts";

export type TCostMode = "absent" | "null" | "value";

/** What the journal caller supplies for one row. The Go test builds its input from the same values. */
/** The stored columns that the caller does not supply directly. */
export type TDerivedColumn = "cost_usd" | "prev_hash" | "row_hash";

export interface IJournalEntry extends Omit<IStoredRow, TDerivedColumn> {
  readonly trace_from_generator: boolean;
  readonly cost: { readonly mode: TCostMode; readonly value: number };
}

export interface IJournalDetails {
  readonly actorType?: string;
  readonly agentRole?: string;
  readonly runnerKind?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly costUsd?: number | null;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
}

export interface IJournalCall {
  readonly actor: string;
  readonly actionType: string;
  readonly target: string | null;
  readonly payload: object;
  readonly traceId: string | null;
  readonly details?: IJournalDetails;
}

/** The ids and times the pinned service draws, in the order it draws them. */
export interface IJournalRequest {
  readonly calls: readonly IJournalCall[];
  readonly ids: readonly string[];
  readonly times: readonly string[];
}

/** One stored activity row with its columns in table order. */
export interface IStoredRow {
  readonly id: string;
  readonly trace_id: string;
  readonly actor: string;
  readonly actor_type: string | null;
  readonly agent_role: string | null;
  readonly runner_kind: string | null;
  readonly action_type: string;
  readonly target: string | null;
  readonly payload: string;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly cost_usd: number | null;
  readonly cache_read_tokens: number | null;
  readonly cache_creation_tokens: number | null;
  readonly timestamp: string;
  readonly prev_hash: string | null;
  readonly row_hash: string | null;
}

export type TJournalRunner = (snapshot: string, request: IJournalRequest) => Promise<readonly IStoredRow[]>;

export interface IRecordedJournalCase {
  readonly id: string;
  readonly input: string;
  readonly observation: string;
}

export const JOURNAL_CASE_ID = "journal-chained-rows";

const NON_ASCII_NOTE = "héllo ✓ 😀 日本語";
const COLUMNS: readonly (keyof IStoredRow)[] = [
  "id",
  "trace_id",
  "actor",
  "actor_type",
  "agent_role",
  "runner_kind",
  "action_type",
  "target",
  "payload",
  "prompt_tokens",
  "completion_tokens",
  "cost_usd",
  "cache_read_tokens",
  "cache_creation_tokens",
  "timestamp",
  "prev_hash",
  "row_hash",
];
const RESULT_PREFIX = "RESULT:";

interface IAuthored extends Omit<IJournalEntry, "payload"> {
  readonly body: object;
}

const AUTHORED: readonly IAuthored[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    trace_id: "trace-alpha",
    trace_from_generator: false,
    actor: "system",
    actor_type: null,
    agent_role: null,
    runner_kind: null,
    action_type: "request.created",
    target: null,
    body: {},
    prompt_tokens: 0,
    completion_tokens: 0,
    cost: { mode: "absent", value: 0 },
    cache_read_tokens: null,
    cache_creation_tokens: null,
    timestamp: "2026-02-03T04:05:06.007Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    trace_id: "trace-alpha",
    trace_from_generator: false,
    actor: "agent:senior-coder",
    actor_type: "agent",
    agent_role: "senior-coder",
    runner_kind: "claude-cli",
    action_type: "llm.call.completed",
    target: "Workspace/Requests/req-1.md",
    body: {
      model: "m-1",
      note: NON_ASCII_NOTE,
      quote: 'say "hi"\n\tdone',
      ratio: 1.50,
      nested: { list: [1, 2, { x: null }] },
    },
    prompt_tokens: 120,
    completion_tokens: 45,
    cost: { mode: "value", value: 0.0125 },
    cache_read_tokens: 30,
    cache_creation_tokens: 10,
    timestamp: "2026-02-03T04:05:06.999Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    trace_id: "trace-beta",
    trace_from_generator: false,
    actor: "daemon",
    actor_type: "system",
    agent_role: null,
    runner_kind: null,
    action_type: "plan.approved",
    target: "Workspace/Plans/plan-1.md",
    body: { a: 1 },
    prompt_tokens: 0,
    completion_tokens: 0,
    cost: { mode: "null", value: 0 },
    cache_read_tokens: null,
    cache_creation_tokens: null,
    timestamp: "2026-02-03T04:05:07.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    trace_id: "00000000-0000-4000-8000-0000000000a4",
    trace_from_generator: true,
    actor: "tui",
    actor_type: "user",
    agent_role: null,
    runner_kind: null,
    action_type: "ui.opened",
    target: "t",
    body: { k: "v" },
    prompt_tokens: 0,
    completion_tokens: 0,
    cost: { mode: "absent", value: 0 },
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    timestamp: "2026-12-31T23:59:59.123Z",
  },
];

/** The authored entries. Each payload is the string that the caller serialized itself. */
export const JOURNAL_ENTRIES: readonly IJournalEntry[] = AUTHORED.map(({ body, ...entry }) => ({
  ...entry,
  payload: JSON.stringify(body),
}));

function detailsOf(entry: IJournalEntry): IJournalDetails {
  return {
    ...(entry.actor_type === null ? {} : { actorType: entry.actor_type }),
    ...(entry.agent_role === null ? {} : { agentRole: entry.agent_role }),
    ...(entry.runner_kind === null ? {} : { runnerKind: entry.runner_kind }),
    promptTokens: entry.prompt_tokens,
    completionTokens: entry.completion_tokens,
    ...(entry.cost.mode === "absent" ? {} : { costUsd: entry.cost.mode === "null" ? null : entry.cost.value }),
    ...(entry.cache_read_tokens === null ? {} : { cacheReadTokens: entry.cache_read_tokens }),
    ...(entry.cache_creation_tokens === null ? {} : { cacheCreationTokens: entry.cache_creation_tokens }),
  };
}

function buildRequest(): IJournalRequest {
  const ids: string[] = [];
  for (const entry of JOURNAL_ENTRIES) {
    ids.push(entry.id);
    if (entry.trace_from_generator) ids.push(entry.trace_id);
  }
  return {
    ids,
    times: JOURNAL_ENTRIES.map((entry) => entry.timestamp),
    calls: JOURNAL_ENTRIES.map((entry) => ({
      actor: entry.actor,
      actionType: entry.action_type,
      target: entry.target,
      payload: JSON.parse(entry.payload),
      traceId: entry.trace_from_generator ? null : entry.trace_id,
      details: detailsOf(entry),
    })),
  };
}

/** Runs inside the snapshot with fixed ids and times and prints the stored rows after the pinned service flushed them. */
const ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const ids = [...request.ids];
const times = [...request.times];
const { Database } = await import("@db/sqlite");
const { DatabaseService } = await import(new URL("file://" + root + "/packages/storage-sqlite/src/database_service.ts").href);
const db = new Database(":memory:");
const service = new DatabaseService({ database: { batch_flush_ms: 1, batch_max_size: 1000 } }, { instance: db, close: async () => {} });
const RealDate = globalThis.Date;
const realUuid = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => ids.shift(), configurable: true });
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [times.shift()])); }
};
try {
  for (const call of request.calls) {
    service.logActivity(call.actor, call.actionType, call.target, call.payload, call.traceId ?? undefined, call.details);
  }
} finally {
  globalThis.Date = RealDate;
  if (realUuid) Object.defineProperty(globalThis.crypto, "randomUUID", realUuid);
  else delete globalThis.crypto.randomUUID;
}
await service.waitForFlush();
const rows = db.prepare("SELECT ${COLUMNS.join(", ")} FROM activity ORDER BY rowid").all();
console.log("${RESULT_PREFIX}" + JSON.stringify(rows));
`;

/** Runs the calls through the real pinned service. The activity table exists because the service creates it in test mode. */
export const pinnedJournalRunner: TJournalRunner = async (
  snapshot: string,
  request: IJournalRequest,
): Promise<readonly IStoredRow[]> => {
  const output = await runPinnedAdapter(snapshot, ADAPTER, JSON.stringify(request), { EXA_TEST_MODE: "1" });
  const line = output.split("\n").findLast((text) => text.startsWith(RESULT_PREFIX));
  if (line === undefined) throw new Error("the pinned journal adapter printed no result");
  return JSON.parse(line.slice(RESULT_PREFIX.length));
};

function checkRows(rows: readonly IStoredRow[]): void {
  if (rows.length !== JOURNAL_ENTRIES.length) {
    throw new Error(`the pinned service stored ${rows.length} rows, expected ${JOURNAL_ENTRIES.length}`);
  }
  rows.forEach((row, index) => {
    if (row.id !== JOURNAL_ENTRIES[index].id) throw new Error(`row ${index} is out of order`);
    const expectedPrev = index === 0 ? "" : rows[index - 1].row_hash;
    if (row.prev_hash !== expectedPrev || row.row_hash === null) throw new Error(`the chain is broken at row ${index}`);
  });
}

function inColumnOrder(row: IStoredRow): IStoredRow {
  return {
    id: row.id,
    trace_id: row.trace_id,
    actor: row.actor,
    actor_type: row.actor_type,
    agent_role: row.agent_role,
    runner_kind: row.runner_kind,
    action_type: row.action_type,
    target: row.target,
    payload: row.payload,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    cost_usd: row.cost_usd,
    cache_read_tokens: row.cache_read_tokens,
    cache_creation_tokens: row.cache_creation_tokens,
    timestamp: row.timestamp,
    prev_hash: row.prev_hash,
    row_hash: row.row_hash,
  };
}

/** Records the authored calls against the pinned service and returns the input and the stored rows as JSON. */
export async function recordJournalCase(snapshot: string, runner: TJournalRunner): Promise<IRecordedJournalCase> {
  const rows = await runner(snapshot, buildRequest());
  checkRows(rows);
  const input = { entries: JOURNAL_ENTRIES };
  const observation = { rows: rows.map(inColumnOrder) };
  return {
    id: JOURNAL_CASE_ID,
    input: `${JSON.stringify(input, null, 2)}\n`,
    observation: `${JSON.stringify(observation, null, 2)}\n`,
  };
}
