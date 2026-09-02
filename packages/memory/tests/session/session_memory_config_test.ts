/**
 * @module SessionMemoryConfigTest
 * @path packages/memory/tests/session/session_memory_config_test.ts
 * @description GAP-3 remediation: `memory.session.expand_links` is a parsed config field
 *   (documented default false) whose value flows into SessionMemoryService construction —
 *   a config override flips enhanceRequest into link-expanding mode, observable via a
 *   linked learning surfacing only when the opt-in is on.
 */

import { assertEquals } from "@std/assert";

import { MemoryLinkType } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";
import type { IMemoryCostRouter, IMemoryEmbeddingService } from "@exaix/core/types";

function makeConfig(root: string, expandLinks?: boolean): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
    memory: expandLinks === undefined ? {} : { session: { expand_links: expandLinks } },
  });
}

/** Vector stub: only the anchor learning is ever semantically visible — L2 can surface
 *  exclusively through link expansion, isolating the opt-in's observable effect. */
function anchorOnlyEmbedding(anchor: ILearning): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () =>
      Promise.resolve([{
        id: anchor.id,
        title: anchor.title,
        summary: anchor.description,
        similarity: 0.9,
        kind: "learning",
      }]),
    embed: () => Promise.resolve(),
    embedLearning: () => Promise.resolve(),
    initializeManifest: () => Promise.resolve(),
  });
}

const costRouter = castAny<IMemoryCostRouter>({ recordOperation: () => Promise.resolve() });

async function seedLinkedPair(bank: MemoryBankService): Promise<{ anchor: ILearning; linked: ILearning }> {
  const anchor = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Rate limiter resets on full restart",
    description: "Limiter and backoff state must be process-lifetime aware, not per request.",
    status: MemoryStatus.APPROVED,
  });
  const linked = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Retry backoff must outlive workers",
    description: "Backoff counters belong to the process, not to a single worker lifetime.",
    status: MemoryStatus.APPROVED,
  });
  await bank.initGlobalMemory();
  await bank.addGlobalLearning(anchor);
  await bank.addGlobalLearning(linked);
  // Link anchor -> linked (the Step 8 topical producer writes these; seeded directly here).
  await bank.updateLearning(anchor.id, { links: [{ target_id: linked.id, type: MemoryLinkType.TOPICAL }] });
  return { anchor, linked };
}

Deno.test("memory.session.expand_links parses with the documented default (false)", () => {
  const config = makeConfig("/tmp/unused");
  assertEquals(config.memory.session.expand_links, false, "the opt-in defaults to false");

  const enabled = makeConfig("/tmp/unused", true);
  assertEquals(enabled.memory.session.expand_links, true, "the override parses");
});

Deno.test("config override flips enhanceRequest into link-expanding mode (linked learning surfaces)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const { anchor, linked } = await seedLinkedPair(bank);
    const enabledConfig = makeConfig(config.system.root, true);
    assertEquals(enabledConfig.memory.session.expand_links, true);
    const sessionMemory = new SessionMemoryService(
      bank,
      anchorOnlyEmbedding(anchor),
      // Daemon wiring shape: the config field flows into the service session config.
      { expandLinks: enabledConfig.memory.session.expand_links },
    );

    const enhanced = await sessionMemory.enhanceRequest("rate limiter restarts");
    assertEquals(
      enhanced.memories.some((m) => m.title === linked.title),
      true,
      "with memory.session.expand_links=true the linked learning must surface",
    );
    void costRouter;
  } finally {
    await cleanup();
  }
});

Deno.test("default config keeps expansion off (linked learning does not surface)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const { anchor, linked } = await seedLinkedPair(bank);
    const defaultConfig = makeConfig(config.system.root);
    const sessionMemory = new SessionMemoryService(
      bank,
      anchorOnlyEmbedding(anchor),
      { expandLinks: defaultConfig.memory.session.expand_links },
    );

    const enhanced = await sessionMemory.enhanceRequest("rate limiter restarts");
    assertEquals(
      enhanced.memories.some((m) => m.title === linked.title),
      false,
      "without the opt-in the linked learning must not surface",
    );
    assertEquals(
      enhanced.memories.some((m) => m.title === anchor.title),
      true,
      "the anchor itself still surfaces",
    );
  } finally {
    await cleanup();
  }
});
