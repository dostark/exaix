/**
 * @module JournalCommandsFilterTest
 * @path apps/exactl/tests/journal_commands_filter_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Validates the mapping of CLI filter strings (e.g., trace_id=xyz) into structured
 * DatabaseService queries for activity journal introspection.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { JournalCommands } from "../src/commands/journal_commands.ts";
import type { IJournalFilterOptions } from "@exaix/core/types";
import { UIOutputFormat } from "@exaix/tui";
import { initTestDbService } from "../../../tests/helpers/db.ts";
import { createStubConfig, createStubContext } from "../../../tests/helpers/test_helpers.ts";
import { captureAllOutputs, captureConsoleOutput } from "./helpers/console_utils.ts";
import { expectExitWithLogs } from "./helpers/test_utils.ts";
import {
  JOURNAL_ACTOR_USER,
  JOURNAL_CAPTURE_COUNT_ONE,
  JOURNAL_DISTINCT_FIELD_ACTION,
  JOURNAL_FILTER_ACTION,
  JOURNAL_FILTER_IDENTITY,
  JOURNAL_FILTER_INVALID,
  JOURNAL_FILTER_SINCE,
  JOURNAL_FILTER_TRACE,
  JOURNAL_FILTER_UNKNOWN,
  JOURNAL_IDENTITY_ID,
  JOURNAL_INVALID_FILTER_PREFIX,
  JOURNAL_PAYLOAD,
  JOURNAL_SINCE_VALUE,
  JOURNAL_TAIL_LIMIT,
  JOURNAL_TARGET_SHORT,
  JOURNAL_TRACE_ID_ONE,
  JOURNAL_UNKNOWN_FILTER_PREFIX,
  JournalAction,
} from "@exaix/testing";

Deno.test("JournalCommands maps explicit options into query filters", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const originalQuery = db.queryActivity.bind(db);
  const captured: IJournalFilterOptions[] = [];

  db.queryActivity = (filter: IJournalFilterOptions) => {
    captured.push(filter);
    return Promise.resolve([]);
  };

  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));
    await captureConsoleOutput(() =>
      cmd.show({
        tail: JOURNAL_TAIL_LIMIT,
        distinct: JOURNAL_DISTINCT_FIELD_ACTION,
        payload: JOURNAL_PAYLOAD,
        actor: JOURNAL_ACTOR_USER,
        target: JOURNAL_TARGET_SHORT,
        format: UIOutputFormat.JSON,
      })
    );

    assertEquals(captured.length, JOURNAL_CAPTURE_COUNT_ONE);
    assertEquals(captured[0].limit, JOURNAL_TAIL_LIMIT);
    assertEquals(captured[0].distinct, JOURNAL_DISTINCT_FIELD_ACTION);
    assertEquals(captured[0].payload, JOURNAL_PAYLOAD);
    assertEquals(captured[0].actor, JOURNAL_ACTOR_USER);
    assertEquals(captured[0].target, JOURNAL_TARGET_SHORT);
  } finally {
    db.queryActivity = originalQuery;
    await cleanup();
  }
});

Deno.test("JournalCommands maps filter strings to query filters", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const originalQuery = db.queryActivity.bind(db);
  const captured: IJournalFilterOptions[] = [];

  db.queryActivity = (filter: IJournalFilterOptions) => {
    captured.push(filter);
    return Promise.resolve([]);
  };

  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));
    await captureConsoleOutput(() =>
      cmd.show({
        filter: [
          JOURNAL_FILTER_TRACE,
          JOURNAL_FILTER_ACTION,
          JOURNAL_FILTER_IDENTITY,
          JOURNAL_FILTER_SINCE,
        ],
        format: UIOutputFormat.JSON,
      })
    );

    assertEquals(captured.length, JOURNAL_CAPTURE_COUNT_ONE);
    assertEquals(captured[0].traceId, JOURNAL_TRACE_ID_ONE);
    assertEquals(captured[0].actionType, JournalAction.Generic);
    assertEquals(captured[0].identityId, JOURNAL_IDENTITY_ID);
    assertEquals(captured[0].since, JOURNAL_SINCE_VALUE);
  } finally {
    db.queryActivity = originalQuery;
    await cleanup();
  }
});

Deno.test("JournalCommands warns on unknown filter keys", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

  try {
    const { errs } = await captureAllOutputs(() =>
      cmd.show({ filter: [JOURNAL_FILTER_UNKNOWN], format: UIOutputFormat.JSON })
    );
    assertStringIncludes(errs.join(" "), JOURNAL_UNKNOWN_FILTER_PREFIX);
  } finally {
    await cleanup();
  }
});

Deno.test("JournalCommands exits on invalid filter format", async () => {
  const { db, config, cleanup } = await initTestDbService();
  const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

  try {
    const result = await expectExitWithLogs(() =>
      cmd.show({ filter: [JOURNAL_FILTER_INVALID], format: UIOutputFormat.JSON })
    );

    assertEquals(result.exitCalled, true);
    assertStringIncludes(result.errors.join(" "), JOURNAL_INVALID_FILTER_PREFIX);
  } finally {
    await cleanup();
  }
});
