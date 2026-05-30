/**
 * @module GitHistoryAnalyzer
 * @path packages/portal/knowledge/git_history_analyzer.ts
 * @description Strategy 11 of PortalKnowledgeService: analyzes git history
 * to extract commit cadence, author stats, change hotspots, and determine
 * whether the project has sufficient git history for meaningful analysis.
 * Uses SafeSubprocess for git queries.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { GIT_HISTORY_COMMIT_LIMIT, GIT_HISTORY_SINCE, GIT_HISTORY_TIMEOUT_MS, SafeSubprocess } from "@exaix/core";

export interface IGitHotspot {
  file: string;
  commitCount: number;
}

export interface IGitAuthorStats {
  name: string;
  commitCount: number;
  percentage: number;
}

export interface IGitHistoryResult {
  totalCommits: number;
  totalAuthors: number;
  hasSufficientHistory: boolean;
  topChangedFiles?: IGitHotspot[];
  topAuthors?: IGitAuthorStats[];
  hotspots?: IGitHotspot[];
}

export class GitHistoryAnalyzer {
  async analyze(
    portalPath: string,
    commitLimit: number = GIT_HISTORY_COMMIT_LIMIT,
    since: string = GIT_HISTORY_SINCE,
  ): Promise<IGitHistoryResult> {
    try {
      const totalCommits = await this.countCommits(portalPath, since);
      const authorStats = await this.getAuthorStats(portalPath, commitLimit, since);
      const hotspots = await this.getHotspots(portalPath, commitLimit, since);

      const topAuthors = authorStats.slice(0, 10);
      const totalAuthorCount = authorStats.length;
      const hasSufficientHistory = totalCommits >= 50;

      return {
        totalCommits,
        totalAuthors: totalAuthorCount,
        hasSufficientHistory,
        topChangedFiles: hotspots.slice(0, 15),
        topAuthors: topAuthors.map((a) => ({
          name: a.name,
          commitCount: a.commitCount,
          percentage: totalCommits > 0 ? Math.round((a.commitCount / totalCommits) * 100) : 0,
        })),
        hotspots: hotspots.slice(0, 10),
      };
    } catch {
      return {
        totalCommits: 0,
        totalAuthors: 0,
        hasSufficientHistory: false,
      };
    }
  }

  private async countCommits(portalPath: string, since: string): Promise<number> {
    const result = await SafeSubprocess.run("git", [
      "rev-list",
      "--count",
      `--since=${since}`,
      "HEAD",
    ], { cwd: portalPath, timeoutMs: GIT_HISTORY_TIMEOUT_MS });
    return parseInt(result.stdout.trim(), 10) || 0;
  }

  private async getAuthorStats(
    portalPath: string,
    _commitLimit: number,
    since: string,
  ): Promise<Array<{ name: string; commitCount: number }>> {
    const result = await SafeSubprocess.run("git", [
      "log",
      "--format=%an",
      `--since=${since}`,
    ], { cwd: portalPath, timeoutMs: GIT_HISTORY_TIMEOUT_MS });
    return this.parseLogAuthors(result.stdout);
  }

  private async getHotspots(
    portalPath: string,
    _commitLimit: number,
    since: string,
  ): Promise<Array<{ file: string; commitCount: number }>> {
    const result = await SafeSubprocess.run("git", [
      "log",
      `--since=${since}`,
      "--name-only",
      "--pretty=format:",
    ], { cwd: portalPath, timeoutMs: GIT_HISTORY_TIMEOUT_MS });
    return this.parseFileFrequencies(result.stdout);
  }

  private parseLogAuthors(output: string): Array<{ name: string; commitCount: number }> {
    const lines = output.trim().split("\n").filter(Boolean);
    const freqMap = new Map<string, number>();
    for (const line of lines) {
      const name = line.trim();
      if (name) {
        freqMap.set(name, (freqMap.get(name) || 0) + 1);
      }
    }
    return Array.from(freqMap.entries())
      .map(([name, commitCount]) => ({ name, commitCount }))
      .sort((a, b) => b.commitCount - a.commitCount);
  }

  private parseFileFrequencies(output: string): Array<{ file: string; commitCount: number }> {
    const files = output.trim().split("\n").filter(Boolean);
    const freqMap = new Map<string, number>();
    for (const f of files) {
      const trimmed = f.trim();
      if (trimmed) {
        freqMap.set(trimmed, (freqMap.get(trimmed) || 0) + 1);
      }
    }
    return Array.from(freqMap.entries())
      .map(([file, commitCount]) => ({ file, commitCount }))
      .sort((a, b) => b.commitCount - a.commitCount);
  }
}
