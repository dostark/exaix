/**
 * @module MemoryExtractorLifecycleTest
 * @path tests/services/memory_extractor_pending_lifecycle_test.ts
 * @description Verifies the lifecycle management of pending memory proposals, ensuring secure
 * discovery, parsing, and retrieval of agent-suggested learnings from the filesystem.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";
import {
  ConfidenceLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
} from "../../../src/shared/enums.ts";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import type { ILearning, IMemoryUpdateProposal, IProposalLearning } from "../../../src/shared/schemas/memory_bank.ts";
import { createMockConfig } from "../../helpers/config.ts";
import type { IDatabaseService } from "../../../src/services/core/db.ts";
import type { IMemoryBankService } from "../../../src/shared/interfaces/i_memory_bank_service.ts";
import type { JSONValue } from "../../../src/shared/types/json.ts";

function makeProposalLearning(overrides: Partial<IProposalLearning> = {}): IProposalLearning {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.IDENTITY,
    source_id: undefined,

    scope: MemoryScope.GLOBAL,
    project: undefined,
    title: "t",
    description: "d",
    category: LearningCategory.INSIGHT,
    tags: ["tag"],
    confidence: ConfidenceLevel.HIGH,
    references: [],
    ...overrides,
  };
}

async function withTempRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "mem-extractor-" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function makeService(root: string, overrides: {
  db?: IDatabaseService;
  memoryBank?: IMemoryBankService;
} = {}): {
  config: ReturnType<typeof createMockConfig>;
  svc: MemoryExtractorService;
} {
  const config = createMockConfig(root);
  const db = overrides.db ?? ({ logActivity: () => {} } as Partial<IDatabaseService> as IDatabaseService);
  const memoryBank = overrides.memoryBank ?? ({} as Partial<IMemoryBankService> as IMemoryBankService);
  const svc = new MemoryExtractorService(config, db, memoryBank);
  return { config, svc };
}

async function ensurePendingDir(config: { system: { root: string }; paths: { memory: string } }): Promise<string> {
  const pendingDir = join(config.system.root, config.paths.memory, "Pending");
  await Deno.mkdir(pendingDir, { recursive: true });
  return pendingDir;
}

function makeProposal(overrides: Partial<IMemoryUpdateProposal> = {}): IMemoryUpdateProposal {
  const { id, created_at, learning, ...rest } = overrides;
  return {
    id: id ?? crypto.randomUUID(),
    created_at: created_at ?? new Date().toISOString(),
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.GLOBAL,
    target_project: undefined,
    learning: learning ?? makeProposalLearning(),
    reason: "r",
    identity_id: "a",
    execution_id: "e",
    status: MemoryStatus.PENDING,
    ...rest,
  };
}

async function writeProposal(pendingDir: string, proposal: IMemoryUpdateProposal): Promise<string> {
  const proposalPath = join(pendingDir, `${proposal.id}.json`);
  await Deno.writeTextFile(proposalPath, JSON.stringify(proposal));
  return proposalPath;
}

Deno.test("MemoryExtractorService.listPending: returns [] when pending dir missing", async () => {
  await withTempRoot(async (root) => {
    const { svc } = makeService(root);
    const pending = await svc.listPending();
    assertEquals(pending, []);
  });
});

Deno.test("MemoryExtractorService.listPending: skips invalid JSON and non-pending proposals", async () => {
  await withTempRoot(async (root) => {
    const { config, svc } = makeService(root);
    const pendingDir = await ensurePendingDir(config);

    // invalid json
    await Deno.writeTextFile(join(pendingDir, "bad.json"), "{not json");

    // valid schema, but status not pending
    const nonPending = makeProposal({ status: MemoryStatus.APPROVED });
    await Deno.writeTextFile(join(pendingDir, "nonpending.json"), JSON.stringify(nonPending));

    const list = await svc.listPending();
    assertEquals(list.length, 0);
  });
});

Deno.test("MemoryExtractorService.getPending: returns null for missing or invalid proposal file", async () => {
  await withTempRoot(async (root) => {
    const { config, svc } = makeService(root);

    const missing = await svc.getPending("does-not-exist");
    assertEquals(missing, null);

    const pendingDir = await ensurePendingDir(config);

    await Deno.writeTextFile(join(pendingDir, "bad-id.json"), "{not json");
    const invalid = await svc.getPending("bad-id");
    assertEquals(invalid, null);
  });
});

Deno.test("MemoryExtractorService.approvePending: global proposal merges learning and removes file", async () => {
  await withTempRoot(async (root) => {
    type CallRecord =
      | { kind: string; learning: ILearning }
      | { kind: string; project: string; pattern: { examples: string[] } }
      | [string, string, string | null, Record<string, JSONValue>, string?, string?];
    const calls: CallRecord[] = [];

    const { config, svc } = makeService(root, {
      db: {
        logActivity: (
          actor: string,
          actionType: string,
          target: string | null,
          payload: Record<string, JSONValue>,
          traceId?: string,
          identityId?: string | null,
        ) => {
          // Log as tuple for test
          calls.push([
            actor,
            actionType,
            target,
            payload,
            traceId,
            identityId,
          ] as CallRecord);
          return Promise.resolve();
        },
      } as Partial<IDatabaseService> as IDatabaseService,
      memoryBank: {
        addGlobalLearning: (learning: ILearning) => {
          calls.push({ kind: "addGlobalLearning", learning });
          return Promise.resolve();
        },
      } as Partial<IMemoryBankService> as IMemoryBankService,
    });

    const pendingDir = await ensurePendingDir(config);

    const proposal = makeProposal({
      learning: makeProposalLearning({ scope: MemoryScope.GLOBAL }),
      status: MemoryStatus.PENDING,
    });

    const proposalPath = await writeProposal(pendingDir, proposal);

    await svc.approvePending(proposal.id);

    // file removed
    await assertRejects(() => Deno.stat(proposalPath));

    const globalCall = calls.find((c) => (c as { kind?: string })?.kind === "addGlobalLearning") as {
      kind: string;
      learning: ILearning;
    };
    assertExists(globalCall);
    assertEquals(globalCall.learning.status, MemoryStatus.APPROVED);
    assertExists(globalCall.learning.approved_at);
  });
});

Deno.test("MemoryExtractorService.approvePending: project proposal adds pattern (file refs only)", async () => {
  await withTempRoot(async (root) => {
    // Use explicit type for calls array, per code style
    const calls: Array<{ kind: string; project: string; pattern: { examples: string[] } }> = [];

    const { config, svc } = makeService(root, {
      db: {
        logActivity: (
          _actor: string,
          _actionType: string,
          _target: string | null,
          _payload: Record<string, JSONValue>,
          _traceId?: string,
          _identityId?: string | null,
        ): void => {},
      } as Partial<IDatabaseService> as IDatabaseService,
      memoryBank: {
        addPattern: (project: string, pattern: { examples: string[] }) => {
          calls.push({ kind: "addPattern", project, pattern });
          return Promise.resolve();
        },
      } as Partial<IMemoryBankService> as IMemoryBankService,
    });

    const pendingDir = await ensurePendingDir(config);

    const proposal = makeProposal({
      target_scope: MemoryScope.PROJECT,
      target_project: "portalA",
      learning: makeProposalLearning({
        scope: MemoryScope.PROJECT,
        project: "portalA",
        references: [
          { type: MemoryReferenceType.FILE, path: "src/a.ts" },
          { type: MemoryReferenceType.URL, path: "https://example.com" },
        ],
      }),
      status: MemoryStatus.PENDING,
    });

    await writeProposal(pendingDir, proposal);

    await svc.approvePending(proposal.id);

    const addPatternCall = calls.find((c) => c.kind === "addPattern");
    assertExists(addPatternCall);
    assertEquals(addPatternCall.project, "portalA");
    assertEquals(Array.isArray(addPatternCall.pattern.examples), true);
    assertEquals(addPatternCall.pattern.examples, ["src/a.ts"]);
  });
});

Deno.test("MemoryExtractorService.rejectPending: removes proposal file", async () => {
  await withTempRoot(async (root) => {
    const { config, svc } = makeService(root);
    const pendingDir = await ensurePendingDir(config);

    const proposal = makeProposal({ status: MemoryStatus.PENDING });
    const proposalPath = await writeProposal(pendingDir, proposal);

    await svc.rejectPending(proposal.id, "no");
    await assertRejects(() => Deno.stat(proposalPath));
  });
});

Deno.test("MemoryExtractorService.approveAll: counts only successful approvals", async () => {
  await withTempRoot(async (root) => {
    const { svc } = makeService(root);

    interface Accessor {
      listPending: () => Promise<Partial<IMemoryUpdateProposal>[]>;
      approvePending: (id: string) => Promise<void>;
    }

    (svc as Partial<Accessor> as Accessor).listPending = () =>
      Promise.resolve([
        { id: "ok" } as IMemoryUpdateProposal,
        { id: "bad" } as IMemoryUpdateProposal,
      ]);

    (svc as Partial<Accessor> as Accessor).approvePending = (id: string) => {
      if (id === "bad") throw new Error("boom");
      return Promise.resolve();
    };

    const approved = await svc.approveAll();
    assertEquals(approved, 1);
  });
});
