/**
 * @module CoreL1JournalFake
 * @path tests/scripts/helpers/core_l1_journal_fake.ts
 * @description Provides a fake journal runner that stores the requested calls as chained rows without the pinned service.
 * @architectural-layer Test
 */
import type {
  IJournalRequest,
  IStoredRow,
  TJournalRunner,
} from "../../../scripts/go_port/core_l1_journal_reference.ts";

const HEX_RADIX = 16;

async function fakeHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(HEX_RADIX).padStart(2, "0")).join("");
}

/** Stores each call as a row with the defaults of the pinned service and a chain of fake hashes. */
export const fakeJournalRunner: TJournalRunner = async (
  _snapshot: string,
  request: IJournalRequest,
): Promise<readonly IStoredRow[]> => {
  const ids = [...request.ids];
  const times = [...request.times];
  const rows: IStoredRow[] = [];
  let prev = "";
  for (const call of request.calls) {
    const id = ids.shift() ?? "";
    const trace = call.traceId ?? ids.shift() ?? "";
    const details = call.details ?? {};
    const hash = await fakeHash(`${prev}\n${id}`);
    rows.push({
      id,
      trace_id: trace,
      actor: call.actor,
      actor_type: details.actorType ?? null,
      agent_role: details.agentRole ?? null,
      runner_kind: details.runnerKind ?? null,
      action_type: call.actionType,
      target: call.target,
      payload: JSON.stringify(call.payload),
      prompt_tokens: details.promptTokens ?? 0,
      completion_tokens: details.completionTokens ?? 0,
      cost_usd: details.costUsd === undefined ? 0 : details.costUsd,
      cache_read_tokens: details.cacheReadTokens ?? null,
      cache_creation_tokens: details.cacheCreationTokens ?? null,
      timestamp: times.shift() ?? "",
      prev_hash: prev,
      row_hash: hash,
    });
    prev = hash;
  }
  return rows;
};
