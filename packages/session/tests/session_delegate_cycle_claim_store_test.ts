/**
 * @module SessionDelegateCycleClaimStoreTest
 * @path packages/session/tests/session_delegate_cycle_claim_store_test.ts
 * @description Phase 174 Step 4 unit/race/security tests for
 *   SessionDelegateCycleClaimStore: the unique (parentTraceId, parentStepId, sequence,
 *   planDigest) key guarantees at most one durable launch, a live-race conflict is
 *   never silently reclaimed, a stale pre-launch claim can be reclaimed, and a changed
 *   plan digest gets an independent claim rather than colliding with the old one.
 * @architectural-layer Services
 * @related-files [packages/session/src/session_delegate_cycle_claim_store.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { SessionDelegateCycleClaimStore } from "../src/session_delegate_cycle_claim_store.ts";
import type { ISessionDelegateCycleClaimKey } from "../src/session_delegate_cycle_claim_store.ts";
import type { ISessionDelegationOutcome } from "../src/session_delegation.ts";

function makeKey(overrides: Partial<ISessionDelegateCycleClaimKey> = {}): ISessionDelegateCycleClaimKey {
  return {
    parentTraceId: crypto.randomUUID(),
    parentStepId: "next-steps",
    sequence: 1,
    planDigest: "a".repeat(64),
    ...overrides,
  };
}

function makeOutcome(delegationTraceId: string, parentTraceId: string): ISessionDelegationOutcome {
  return {
    delegationTraceId,
    parentTraceId,
    parentStepId: "next-steps",
    sequence: 1,
    status: "completed",
    decision: "changes_made",
    summary: "did the thing",
    pathsTouched: ["a.ts"],
  };
}

Deno.test("[unit] acquire inserts a claimed row and get() returns it", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const traceId = crypto.randomUUID();

    const result = await store.acquire(key, traceId);

    assertEquals(result.outcome, "acquired");
    assertEquals(result.claim.state, "claimed");
    assertEquals(result.claim.delegationTraceId, traceId);
    const fetched = await store.get(key);
    assertEquals(fetched?.delegationTraceId, traceId);
  } finally {
    await cleanup();
  }
});

Deno.test("[unit] transition persists state and outcome_json roundtrip", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const traceId = crypto.randomUUID();
    await store.acquire(key, traceId);
    await store.transition(key, "launched");
    const outcome = makeOutcome(traceId, key.parentTraceId);
    await store.transition(key, "returned", { outcome });

    const claim = await store.get(key);
    assertEquals(claim?.state, "returned");
    assertEquals(claim?.outcome?.summary, "did the thing");

    await store.transition(key, "reviewed");
    const reviewed = await store.get(key);
    assertEquals(reviewed?.state, "reviewed");
    assertEquals(reviewed?.outcome?.summary, "did the thing", "outcome_json survives a transition that omits it");
  } finally {
    await cleanup();
  }
});

Deno.test("[unit] getByDelegationTraceId finds a claim by its minted trace", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const traceId = crypto.randomUUID();
    await store.acquire(key, traceId);

    const found = await store.getByDelegationTraceId(traceId);
    assertEquals(found?.parentTraceId, key.parentTraceId);
    assertEquals(await store.getByDelegationTraceId(crypto.randomUUID()), null);
  } finally {
    await cleanup();
  }
});

Deno.test("[race] a conflicting acquire never silently reclaims a live claim", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const traceA = crypto.randomUUID();
    const traceB = crypto.randomUUID();

    const [first, second] = await Promise.all([
      store.acquire(key, traceA),
      store.acquire(key, traceB),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    assertEquals(outcomes, ["acquired", "existing"]);
    const winner = first.outcome === "acquired" ? first : second;
    const loser = first.outcome === "acquired" ? second : first;
    assertEquals(
      loser.claim.delegationTraceId,
      winner.claim.delegationTraceId,
      "the loser observes the winner's claim",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[negative] reclaimPreLaunch is a no-op once the claim has moved past 'claimed'", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const traceA = crypto.randomUUID();
    await store.acquire(key, traceA);
    await store.transition(key, "launched");

    const reclaimed = await store.reclaimPreLaunch(key, crypto.randomUUID());

    assertEquals(reclaimed.outcome, "existing");
    assertEquals(reclaimed.claim.delegationTraceId, traceA, "a launched claim is never relaunched");
  } finally {
    await cleanup();
  }
});

Deno.test("[unit] reclaimPreLaunch re-stamps a still-'claimed' (pre-launch) row", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const staleTrace = crypto.randomUUID();
    await store.acquire(key, staleTrace);

    const freshTrace = crypto.randomUUID();
    const reclaimed = await store.reclaimPreLaunch(key, freshTrace);

    assertEquals(reclaimed.outcome, "acquired");
    assertEquals(reclaimed.claim.delegationTraceId, freshTrace);
    assertNotEquals(reclaimed.claim.delegationTraceId, staleTrace);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a changed plan digest acquires an independent claim, not the old one", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const store = new SessionDelegateCycleClaimStore(db);
    const parentTraceId = crypto.randomUUID();
    const original = makeKey({ parentTraceId, planDigest: "a".repeat(64) });
    const forged = makeKey({ parentTraceId, planDigest: "b".repeat(64) });
    const originalTrace = crypto.randomUUID();
    const forgedTrace = crypto.randomUUID();
    await store.acquire(original, originalTrace);

    const result = await store.acquire(forged, forgedTrace);

    assertEquals(result.outcome, "acquired", "a different plan digest is a distinct idempotency tuple");
    assertEquals((await store.get(original))?.delegationTraceId, originalTrace, "the original claim is untouched");
  } finally {
    await cleanup();
  }
});
