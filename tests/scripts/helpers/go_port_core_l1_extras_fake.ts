/**
 * @module GoPortCoreL1ExtrasFake
 * @path tests/scripts/helpers/go_port_core_l1_extras_fake.ts
 * @description Provides deterministic kept TOML, allocator and card cases without the pinned services.
 * @architectural-layer Test
 */
import type { ICoreL1ExtraCase, TExtraRunner } from "../../../scripts/go_port/core_l1_case_reference.ts";

const CREATED = "2026-11-26T00:00:00.000Z";
const CARD = "# Portal: live-portal\n- **Path**: `Portals/live`\n- **Tech Stack**: Go, Deno\n\n## User Notes\n\n";

/** Returns the same three extra cases on every run. */
export const fakeExtraRunner: TExtraRunner = (
  _snapshot: string,
): Promise<readonly ICoreL1ExtraCase[]> =>
  Promise.resolve<ICoreL1ExtraCase[]>([
    {
      id: "config-toml-writes",
      operation: "config-writes",
      seed: [],
      request: { steps: [{ kind: "ensure" }, { kind: "update", entry: { alias: "live-portal" }, created: CREATED }] },
      result: { steps: [{ kind: "ensure", outcome: "created" }, { kind: "update", outcome: "updated" }] },
      after: { "exa.config.toml": "0".repeat(64) },
    },
    {
      id: "prompt-budget-enforced",
      operation: "prompt-budget",
      seed: [],
      request: { model: "anthropic:model-a", input: {} },
      result: { ok: true },
      after: {},
    },
    {
      id: "prompt-budget-disabled",
      operation: "prompt-budget",
      seed: [],
      request: { model: "anthropic:model-a", input: {} },
      result: { ok: true },
      after: {},
    },
    {
      id: "context-card-notes",
      operation: "context-card",
      seed: [],
      request: { portal: { portal_id: "portal-1", alias: "live-portal" }, notes: "notes" },
      result: { outcomes: ["context_card.created", "context_card.updated"], cards: [CARD, CARD] },
      after: { "Memory/Projects/live-portal/portal.md": "0".repeat(64) },
    },
  ]);
