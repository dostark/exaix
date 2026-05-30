/**
 * @module TestRunner
 * @path packages/portal/knowledge/test_runner.ts
 * @description Strategy 8 of PortalKnowledgeService: detects test files and
 * test counts by running `deno test --dry-run --quiet` or falling back to
 * config-based inference. Only runs in `deep` mode when enabled.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import {
  DENO_COMMAND,
  DENO_SUBCOMMAND_TEST,
  LANG_JAVASCRIPT,
  LANG_TYPESCRIPT,
  SafeSubprocess,
  TEST_RUNNER_TIMEOUT_MS,
  TestDetectionKind,
} from "@exaix/core";

export interface ITestInfo {
  testFiles: string[];
  testCount: number;
  testFramework?: string;
  detected: TestDetectionKind;
}

export class TestRunner {
  async analyze(
    portalPath: string,
    _fileList: string[],
    primaryLanguage: string,
  ): Promise<ITestInfo> {
    const lang = primaryLanguage.toLowerCase();
    if (lang !== LANG_TYPESCRIPT && lang !== LANG_JAVASCRIPT) {
      return { testFiles: [], testCount: 0, detected: TestDetectionKind.NONE };
    }

    try {
      const result = await SafeSubprocess.run(DENO_COMMAND, [DENO_SUBCOMMAND_TEST, "--dry-run", "--quiet"], {
        cwd: portalPath,
        timeoutMs: TEST_RUNNER_TIMEOUT_MS,
      });
      const testFiles = this.parseTestFiles(result.stdout + result.stderr);
      const testCount = testFiles.length;
      return {
        testFiles,
        testCount,
        testFramework: DENO_COMMAND,
        detected: testCount > 0 ? TestDetectionKind.EXECUTED : TestDetectionKind.NONE,
      };
    } catch {
      return { testFiles: [], testCount: 0, detected: TestDetectionKind.NONE };
    }
  }

  private parseTestFiles(output: string): string[] {
    const lines = output.split("\n");
    const fileSet = new Set<string>();
    for (const line of lines) {
      const match = line.match(/^(\.\/)?([^\s]+_test\.(?:ts|js|tsx))(?:\s|:)/);
      if (match) {
        fileSet.add(match[2]);
      }
    }
    return Array.from(fileSet);
  }
}
