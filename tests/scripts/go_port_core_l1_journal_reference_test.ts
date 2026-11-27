/**
 * @module GoPortCoreL1JournalReferenceTest
 * @path tests/scripts/go_port_core_l1_journal_reference_test.ts
 * @description Exercises the recorder of the pinned journal rows. The Go checkout verifies the committed rows itself.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type IJournalRequest,
  type IStoredRow,
  JOURNAL_CASE_ID,
  JOURNAL_ENTRIES,
  recordJournalCase,
  type TJournalRunner,
} from "../../scripts/go_port/core_l1_journal_reference.ts";
import { fakeJournalRunner } from "./helpers/go_port_core_l1_journal_fake.ts";

const ASCII_MAX = 127;

interface IInputFile {
  readonly entries: readonly { readonly id: string; readonly trace_id: string; readonly payload: string }[];
}

Deno.test("go-port-core-l1-journal: authored entries cover the null, default and unicode columns", () => {
  const costModes = new Set(JOURNAL_ENTRIES.map((entry) => entry.cost.mode));
  assertEquals([...costModes].sort(), ["absent", "null", "value"]);
  assert(JOURNAL_ENTRIES.some((entry) => entry.target === null), "a null target");
  assert(JOURNAL_ENTRIES.some((entry) => entry.actor_type === null), "a null actor type");
  assert(
    JOURNAL_ENTRIES.some((entry) => [...entry.payload].some((ch) => ch.charCodeAt(0) > ASCII_MAX)),
    "a non-ASCII payload",
  );
  assert(JOURNAL_ENTRIES.some((entry) => entry.cache_read_tokens === 0), "an explicit zero cache column");
  assertEquals(new Set(JOURNAL_ENTRIES.map((entry) => entry.id)).size, JOURNAL_ENTRIES.length);
});

Deno.test("go-port-core-l1-journal: the request carries ids and times in the order the pinned service consumes them", async () => {
  let seen: IJournalRequest | undefined;
  const runner: TJournalRunner = (snapshot, request) => {
    seen = request;
    return fakeJournalRunner(snapshot, request);
  };
  await recordJournalCase("snapshot", runner);
  assertEquals(seen?.times, JOURNAL_ENTRIES.map((entry) => entry.timestamp));
  const generated = JOURNAL_ENTRIES.filter((entry) => entry.trace_from_generator).length;
  assertEquals(seen?.ids.length, JOURNAL_ENTRIES.length + generated);
  assertEquals(seen?.calls.map((call) => call.actionType), JOURNAL_ENTRIES.map((entry) => entry.action_type));
});

Deno.test("go-port-core-l1-journal: the recorded input keeps the exact payload bytes the caller serialized", async () => {
  const recorded = await recordJournalCase("snapshot", fakeJournalRunner);
  assertEquals(recorded.id, JOURNAL_CASE_ID);
  const input: IInputFile = JSON.parse(recorded.input);
  assertEquals(input.entries.map((entry) => entry.payload), JOURNAL_ENTRIES.map((entry) => entry.payload));
  for (const entry of input.entries) JSON.parse(entry.payload);
});

Deno.test("go-port-core-l1-journal: the observation lists every stored column in the pinned order", async () => {
  const recorded = await recordJournalCase("snapshot", fakeJournalRunner);
  const observation: { rows: IStoredRow[] } = JSON.parse(recorded.observation);
  assertEquals(Object.keys(observation.rows[0]), [
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
  ]);
  assertEquals(observation.rows[0].prev_hash, "");
});

Deno.test("go-port-core-l1-journal: rejects a run that stores another number of rows, another order or a broken link", async () => {
  const drop: TJournalRunner = async (snapshot, request) => (await fakeJournalRunner(snapshot, request)).slice(1);
  await assertRejects(() => recordJournalCase("snapshot", drop), Error, "rows");
  const swap: TJournalRunner = async (snapshot, request) => (await fakeJournalRunner(snapshot, request)).toReversed();
  await assertRejects(() => recordJournalCase("snapshot", swap), Error, "order");
  const unlink: TJournalRunner = async (snapshot, request) => {
    const rows = [...await fakeJournalRunner(snapshot, request)];
    rows[1] = { ...rows[1], prev_hash: "0".repeat(64) };
    return rows;
  };
  await assertRejects(() => recordJournalCase("snapshot", unlink), Error, "chain");
});

Deno.test("go-port-core-l1-journal: the same run produces the same bytes", async () => {
  const first = await recordJournalCase("snapshot", fakeJournalRunner);
  const second = await recordJournalCase("snapshot", fakeJournalRunner);
  assertEquals(first, second);
});
