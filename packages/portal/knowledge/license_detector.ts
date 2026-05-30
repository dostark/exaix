/**
 * @module LicenseDetector
 * @path packages/portal/knowledge/license_detector.ts
 * @description Strategy 9 of PortalKnowledgeService: detects project licenses
 * from LICENSE files, package.json/license field, and SPDX headers in source
 * files. File-system only — no network calls. Runs in standard/deep modes.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { ConfidenceLevel, LicenseSource } from "@exaix/core";

export interface ILicenseInfo {
  type: string;
  source: LicenseSource;
  filePath?: string;
  confidence: ConfidenceLevel;
}

const LICENSE_FILE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "LICENSE-APACHE"];

const LICENSE_KEYWORDS: Record<string, Array<{ pattern: RegExp; confidence: ConfidenceLevel }>> = {
  "MIT": [
    { pattern: /MIT License/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /Permission is hereby granted, free of charge/i, confidence: ConfidenceLevel.HIGH },
  ],
  "Apache-2.0": [
    { pattern: /Apache License, Version 2\.0/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /Licensed under the Apache License, Version 2\.0/i, confidence: ConfidenceLevel.HIGH },
  ],
  "GPL-3.0": [
    { pattern: /GNU General Public License.*3/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /GPL-3\.0/i, confidence: ConfidenceLevel.HIGH },
  ],
  "BSD": [
    { pattern: /BSD (2|3)-Clause/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /Redistributions of source code must retain the above copyright/i, confidence: ConfidenceLevel.MEDIUM },
  ],
  "MPL-2.0": [
    { pattern: /Mozilla Public License, Version 2\.0/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /MPL-2\.0/i, confidence: ConfidenceLevel.HIGH },
  ],
  "LGPL": [
    { pattern: /GNU Lesser General Public License/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /LGPL/i, confidence: ConfidenceLevel.MEDIUM },
  ],
  "AGPL": [
    { pattern: /GNU Affero General Public License/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /AGPL/i, confidence: ConfidenceLevel.MEDIUM },
  ],
  "Unlicense": [
    { pattern: /This is free and unencumbered software/i, confidence: ConfidenceLevel.HIGH },
    { pattern: /Unlicense/i, confidence: ConfidenceLevel.HIGH },
  ],
};

export class LicenseDetector {
  async analyze(
    portalPath: string,
    fileList: string[],
  ): Promise<ILicenseInfo[]> {
    const licenses: ILicenseInfo[] = [];

    // Layer 1: LICENSE files
    for (const licenseFile of LICENSE_FILE_NAMES) {
      const fullPath = `${portalPath}/${licenseFile}`;
      try {
        const content = await Deno.readTextFile(fullPath);
        const detected = this.detectLicenseFromContent(content, fullPath);
        if (detected) licenses.push(detected);
      } catch {
        continue;
      }
    }

    // Layer 2: SPDX headers in source files (sample up to 20)
    const sourceFiles = fileList
      .filter((f) =>
        f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".tsx") || f.endsWith(".rs") || f.endsWith(".py") ||
        f.endsWith(".go")
      )
      .slice(0, 20);
    for (const sf of sourceFiles) {
      try {
        const content = await Deno.readTextFile(`${portalPath}/${sf}`);
        const header = content.slice(0, 2048);
        const match = header.match(/SPDX-License-Identifier:\s*(\S+)/);
        if (match) {
          licenses.push({
            type: match[1],
            source: LicenseSource.SPDX,
            filePath: sf,
            confidence: ConfidenceLevel.HIGH,
          });
        }
      } catch {
        continue;
      }
    }

    return licenses;
  }

  detectLicenseFromContent(content: string, _sourcePath: string): ILicenseInfo | null {
    for (const [licenseType, patterns] of Object.entries(LICENSE_KEYWORDS)) {
      for (const { pattern, confidence: patConf } of patterns) {
        if (pattern.test(content)) {
          return { type: licenseType, source: LicenseSource.FILE, confidence: patConf };
        }
      }
    }
    return null;
  }
}
