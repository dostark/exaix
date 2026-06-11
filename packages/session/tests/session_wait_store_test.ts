/**
 * @module SessionWaitStoreTest
 * @path packages/session/tests/session_wait_store_test.ts
 * @description Phase 106 Step 5 — tests for the GAP-1 ISessionWaitStore shim.
 *   Covers park/resume/expire/cancel transitions, GAP-2 constant-time token
 *   binding + deadline rejection, GAP-10 race/TOCTOU (duplicate resume, resume
 *   after expiry, resume past deadline), and cross-instance persistence.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";

const TRACE = "00000000-0000-0000-0000-0000000000f5";
const TOKEN = "8f14e45f-ceea-467a-9c8e-1f2b3c4d5e6f.cafebabecafebabe";
const FUTURE = "2026-12-31T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const NOW = new Date("2026-06-11T00:00:00.000Z");
const fixedClock = { now: () => NOW };

function makeStore(dir: string): SessionWaitStore {
  return new SessionWaitStore(dir, fixedClock);
}

Deno.test("[session_wait_store] park creates a pending wait state", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const state = await makeStore(dir).park(TRACE, "plan_review", TOKEN, FUTURE);
    assertEquals(state.status, "pending");
    assertEquals(state.gate, "plan_review");
    assertEquals(state.resume_token, TOKEN);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store] get returns undefined for an unknown trace", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await makeStore(dir).get("no-such-trace"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store] valid resume transitions pending → resumed with decision", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "code_changes", TOKEN, FUTURE);
    const resumed = await store.resume(TRACE, TOKEN, "changes_made");
    assertEquals(resumed.status, "resumed");
    assertEquals(resumed.decision, "changes_made");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store][security] GAP-2 — a wrong resume token is rejected, state unchanged", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "review", TOKEN, FUTURE);
    await assertRejects(() => store.resume(TRACE, "WRONG-TOKEN", "approved"));
    assertEquals((await store.get(TRACE))?.status, "pending");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store][security] GAP-10 — duplicate resume on a resumed state is rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "plan_review", TOKEN, FUTURE);
    await store.resume(TRACE, TOKEN, "approved");
    await assertRejects(() => store.resume(TRACE, TOKEN, "approved"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store][security] GAP-2 — resume past the deadline is rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "refinement", TOKEN, PAST); // deadline already elapsed vs fixed NOW
    await assertRejects(() => store.resume(TRACE, TOKEN, "enriched"));
    assertEquals((await store.get(TRACE))?.status, "pending");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store] expire transitions pending → expired and blocks resume", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "refinement", TOKEN, FUTURE);
    const expired = await store.expire(TRACE);
    assertEquals(expired.status, "expired");
    await assertRejects(() => store.resume(TRACE, TOKEN, "enriched"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store] cancel transitions pending → cancelled", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = makeStore(dir);
    await store.park(TRACE, "plan_review", TOKEN, FUTURE);
    const cancelled = await store.cancel(TRACE);
    assertEquals(cancelled.status, "cancelled");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[session_wait_store] wait state persists across store instances", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await makeStore(dir).park(TRACE, "code_changes", TOKEN, FUTURE);
    const reloaded = await makeStore(dir).get(TRACE);
    assertEquals(reloaded?.status, "pending");
    assertEquals(reloaded?.resume_token, TOKEN);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
