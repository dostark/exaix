/**
 * @module AgentStatusResolvedModel
 * @path apps/tui/src/agent_status/resolved_model.ts
 * @description Phase 132 GAP-10 — derive the resolved provider:model for an agent from
 *   the journaled `model.resolved` entries (the same event `exactl logs --filter
 *   model_resolved` surfaces). The TUI is barred from importing execution services
 *   (boundary rule), so it reads the journal event instead.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/agent_status_view.ts, packages/core/src/events/domain_event_types.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** The journal-ish shape a model.resolved entry takes at the TUI boundary. */
export interface IResolvedModelJournalEntry {
  action?: string;
  payload?: Opt<JSONValue, Reason.OptionalInput>;
}

/**
 * Extract the latest resolved provider:model string from journaled model.resolved
 * entries. `payload.selected` is the structured object the resolver emits; legacy string
 * payloads are accepted for forward/backward safety. Returns undefined when no usable
 * resolution exists for the agent.
 */
export function deriveResolvedModel(entries: IResolvedModelJournalEntry[]): string | undefined {
  const resolved = entries.filter((e) => e.action === "model.resolved").at(-1);
  if (!resolved) return undefined;
  return selectedToModelString(resolved.payload);
}

function selectedToModelString(payload: Opt<JSONValue, Reason.OptionalInput>): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const boxed = payload as Record<string, JSONValue>;
  const selected = boxed.selected;
  if (typeof selected === "string") return selected;
  if (selected !== null && typeof selected === "object" && !Array.isArray(selected)) {
    const resolved = selected as Record<string, JSONValue>;
    if (typeof resolved.provider === "string" && typeof resolved.model === "string") {
      return `${resolved.provider}:${resolved.model}`;
    }
  }
  return undefined;
}

/**
 * The agent status line for a single identity, showing the resolved provider:model when
 * the agent's declared model is empty (post-132.9 blueprints) and a journaled
 * resolution exists.
 */
export function renderResolvedModelLine(agentModel: string, journalEntries: IResolvedModelJournalEntry[]): string {
  if (agentModel) return agentModel;
  return deriveResolvedModel(journalEntries) ?? "(resolving)";
}
