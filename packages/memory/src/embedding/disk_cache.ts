/**
 * @module DiskBackedEmbeddingCache
 * @path packages/memory/src/embedding/disk_cache.ts
 * @description Filesystem-backed LRU cache for embedding vectors. Uses
 * SHA-256 content hashes as keys and persists entries as a single JSON
 * file. Replaces the old in-memory-only EmbeddingLruCache.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [packages/memory/src/embedding/provider_embedding_service.ts]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";

const CACHE_FILENAME = "cache.json";
const DEFAULT_MAX_ENTRIES = 512;

interface ISerializedEntry {
  hash: string;
  vector: number[];
  lastAccess: number;
}

export class DiskBackedEmbeddingCache {
  private entries = new Map<string, { vector: number[]; lastAccess: number }>();
  private accessCounter = 0;
  private maxEntries: number;
  private cacheDir: string;
  private cacheFile: string;
  private initialized = false;

  constructor(cacheDir: string, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.cacheDir = cacheDir;
    this.cacheFile = join(cacheDir, CACHE_FILENAME);
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  async init(): Promise<void> {
    await ensureDir(this.cacheDir);
    if (await exists(this.cacheFile)) {
      const content = await Deno.readTextFile(this.cacheFile);
      const data: ISerializedEntry[] = JSON.parse(content);
      for (const entry of data) {
        this.entries.set(entry.hash, {
          vector: entry.vector,
          lastAccess: entry.lastAccess,
        });
        if (entry.lastAccess > this.accessCounter) {
          this.accessCounter = entry.lastAccess;
        }
      }
    }
    this.initialized = true;
  }

  get(key: string): number[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastAccess = ++this.accessCounter;
    return entry.vector;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  async set(key: string, value: number[]): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.vector = value;
      existing.lastAccess = ++this.accessCounter;
    } else {
      if (this.entries.size >= this.maxEntries) {
        this.evictLru();
      }
      this.entries.set(key, {
        vector: value,
        lastAccess: ++this.accessCounter,
      });
    }
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries.clear();
    await this.persist();
  }

  private evictLru(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
    }
  }

  private async persist(): Promise<void> {
    const data: ISerializedEntry[] = [];
    for (const [hash, entry] of this.entries) {
      data.push({ hash, vector: entry.vector, lastAccess: entry.lastAccess });
    }
    const tmpPath = this.cacheFile + ".tmp";
    await Deno.writeTextFile(tmpPath, JSON.stringify(data));
    await Deno.rename(tmpPath, this.cacheFile);
  }
}

export async function computeTextHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
