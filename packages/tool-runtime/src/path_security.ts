/**
 * @module PathSecurity
 * @path packages/tool-runtime/src/path_security.ts
 * @related-files []
 * @architectural-layer Services
 * @description Secure path resolution and validation utilities for @exaix/tool-runtime.
 */

import { join } from "@std/path";
import type { IPathSecurityOps } from "./types.ts";
import { PathAccessError, PathTraversalError } from "./types.ts";

export class PathSecurity {
  /**
   * Normalize and validate a path for security.
   */
  static normalizePath(path: string): string {
    const normalized = path
      .replace(/\0/g, "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .split("/")
      .filter((segment) => segment !== ".")
      .join("/");

    if (normalized.includes("..")) {
      throw new PathTraversalError(`Path traversal detected: ${path}`);
    }

    return normalized;
  }

  /**
   * Securely resolve a path within allowed roots.
   */
  static async resolveWithinRoots(
    inputPath: string,
    allowedRoots: string[],
    rootDir: string,
  ): Promise<string> {
    const normalizedPath = this.normalizePath(inputPath);
    const absolutePath = normalizedPath.startsWith("/") ? normalizedPath : join(rootDir, normalizedPath);

    let realPath: string;
    try {
      realPath = await Deno.realPath(absolutePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        let currentPath = absolutePath;
        let existingAncestor: string | null = null;

        while (currentPath !== "/" && currentPath !== ".") {
          const parent = join(currentPath, "..");
          if (parent === currentPath) {
            break;
          }

          try {
            existingAncestor = await Deno.realPath(parent);
            break;
          } catch {
            currentPath = parent;
          }
        }

        if (existingAncestor) {
          if (!this.isWithinRoots(existingAncestor, allowedRoots)) {
            throw new PathAccessError(
              `Path ancestor outside allowed roots: ${inputPath} -> ${existingAncestor}`,
            );
          }
          return absolutePath;
        }

        throw new PathAccessError(`Cannot resolve valid ancestor for path: ${inputPath}`);
      }
      throw error;
    }

    if (!this.isWithinRoots(realPath, allowedRoots)) {
      throw new PathAccessError(`Path resolves outside allowed roots: ${inputPath} -> ${realPath}`);
    }

    return realPath;
  }

  private static isWithinRoots(path: string, allowedRoots: string[]): boolean {
    return allowedRoots.some((root) => {
      const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedPath = path.replace(/\\/g, "/");
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
    });
  }
}

export function createPathSecurity(): IPathSecurityOps {
  return {
    resolveWithinRoots: PathSecurity.resolveWithinRoots.bind(PathSecurity),
  };
}
