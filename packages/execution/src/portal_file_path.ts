/**
 * @module PortalFilePath
 * @path packages/execution/src/portal_file_path.ts
 * @description Validates a file path against path traversal and injection before git touches it.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/git_audit_service.ts, packages/execution/tests/git_audit_service_test.ts]
 */

import { join } from "@std/path";

/**
 * Normalize and pre-validate a file path for security.
 */
function normalizeAndPreValidate(filePath: string): string | null {
  if (filePath.startsWith("/")) return null;
  if (filePath.startsWith("../")) return null;
  if (filePath.includes("..")) return null;

  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.includes("..")) return null;

  const decodedPath = decodeURIComponent(normalizedPath);
  if (decodedPath !== normalizedPath) return null;

  return normalizedPath;
}

/** Returns the validated path, or null when it could allow path traversal or injection. */
export function validatePortalFilePath(filePath: string, portalPath: string): string | null {
  const normalizedPath = normalizeAndPreValidate(filePath);
  if (!normalizedPath) return null;

  const combinedPath = join(portalPath, normalizedPath);
  try {
    const resolved = Deno.realPathSync(combinedPath);
    if (!resolved.startsWith(portalPath)) {
      return null;
    }
    return normalizedPath;
  } catch {
    return null;
  }
}
