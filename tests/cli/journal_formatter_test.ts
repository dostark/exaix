/**
 * @module JournalFormatterTest
 * @path tests/cli/journal_formatter_test.ts
 * @description Verifies CLI output formatting for the activity journal, covering JSON,
 * tabulated text, and truncated summaries for high-volume log streams.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { JournalFormatter } from "../../src/cli/formatters/journal_formatter.ts";
import type { ActivityRecord } from "../../src/services/core/db.ts";
import type { IJournalFilterOptions } from "../../src/shared/types/database.ts";
import { DataFormat, UIOutputFormat } from "../../src/shared/enums.ts";
import { captureConsoleOutput } from "./helpers/console_utils.ts";
import {
  JOURNAL_ACTIVITY_COUNT,
  JOURNAL_ACTOR_USER,
  JOURNAL_COUNT_VALUE,
  JOURNAL_DISTINCT_FIELD_ACTION,
  JOURNAL_ELLIPSIS,
  JOURNAL_ID_ONE,
  JOURNAL_ID_THREE,
  JOURNAL_ID_TWO,
  JOURNAL_IDENTITY_ID,
  JOURNAL_PAYLOAD,
  JOURNAL_TARGET_LONG,
  JOURNAL_TARGET_SHORT,
  JOURNAL_TIMESTAMP_ONE,
  JOURNAL_TIMESTAMP_THREE,
  JOURNAL_TIMESTAMP_TWO,
  JOURNAL_TRACE_ID_ONE,
  JOURNAL_TRACE_ID_THREE,
  JOURNAL_TRACE_ID_TWO,
  JOURNAL_TRUNCATE_MAX,
  JournalAction,
} from "../config/constants.ts";

const baseActivities: ActivityRecord[] = [
  {
    id: JOURNAL_ID_ONE,
    trace_id: JOURNAL_TRACE_ID_ONE,
    actor: JOURNAL_ACTOR_USER,
    actor_type: null,
    identity_id: JOURNAL_IDENTITY_ID,
    agent_kind: null,
    action_type: JournalAction.Error,
    target: JOURNAL_TARGET_LONG,
    payload: JOURNAL_PAYLOAD,
    timestamp: JOURNAL_TIMESTAMP_ONE,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
  },
  {
    id: JOURNAL_ID_TWO,
    trace_id: JOURNAL_TRACE_ID_TWO,
    actor: JOURNAL_ACTOR_USER,
    actor_type: null,
    identity_id: JOURNAL_IDENTITY_ID,
    agent_kind: null,
    action_type: JournalAction.Approve,
    target: JOURNAL_TARGET_SHORT,
    payload: JOURNAL_PAYLOAD,
    timestamp: JOURNAL_TIMESTAMP_TWO,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
  },
  {
    id: JOURNAL_ID_THREE,
    trace_id: JOURNAL_TRACE_ID_THREE,
    actor: JOURNAL_ACTOR_USER,
    actor_type: null,
    identity_id: JOURNAL_IDENTITY_ID,
    agent_kind: null,
    action_type: JournalAction.Create,
    target: JOURNAL_TARGET_SHORT,
    payload: JOURNAL_PAYLOAD,
    timestamp: JOURNAL_TIMESTAMP_THREE,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
  },
];

Deno.test("JournalFormatter: renders JSON output", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = {};
    JournalFormatter.render(baseActivities, filter, UIOutputFormat.JSON);
  });

  const parsed = JSON.parse(output) as ActivityRecord[];
  assertEquals(parsed.length, JOURNAL_ACTIVITY_COUNT);
  assertEquals(parsed[0].action_type, JournalAction.Error);
});

Deno.test("JournalFormatter: renders table output and truncates long targets", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = {};
    JournalFormatter.render(baseActivities, filter, UIOutputFormat.TABLE);
  });

  const expectedTruncated = JOURNAL_TARGET_LONG.slice(
    0,
    JOURNAL_TRUNCATE_MAX - JOURNAL_ELLIPSIS.length,
  ) + JOURNAL_ELLIPSIS;
  assertStringIncludes(output, JournalAction.Error);
  assertStringIncludes(output, JournalAction.Approve);
  assertStringIncludes(output, JournalAction.Create);
  assertStringIncludes(output, expectedTruncated);
});

Deno.test("JournalFormatter: renders text output", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = {};
    JournalFormatter.render(baseActivities, filter, DataFormat.TEXT);
  });

  assertStringIncludes(output, JournalAction.Error);
  assertStringIncludes(output, JOURNAL_TARGET_SHORT);
});

Deno.test("JournalFormatter: renders distinct values in table format", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = { distinct: JOURNAL_DISTINCT_FIELD_ACTION };
    JournalFormatter.render(baseActivities, filter, UIOutputFormat.TABLE);
  });

  assertStringIncludes(output, JournalAction.Error);
});

Deno.test("JournalFormatter: renders counts in table format", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = { count: true };
    const countActivities: ActivityRecord[] = baseActivities.map((activity) => ({
      ...activity,
      count: JOURNAL_COUNT_VALUE,
    }));
    JournalFormatter.render(countActivities, filter, UIOutputFormat.TABLE);
  });

  assertStringIncludes(output, JournalAction.Error);
  assertStringIncludes(output, String(JOURNAL_COUNT_VALUE));
});

Deno.test("JournalFormatter: renders counts in text format", async () => {
  const output = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = { count: true };
    const countActivities: ActivityRecord[] = baseActivities.map((activity) => ({
      ...activity,
      count: JOURNAL_COUNT_VALUE,
    }));
    JournalFormatter.render(countActivities, filter, DataFormat.TEXT);
  });
  assertStringIncludes(output, JournalAction.Error);
  assertStringIncludes(output, String(JOURNAL_COUNT_VALUE));
});

Deno.test("JournalFormatter: renders estimated cost from usage payload", async () => {
  const costActivities: ActivityRecord[] = [
    {
      ...baseActivities[0],
      payload: JSON.stringify({
        usage: {
          tokens: 1200,
          cost_usd_estimate: 0.42,
        },
      }),
    },
  ];

  const textOutput = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = {};
    JournalFormatter.render(costActivities, filter, DataFormat.TEXT);
  });
  assertStringIncludes(textOutput, "cost=");
  assertStringIncludes(textOutput, "$0.420000");

  const tableOutput = await captureConsoleOutput(() => {
    const filter: IJournalFilterOptions = {};
    JournalFormatter.render(costActivities, filter, UIOutputFormat.TABLE);
  });
  assertStringIncludes(tableOutput, "$0.420000");
});
