/**
 * @module PathSecurity
 * @path src/helpers/path_security.ts
 * @description Secure path resolution and validation utilities to prevent directory traversal.
 * @architectural-layer Helpers
 * @related-files [src/mcp/tool_handler.ts]
 */
import { join } from "@std/path";
export class PathSecurity {
  /**
   * Normalize and validate a path for security
   */
  static normalizePath(path: string): string {
    // Remove null bytes and other dangerous characters
    path = path.replace(/\0/g, "");

    // Normalize path separators and resolve . and ..
    const normalized = path
      .replace(/\\/g, "/") // Normalize separators
      .replace(/\/+/g, "/") // Remove duplicate slashes
      .split("/")
      .filter((segment) => segment !== ".") // Remove current dir references
      .join("/");

    // Detect and prevent directory traversal
    if (normalized.includes("..")) {
      throw new PathTraversalError(`Path traversal detected: ${path}`);
    }

    return normalized;
  }

  /**
   * Securely resolve a path within allowed roots
   */
  static async resolveWithinRoots(
    inputPath: string,
    allowedRoots: string[],
    rootDir: string,
  ): Promise<string> {
    // Normalize the input path
    const normalizedPath = this.normalizePath(inputPath);

    // Convert to absolute path
    const absolutePath = normalizedPath.startsWith("/") ? normalizedPath : join(rootDir, normalizedPath);

    // Get canonical real path
    let realPath: string;
    try {
      realPath = await Deno.realPath(absolutePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Find nearest existing ancestor
        let currentPath = absolutePath;
        let existingAncestor: string | null = null;

        while (currentPath !== "/" && currentPath !== ".") {
          const parent = join(currentPath, "..");
          if (parent === currentPath) break; // Root reached

          try {
            existingAncestor = await Deno.realPath(parent);
            break; // Found existing ancestor
          } catch {
            currentPath = parent;
          }
        }

        if (existingAncestor) {
          // Validate the existing ancestor is within allowed roots
          if (!this.isWithinRoots(existingAncestor, allowedRoots)) {
            throw new PathAccessError(`Path ancestor outside allowed roots: ${inputPath} -> ${existingAncestor}`);
          }
          return absolutePath; // Return unresolved path for file creation
        } else {
          // No existing ancestor found? Should at least resolve system root or baseDir.
          // If even root doesn't exist, something is wrong, but likely we failed to resolve.
          throw new PathAccessError(`Cannot resolve valid ancestor for path: ${inputPath}`);
        }
      }
      throw error;
    }

    // Validate the real path is within allowed roots
    if (!this.isWithinRoots(realPath, allowedRoots)) {
      throw new PathAccessError(`Path resolves outside allowed roots: ${inputPath} -> ${realPath}`);
    }

    return realPath;
  }

  /**
   * Check if a path is within any of the allowed roots
   */
  private static isWithinRoots(path: string, allowedRoots: string[]): boolean {
    return allowedRoots.some((root) => {
      const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedPath = path.replace(/\\/g, "/");

      // Allow exact match for root directory, or path starting with root/
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
    });
  }
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}
