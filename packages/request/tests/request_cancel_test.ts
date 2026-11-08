/**
 * @module RequestCancelTest
 * @path packages/request/tests/request_cancel_test.ts
 * @description Verifies RequestService.cancelRequest: allowed statuses, refusals, id resolution, path safety and the journal event.
 * @architectural-layer Services
 * @dependencies [@std/assert, @std/path, @exaix/request, @exaix/testing]
 * @related-files [packages/request/src/service.ts, packages/core/src/errors/request_cancel_errors.ts]
 */

import { assert, assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { stub } from "@std/testing/mock";
import { RequestService } from "@exaix/request";
import { RequestStatus, type RequestStatusType } from "@exaix/core/status";
import {
  RequestCancelNotAllowedError,
  RequestIdError,
  RequestNotFoundError,
  RequestStatusInvalidError,
} from "@exaix/core/errors";
import { MIN_REQUEST_ID_PREFIX_CHARS } from "@exaix/core/request";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig, createStubDisplay, initTestDbService } from "@exaix/testing";

const CANCELLABLE: RequestStatusType[] = [RequestStatus.PENDING, RequestStatus.NEEDS_CLARIFICATION];
const REFUSED: RequestStatusType[] = [
  RequestStatus.PLANNED,
  RequestStatus.ANALYZING,
  RequestStatus.ENRICHING,
  RequestStatus.REFINING,
  RequestStatus.IN_PROGRESS,
  RequestStatus.COMPLETED,
  RequestStatus.FAILED,
  RequestStatus.CANCELLED,
];

function createService(root: string): RequestService {
  return new RequestService({
    config: createMockConfig(root),
    display: createStubDisplay(),
    userIdentityGetter: () => Promise.resolve("tester"),
  });
}

async function setStatus(path: string, status: RequestStatusType): Promise<void> {
  const content = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, content.replace(/^status: .*$/m, `status: ${status}`));
}

async function writeRequestFile(dir: string, filename: string, traceId: string): Promise<string> {
  const path = join(dir, filename);
  await Deno.writeTextFile(
    path,
    `---\ntrace_id: "${traceId}"\ncreated: 2026-01-01T00:00:00.000Z\nstatus: pending\npriority: normal\nagent_role: default\nsource: cli\ncreated_by: tester\nsubject: s\n---\n\n# Request\n\nbody\n`,
  );
  return path;
}

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "req-cancel-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("cancel is allowed from pending and needs_clarification", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    for (const status of CANCELLABLE) {
      const created = await service.create(`Cancel from ${status}`);
      await setStatus(created.path!, status);
      const result = await service.cancelRequest(created.trace_id, undefined);
      assertEquals(result.previous_status, status);
      assertEquals(result.status, RequestStatus.CANCELLED);
      assertEquals(result.trace_id, created.trace_id);
      assertStringIncludes(await Deno.readTextFile(created.path!), "status: cancelled");
    }
  });
});

Deno.test("cancel from each other status throws RequestCancelNotAllowedError and leaves the file", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    for (const status of REFUSED) {
      const created = await service.create(`Refuse from ${status}`);
      await setStatus(created.path!, status);
      const before = await Deno.readTextFile(created.path!);
      const error = await assertRejects(() => service.cancelRequest(created.trace_id, undefined));
      assertInstanceOf(error, RequestCancelNotAllowedError);
      assertEquals(error.status, status);
      assertEquals(await Deno.readTextFile(created.path!), before);
    }
  });
});

Deno.test("a refusal names the alternative for the status", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const expected: Array<[RequestStatusType, string]> = [
      [RequestStatus.PLANNED, "exactl plan reject"],
      [RequestStatus.IN_PROGRESS, "in flight"],
      [RequestStatus.ANALYZING, "in flight"],
      [RequestStatus.COMPLETED, "already completed"],
      [RequestStatus.CANCELLED, "already cancelled"],
    ];
    for (const [status, text] of expected) {
      const created = await service.create(`Alternative for ${status}`);
      await setStatus(created.path!, status);
      const error = await assertRejects(() => service.cancelRequest(created.trace_id, undefined));
      assertStringIncludes((error as Error).message, text);
    }
  });
});

Deno.test("an empty, 7-character or ambiguous id throws a usage error and changes no file", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const first = await service.create("First");
    const dir = dirname(first.path!);
    const prefix = "abcdef12";
    const a = await writeRequestFile(dir, "request-abcdef12.md", `${prefix}-0000-4000-8000-000000000001`);
    const b = await writeRequestFile(dir, "request-abcdef13.md", `${prefix}-1111-4000-8000-000000000002`);
    const before = [await Deno.readTextFile(first.path!), await Deno.readTextFile(a), await Deno.readTextFile(b)];

    const tooShort = first.trace_id.slice(0, MIN_REQUEST_ID_PREFIX_CHARS - 1);
    for (const id of ["", tooShort, prefix]) {
      const error = await assertRejects(() => service.cancelRequest(id, undefined));
      assertInstanceOf(error, RequestIdError, `id "${id}"`);
    }
    const ambiguous = await assertRejects(() => service.cancelRequest(prefix, undefined));
    assertEquals((ambiguous as RequestIdError).matches.length, 2);

    assertEquals(
      [await Deno.readTextFile(first.path!), await Deno.readTextFile(a), await Deno.readTextFile(b)],
      before,
    );
  });
});

Deno.test("an id that ends in .md and contains .. is refused and no file outside the requests directory changes", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Inside");
    const dir = dirname(created.path!);
    const outside = await writeRequestFile(root, "outside.md", "99999999-0000-4000-8000-000000000009");
    const before = await Deno.readTextFile(outside);
    const relative = (path: string) => path.replace(dir + "/", "");
    for (const id of ["../outside.md", "../../outside.md", `x/../../${relative(outside)}`, outside]) {
      await assertRejects(() => service.cancelRequest(id, undefined), Error, undefined, `id ${id}`);
    }
    assertEquals(await Deno.readTextFile(outside), before);
    assertStringIncludes(await Deno.readTextFile(created.path!), "status: pending");
  });
});

Deno.test("cancel resolves a full trace id, a unique prefix and a filename", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const byId = await service.create("By id");
    const byPrefix = await service.create("By prefix");
    const byName = await service.create("By name");
    assertEquals((await service.cancelRequest(byId.trace_id, undefined)).trace_id, byId.trace_id);
    const prefix = byPrefix.trace_id.slice(0, MIN_REQUEST_ID_PREFIX_CHARS);
    assertEquals((await service.cancelRequest(prefix, undefined)).trace_id, byPrefix.trace_id);
    assertEquals((await service.cancelRequest(byName.filename, undefined)).trace_id, byName.trace_id);
  });
});

Deno.test("an unknown id throws RequestNotFoundError", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    await service.create("Present");
    const error = await assertRejects(() => service.cancelRequest("00000000-0000-4000-8000-000000000000", undefined));
    assertInstanceOf(error, RequestNotFoundError);
  });
});

Deno.test("cancel emits request.cancelled with previous_status and the request trace id", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const service = new RequestService({
      config: createMockConfig(tempDir),
      db,
      display: createStubDisplay(db),
      logger: new EventLogger({ db }),
      userIdentityGetter: () => Promise.resolve("tester"),
    });
    const created = await service.create("Journal the cancel");
    await service.cancelRequest(created.trace_id, "no longer needed");
    await db.waitForFlush();
    const rows = db.getActivitiesByTrace(created.trace_id).filter((row) => row.action_type === "request.cancelled");
    assertEquals(rows.length, 1);
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.request_id, created.trace_id);
    assertEquals(payload.previous_status, RequestStatus.PENDING);
    assertEquals(payload.reason, "no longer needed");
    assertEquals(payload.cancelled_by, "tester");
    assert(rows[0].trace_id === created.trace_id);
  } finally {
    await cleanup();
  }
});

Deno.test("cancel refuses a request whose trace id holds a path separator and leaves the file", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Anchor");
    const path = await writeRequestFile(dirname(created.path!), "request-hostile.md", "../outside");
    const before = await Deno.readTextFile(path);
    await assertRejects(() => service.cancelRequest("request-hostile.md", undefined), RequestIdError);
    assertEquals(await Deno.readTextFile(path), before);
  });
});

Deno.test("cancel changes only the top-level status line and keeps a nested status key", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Nested");
    const path = created.path!;
    const original = await Deno.readTextFile(path);
    await Deno.writeTextFile(path, original.replace(/^status: .*$/m, "status: pending\nnested:\n  status: keep-me"));
    await service.cancelRequest(created.trace_id, undefined);
    const after = await Deno.readTextFile(path);
    assertEquals(after.match(/^status: cancelled$/gm)?.length, 1);
    assertStringIncludes(after, "  status: keep-me");
  });
});

/** The names that a cancel leaves in the requests directory next to the request files. */
function temporaryFilesIn(dir: string): string[] {
  return [...Deno.readDirSync(dir)].map((entry) => entry.name).filter((name) => name.endsWith(".cancelling"));
}

Deno.test("cancel refuses when the status changed to analyzing while the temporary file was written", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Race");
    const path = created.path!;
    const write = Deno.writeTextFile.bind(Deno);
    const racing = stub(Deno, "writeTextFile", async (target: string | URL, data: string | ReadableStream<string>) => {
      await write(target, data);
      if (String(target).endsWith(".cancelling")) await setStatus(path, RequestStatus.ANALYZING);
    });
    try {
      const error = await assertRejects(
        () => service.cancelRequest(created.trace_id, undefined),
        RequestCancelNotAllowedError,
      );
      assertEquals(error.status, RequestStatus.ANALYZING);
    } finally {
      racing.restore();
    }
    assertStringIncludes(await Deno.readTextFile(path), `status: ${RequestStatus.ANALYZING}`);
    assertEquals(temporaryFilesIn(dirname(path)), []);
  });
});

Deno.test("cancel removes its temporary file when the rename fails and leaves the request as it was", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Rename failure");
    const path = created.path!;
    const before = await Deno.readTextFile(path);
    const failing = stub(Deno, "rename", () => Promise.reject(new Error("rename refused")));
    try {
      await assertRejects(() => service.cancelRequest(created.trace_id, undefined), Error, "rename refused");
    } finally {
      failing.restore();
    }
    assertEquals(await Deno.readTextFile(path), before);
    assertEquals(temporaryFilesIn(dirname(path)), []);
  });
});

Deno.test("cancel keeps the file mode of the request", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Mode");
    const restricted = 0o600;
    await Deno.chmod(created.path!, restricted);
    await service.cancelRequest(created.trace_id, undefined);
    assertEquals((await Deno.stat(created.path!)).mode! & 0o777, restricted);
  });
});

Deno.test("cancel of a request file whose status is not a request status throws RequestStatusInvalidError", async () => {
  await withTempRoot(async (root) => {
    const service = createService(root);
    const created = await service.create("Bad status");
    const path = await writeRequestFile(dirname(created.path!), "request-badstatus.md", "bad-status-trace");
    await Deno.writeTextFile(path, (await Deno.readTextFile(path)).replace(/^status: .*$/m, "status: bogus"));
    const before = await Deno.readTextFile(path);
    await assertRejects(() => service.cancelRequest("request-badstatus.md", undefined), RequestStatusInvalidError);
    assertEquals(await Deno.readTextFile(path), before);
  });
});
