/**
 * @module MemorySearch
 * @path src/services/memory_search.ts
 * @description Search implementation for memory banks, supporting query, tag, and keyword-based searches.
 * @architectural-layer Services
 * @dependencies [MemoryBankSchemas, MemoryEnums, MemoryStatus, Constants]
 * @related-files [src/services/memory_bank.ts, src/schemas/memory_bank.ts]
 */
import type {
  IExecutionMemory,
  ILearning,
  IMemorySearchResult,
  IProjectMemory,
} from "../../shared/schemas/memory_bank.ts";
import { MemoryType } from "../../shared/enums.ts";
import { MemoryStatus } from "../../shared/status/memory_status.ts";
import { DEFAULT_QUERY_LIMIT } from "../../shared/constants.ts";

export interface ISearchDeps {
  projectsDir: string;
  getProjectMemory: (portal: string) => Promise<IProjectMemory | null>;
  getExecutionHistory: (portal?: string, limit?: number) => Promise<IExecutionMemory[]>;
  loadLearningsFromFile: () => Promise<ILearning[]>;
  calculateFrequency: (text: string | undefined, keywordLower: string) => number;
  calculateRelevance: (titleFreq: number, descFreq: number) => number;
}

function matchesAnyLower(texts: string[], queryLower: string): boolean {
  return texts.some((text) => text.toLowerCase().includes(queryLower));
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.toLowerCase());
}

function includesAllTags(candidateTags: string[], requiredTags: string[]): boolean {
  const normalizedCandidateTags = normalizeTags(candidateTags);
  return requiredTags.every((t) => normalizedCandidateTags.includes(t));
}

async function collectProjectResults(
  deps: ISearchDeps,
  portal: string | undefined,
  collect: (portalName: string, projectMem: IProjectMemory) => IMemorySearchResult[],
): Promise<IMemorySearchResult[]> {
  const results: IMemorySearchResult[] = [];

  for await (const entry of Deno.readDir(deps.projectsDir)) {
    if (!entry.isDirectory) continue;
    if (portal && entry.name !== portal) continue;

    const projectMem = await deps.getProjectMemory(entry.name);
    if (!projectMem) continue;

    results.push(...collect(entry.name, projectMem));
  }

  return results;
}

function buildProjectQueryResults(
  portal: string,
  projectMem: IProjectMemory,
  queryLower: string,
): IMemorySearchResult[] {
  const results: IMemorySearchResult[] = [];

  if (projectMem.overview.toLowerCase().includes(queryLower)) {
    results.push({
      type: MemoryType.PROJECT,
      portal,
      title: `${portal} Overview`,
      summary: projectMem.overview.substring(0, 200),
      relevance_score: 0.9,
    });
  }

  for (const pattern of projectMem.patterns) {
    if (matchesAnyLower([pattern.name, pattern.description], queryLower)) {
      results.push({
        type: MemoryType.PATTERN,
        portal,
        title: pattern.name,
        summary: pattern.description,
        relevance_score: 0.8,
      });
    }
  }

  for (const decision of projectMem.decisions) {
    if (decision.decision.toLowerCase().includes(queryLower)) {
      results.push({
        type: MemoryType.DECISION,
        portal,
        title: `Decision: ${decision.date}`,
        summary: decision.decision.substring(0, 200),
        relevance_score: 0.7,
      });
    }
  }

  return results;
}

async function collectExecutionQueryResults(
  deps: ISearchDeps,
  portal: string | undefined,
  limit: number,
  queryLower: string,
): Promise<IMemorySearchResult[]> {
  const results: IMemorySearchResult[] = [];
  const executions = await deps.getExecutionHistory(portal, limit);

  for (const execution of executions) {
    if (!execution.summary.toLowerCase().includes(queryLower)) continue;

    results.push({
      type: MemoryType.EXECUTION,
      portal: execution.portal,
      title: `Execution: ${execution.trace_id.slice(0, 8)}`,
      summary: execution.summary,
      relevance_score: 0.6,
      trace_id: execution.trace_id,
    });
  }

  return results;
}

function sortAndLimit(results: IMemorySearchResult[], limit: number): IMemorySearchResult[] {
  results.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
  return results.slice(0, limit);
}

export async function searchMemory(
  query: string,
  options: { portal?: string; limit?: number } | undefined,
  deps: ISearchDeps,
): Promise<IMemorySearchResult[]> {
  const queryLower = query.toLowerCase();
  const limit = options?.limit || DEFAULT_QUERY_LIMIT;

  const results: IMemorySearchResult[] = [];
  results.push(
    ...await collectProjectResults(
      deps,
      options?.portal,
      (portalName, projectMem) => buildProjectQueryResults(portalName, projectMem, queryLower),
    ),
  );
  results.push(...await collectExecutionQueryResults(deps, options?.portal, limit, queryLower));
  return sortAndLimit(results, limit);
}

export async function searchByTags(
  tags: string[],
  options: { portal?: string; limit?: number } | undefined,
  deps: ISearchDeps,
): Promise<IMemorySearchResult[]> {
  const limit = options?.limit || DEFAULT_QUERY_LIMIT;

  const normalizedTags = tags.map((t) => t.toLowerCase());
  const results: IMemorySearchResult[] = [];
  results.push(
    ...await collectProjectResults(deps, options?.portal, (portalName, projectMem) => {
      const projectResults: IMemorySearchResult[] = [];
      for (const pattern of projectMem.patterns) {
        if (!includesAllTags(pattern.tags ?? [], normalizedTags)) continue;
        projectResults.push({
          type: MemoryType.PATTERN,
          portal: portalName,
          title: pattern.name,
          summary: pattern.description,
          relevance_score: 0.9,
          tags: pattern.tags,
        });
      }
      for (const decision of projectMem.decisions) {
        if (!includesAllTags(decision.tags ?? [], normalizedTags)) continue;
        projectResults.push({
          type: MemoryType.DECISION,
          portal: portalName,
          title: `Decision: ${decision.date}`,
          summary: decision.decision,
          relevance_score: 0.85,
          tags: decision.tags,
        });
      }
      return projectResults;
    }),
  );

  // Global learnings
  const learnings = await deps.loadLearningsFromFile();
  for (const learning of learnings) {
    if (learning.status !== MemoryStatus.APPROVED) continue;
    if (includesAllTags(learning.tags ?? [], normalizedTags)) {
      results.push({
        type: MemoryType.LEARNING,
        title: learning.title || "Untitled",
        summary: learning.description || "",
        relevance_score: 0.95,
        tags: learning.tags,
        id: learning.id,
      });
    }
  }

  return sortAndLimit(results, limit);
}

export async function searchByKeyword(
  keyword: string,
  options: { portal?: string; limit?: number } | undefined,
  deps: ISearchDeps,
): Promise<IMemorySearchResult[]> {
  const limit = options?.limit || DEFAULT_QUERY_LIMIT;
  const keywordLower = keyword.toLowerCase();

  const results: IMemorySearchResult[] = [];
  results.push(
    ...await collectProjectResults(deps, options?.portal, (portalName, projectMem) => {
      const projectResults: IMemorySearchResult[] = [];
      for (const pattern of projectMem.patterns) {
        const titleFreq = deps.calculateFrequency(pattern.name, keywordLower);
        const descFreq = deps.calculateFrequency(pattern.description, keywordLower);
        if (titleFreq === 0 && descFreq === 0) continue;

        projectResults.push({
          type: MemoryType.PATTERN,
          portal: portalName,
          title: pattern.name,
          summary: pattern.description,
          relevance_score: deps.calculateRelevance(titleFreq, descFreq),
          tags: pattern.tags,
        });
      }

      for (const decision of projectMem.decisions) {
        const titleFreq = deps.calculateFrequency(decision.decision, keywordLower);
        const descFreq = deps.calculateFrequency(decision.rationale, keywordLower);
        if (titleFreq === 0 && descFreq === 0) continue;

        projectResults.push({
          type: MemoryType.DECISION,
          portal: portalName,
          title: `Decision: ${decision.date}`,
          summary: decision.decision,
          relevance_score: deps.calculateRelevance(titleFreq, descFreq),
          tags: decision.tags,
        });
      }

      const overviewFreq = deps.calculateFrequency(projectMem.overview, keywordLower);
      if (overviewFreq > 0) {
        projectResults.push({
          type: MemoryType.PROJECT,
          portal: portalName,
          title: `${portalName} Overview`,
          summary: projectMem.overview.substring(0, 200),
          relevance_score: deps.calculateRelevance(0, overviewFreq),
        });
      }

      return projectResults;
    }),
  );

  const learnings = await deps.loadLearningsFromFile();
  for (const learning of learnings) {
    if (learning.status !== MemoryStatus.APPROVED) continue;
    const titleFreq = deps.calculateFrequency(learning.title, keywordLower);
    const descFreq = deps.calculateFrequency(learning.description, keywordLower);
    if (titleFreq === 0 && descFreq === 0) continue;
    results.push({
      type: MemoryType.LEARNING,
      title: learning.title || "Untitled",
      summary: learning.description || "",
      relevance_score: deps.calculateRelevance(titleFreq, descFreq),
      tags: learning.tags,
      id: learning.id,
    });
  }

  return sortAndLimit(results, limit);
}

export async function searchMemoryAdvanced(
  options: {
    tags?: string[];
    keyword?: string;
    portal?: string;
    limit?: number;
  },
  deps: ISearchDeps,
): Promise<IMemorySearchResult[]> {
  const limit = options.limit || DEFAULT_QUERY_LIMIT;

  const getResultKey = (r: IMemorySearchResult) => `${r.type}:${r.portal || ""}:${r.title}`;
  const byKey = new Map<string, IMemorySearchResult>();

  const upsert = (result: IMemorySearchResult, onMerge: (existing: IMemorySearchResult) => void) => {
    const key = getResultKey(result);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      return;
    }
    onMerge(existing);
  };

  if (options.tags && options.tags.length > 0) {
    const tagResults = await searchByTags(options.tags, { portal: options.portal, limit }, deps);
    for (const result of tagResults) {
      upsert(result, (existing) => {
        existing.relevance_score = (existing.relevance_score || 0) + 0.2;
      });
    }
  }

  if (options.keyword) {
    const keywordResults = await searchByKeyword(options.keyword, { portal: options.portal, limit }, deps);
    for (const result of keywordResults) {
      upsert(result, (existing) => {
        existing.relevance_score = Math.max(existing.relevance_score || 0, (result.relevance_score || 0) + 0.05);
      });
    }
  }

  return sortAndLimit(Array.from(byKey.values()), limit);
}
