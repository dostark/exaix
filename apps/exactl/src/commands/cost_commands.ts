/**
 * @module CostCommands
 * @path apps/exactl/src/commands/cost_commands.ts
 * @description CLI command handler for LLM cost and token usage reporting. It returns the records and the grouped totals, and the log builder renders them.
 * @architectural-layer CLI
 * @related-files [packages/core/src/cost/cost_tracker.ts, apps/exactl/src/exactl.ts]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { PERCENT_SCALE } from "@exaix/core";
import {
  COST_SOURCE_ESTIMATE,
  CostGroupBy,
  type ICostFilter,
  type ICostTracker,
  type IGroupedCostRecord,
  type IProviderCostRecord,
} from "@exaix/core/types";

export interface ICostCommandOptions {
  trace?: string;
  portal?: string;
  since?: string;
  model?: string;
  groupBy?: string;
}

/** The cost report of one query: the records, or the grouped totals when a group was asked for. */
export interface ICostReport {
  records: IProviderCostRecord[];
  groups?: IGroupedCostRecord[];
  groupBy?: CostGroupBy;
}

/** The decimals of a source share, in percent. */
const COST_SHARE_DECIMALS = 1;

/** The share of each source in the priced cost of a group, in percent. A group with no priced cost has no share. */
export function costShares(group: IGroupedCostRecord): Record<string, number> | null {
  const total = Object.values(group.costBySource).reduce((sum, cost) => sum + cost, 0);
  if (total <= 0) return null;
  const shares: Record<string, number> = {};
  for (const [source, cost] of Object.entries(group.costBySource)) {
    shares[source] = Number(((cost / total) * PERCENT_SCALE).toFixed(COST_SHARE_DECIMALS));
  }
  return shares;
}

/** The source shown for a record: the stored source, or the estimate for the legacy blended rate. */
export function recordCostSource(record: IProviderCostRecord): string {
  return record.costSource ?? COST_SOURCE_ESTIMATE;
}

const UNKNOWN_COST_LABEL = "unknown";
const COST_PRECISION = 6;

/** The cost as dollars with six decimals, or "unknown" for a call that has no price. */
export function formatCost(cost: number | null): string {
  return cost === null ? UNKNOWN_COST_LABEL : `$${cost.toFixed(COST_PRECISION)}`;
}

/** The total lines of a record report: the cost, the tokens and the cache tokens when there are any. */
export function costTotals(records: readonly IProviderCostRecord[]): string[] {
  const sum = (pick: (record: IProviderCostRecord) => number): number =>
    records.reduce((total, record) => total + pick(record), 0);
  const knownCost = sum((record) => record.estimatedCostUsd ?? 0);
  const costLabel = records.some((record) => record.estimatedCostUsd === null)
    ? `${UNKNOWN_COST_LABEL} (known subtotal ${formatCost(knownCost)})`
    : formatCost(knownCost);
  const prompt = sum((record) => record.promptTokens);
  const completion = sum((record) => record.completionTokens);
  const lines = [
    `Total Cost:    ${costLabel}`,
    `Total Tokens:  ${sum((record) => record.tokens)} (Prompt: ${prompt}, Completion: ${completion})`,
  ];
  const cacheRead = sum((record) => record.cacheReadTokens ?? 0);
  const cacheCreation = sum((record) => record.cacheCreationTokens ?? 0);
  if (cacheRead > 0 || cacheCreation > 0) {
    lines.push(`Total Cache Tokens:  Read: ${cacheRead}, Creation: ${cacheCreation}`);
  }
  return lines;
}

const GROUPS: readonly string[] = [CostGroupBy.MODEL, CostGroupBy.PORTAL, CostGroupBy.SERVICE];

/**
 * CostCommands provides CLI access to LLM cost and token usage reports.
 */
export class CostCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  private get costTracker(): ICostTracker {
    return this.cost;
  }

  /** The cost records that match the options, or their grouped totals. */
  async report(options: ICostCommandOptions): Promise<ICostReport> {
    if (options.groupBy === CostGroupBy.ROLE) {
      throw new Error("Role cost grouping is not available in this build: generation calls have no role attribution.");
    }
    if (options.groupBy && !GROUPS.includes(options.groupBy)) {
      throw new Error(`Invalid cost group: ${options.groupBy}. Use model, portal or service.`);
    }
    const sinceDate = options.since ? new Date(options.since) : undefined;
    if (options.since && Number.isNaN(sinceDate?.getTime())) {
      throw new Error("Invalid --since date. Use an ISO date.");
    }

    const criteria: ICostFilter = {
      traceId: options.trace,
      portal: options.portal,
      since: sinceDate,
      model: options.model,
    };

    if (options.groupBy) {
      const tracker = this.costTracker;
      if (!tracker.queryGroupedByCriteria) {
        throw new Error("Grouped cost reporting is not available in this build.");
      }
      const groupBy = options.groupBy as CostGroupBy;
      return { records: [], groups: await tracker.queryGroupedByCriteria(criteria, groupBy), groupBy };
    }
    return { records: await this.costTracker.queryByCriteria(criteria) };
  }
}
