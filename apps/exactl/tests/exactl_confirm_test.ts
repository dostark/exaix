/**
 * @module ExaCtlConfirmTest
 * @path apps/exactl/tests/exactl_confirm_test.ts
 * @description Verifies that the confirm helper refuses without a terminal, honours --yes and --no-input, reads a prompt answer and journals each outcome.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/output/exactl_confirm.ts]
 * @related-files [apps/exactl/src/output/exactl_confirm.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import type { LogMetadata } from "@exaix/core/types";
import { DomainEventType, type ICliConfirmationPayload } from "@exaix/core/events";
import { CliConfirmationMode, CliConfirmationOutcome } from "@exaix/core/types";
import { ExaCtlConfirm } from "../src/output/exactl_confirm.ts";

const VERB = "blueprint remove";
const PROMPT = "Remove blueprint old-reviewer?";
const TRACE_ID = "trace-confirm";

interface IJournaled {
  action: string;
  target: string | null;
  payload: LogMetadata | undefined;
  traceId: string | undefined;
}

interface ITerminals {
  readonly stdin: boolean;
  readonly stderr: boolean;
}

function harness(terminal: boolean | ITerminals, answers: string[] = []) {
  const journaled: IJournaled[] = [];
  const prompts: string[] = [];
  let reads = 0;
  const confirm = new ExaCtlConfirm({
    display: {
      info: (action, target, payload, traceId) => {
        journaled.push({ action, target, payload, traceId });
        return Promise.resolve();
      },
      warn: () => Promise.resolve(),
      error: () => Promise.resolve(),
      debug: () => Promise.resolve(),
      fatal: () => Promise.resolve(),
    },
    sink: {
      out: () => Promise.resolve(),
      err: (text) => {
        prompts.push(text);
        return Promise.resolve();
      },
    },
    isTerminal: () => typeof terminal === "boolean" ? terminal : terminal.stdin && terminal.stderr,
    flush: () => Promise.resolve(),
    readLine: () => {
      reads += 1;
      return Promise.resolve(answers.shift() ?? "");
    },
  });
  return { confirm, journaled, prompts, reads: () => reads };
}

function payloadOf(entry: IJournaled): ICliConfirmationPayload {
  const { verb, mode, outcome } = entry.payload ?? {};
  return { verb, mode, outcome } as ICliConfirmationPayload;
}

Deno.test("no TTY and no --yes throws USAGE naming --yes", async () => {
  const { confirm, reads } = harness(false);
  const failure = await assertRejects(() => confirm.confirm(VERB, PROMPT, { input: true }), ExaCtlError);
  assertEquals(failure.code, ExaCtlExitCode.USAGE);
  assertStringIncludes(failure.message, "--yes");
  assertEquals(reads(), 0);
});

Deno.test("--no-input on a TTY throws USAGE", async () => {
  const { confirm, prompts } = harness(true, ["y"]);
  const failure = await assertRejects(() => confirm.confirm(VERB, PROMPT, { input: false }), ExaCtlError);
  assertEquals(failure.code, ExaCtlExitCode.USAGE);
  assertStringIncludes(failure.message, "--yes");
  assertEquals(prompts, []);
});

Deno.test("TTY answer y proceeds, n declines", async () => {
  const proceeding = harness(true, ["y"]);
  await proceeding.confirm.confirm(VERB, PROMPT, { input: true });
  assertStringIncludes(proceeding.prompts.join(""), PROMPT);

  const declining = harness(true, ["n"]);
  const failure = await assertRejects(() => declining.confirm.confirm(VERB, PROMPT, { input: true }), ExaCtlError);
  assertEquals(failure.code, ExaCtlExitCode.CANCELLED);

  const empty = harness(true, [""]);
  await assertRejects(() => empty.confirm.confirm(VERB, PROMPT, { input: true }), ExaCtlError);
});

Deno.test("--yes proceeds without a terminal and without reading", async () => {
  const { confirm, reads } = harness(false);
  await confirm.confirm(VERB, PROMPT, { input: true, yes: true });
  assertEquals(reads(), 0);
});

Deno.test("each of --yes, a prompt answer, a decline and a refusal logs cli.confirmation_resolved with the matching mode and outcome", async () => {
  const yes = harness(false);
  await yes.confirm.confirm(VERB, PROMPT, { input: true, yes: true }, TRACE_ID);
  const prompt = harness(true, ["yes"]);
  await prompt.confirm.confirm(VERB, PROMPT, { input: true });
  const declined = harness(true, ["no"]);
  await declined.confirm.confirm(VERB, PROMPT, { input: true }).catch(() => {});
  const noTty = harness(false);
  await noTty.confirm.confirm(VERB, PROMPT, { input: true }).catch(() => {});
  const noInput = harness(true);
  await noInput.confirm.confirm(VERB, PROMPT, { input: false }).catch(() => {});

  const entries = [yes, prompt, declined, noTty, noInput].map((run) => run.journaled);
  for (const run of entries) {
    assertEquals(run.length, 1);
    assertEquals(run[0].action, DomainEventType.CliConfirmationResolved);
  }
  assertEquals(entries.map((run) => payloadOf(run[0])), [
    { verb: VERB, mode: CliConfirmationMode.YES, outcome: CliConfirmationOutcome.CONFIRMED },
    { verb: VERB, mode: CliConfirmationMode.PROMPT, outcome: CliConfirmationOutcome.CONFIRMED },
    { verb: VERB, mode: CliConfirmationMode.PROMPT, outcome: CliConfirmationOutcome.DECLINED },
    { verb: VERB, mode: CliConfirmationMode.NO_TTY, outcome: CliConfirmationOutcome.REFUSED },
    { verb: VERB, mode: CliConfirmationMode.NO_INPUT, outcome: CliConfirmationOutcome.REFUSED },
  ]);
  assertEquals(entries[0][0].traceId, TRACE_ID);
  assertEquals(entries[1][0].traceId, undefined);
});

Deno.test("requireInput throws USAGE without a terminal and with --no-input, and logs the refusal", async () => {
  const noTty = harness(false);
  const failure = await assertRejects(() => noTty.confirm.requireInput("config edit", { input: true }), ExaCtlError);
  assertEquals(failure.code, ExaCtlExitCode.USAGE);
  assertStringIncludes(failure.message, "needs a terminal");
  assertEquals(payloadOf(noTty.journaled[0]), {
    verb: "config edit",
    mode: CliConfirmationMode.NO_TTY,
    outcome: CliConfirmationOutcome.REFUSED,
  });

  const noInput = harness(true);
  await assertRejects(() => noInput.confirm.requireInput("config edit", { input: false }), ExaCtlError);
  assertEquals(payloadOf(noInput.journaled[0]).mode, CliConfirmationMode.NO_INPUT);

  const allowed = harness(true);
  await allowed.confirm.requireInput("config edit", { input: true });
  assertEquals(allowed.journaled, []);
});

Deno.test("a prompt text with control sequences reaches the sink without them", async () => {
  const { confirm, prompts } = harness(true, ["y"]);
  await confirm.confirm(VERB, "Remove \x1b[31mold\x1b[0m\x07 reviewer?", { input: true });
  assertEquals(prompts.join(""), "Remove old reviewer? [y/N] ");
});

Deno.test("stdin on a terminal and stderr redirected refuses with no_tty", async () => {
  const { confirm, journaled, prompts } = harness({ stdin: true, stderr: false }, ["y"]);
  const failure = await assertRejects(() => confirm.confirm(VERB, PROMPT, { input: true }), ExaCtlError);
  assertEquals(failure.code, ExaCtlExitCode.USAGE);
  assertEquals(payloadOf(journaled[0]).mode, CliConfirmationMode.NO_TTY);
  assertEquals(prompts, []);
});
