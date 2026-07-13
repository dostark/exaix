/**
 * @module ContextCache
 * @path packages/core/src/context/context_cache.ts
 * @description LRU context section cache for Anthropic-style cache_control support.
 * Stable sections (system prompt, portal context) are cached across execution steps
 * to reduce redundant LLM API calls and costs.
 * @architectural-layer Core
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

/**
 * A stable content section eligible for cache_control.
 */
export interface ICachedSection {
  key: string;
  content: string;
  tokens: number;
  lastUsedAt: number;
}

/** Default max entries in the context cache before LRU eviction. */
export const DEFAULT_CONTEXT_CACHE_MAX_ENTRIES = 100;

/**
 * LRU context section cache.
 * Stores stable sections (system prompt, portal context) that are reused
 * across multiple execution steps, enabling cache_control for Anthropic API.
 */
export class ContextCache {
  private readonly _maxEntries: number;
  private readonly _cache: Map<string, ICachedSection> = new Map();
  private _accessCounter = 0;

  constructor(maxEntries: number = DEFAULT_CONTEXT_CACHE_MAX_ENTRIES) {
    this._maxEntries = maxEntries;
  }

  /**
   * Mark a content section as stable by storing/updating it in the cache.
   * Touches the LRU timestamp on re-mark so frequently-used sections survive eviction.
   */
  markStable(key: string, content: string, tokens: number): void {
    const entry: ICachedSection = {
      key,
      content,
      tokens,
      lastUsedAt: ++this._accessCounter,
    };

    if (this._cache.has(key)) {
      // Update existing — touch LRU timestamp
      this._cache.set(key, entry);
      return;
    }

    // Evict LRU entry if at capacity
    if (this._cache.size >= this._maxEntries) {
      this._evictLRU();
    }

    this._cache.set(key, entry);
  }

  /**
   * Return stable sections matching the requested keys.
   */
  getStableSections(keys: string[]): ICachedSection[] {
    for (const key of keys) {
      const entry = this._cache.get(key);
      if (entry) {
        entry.lastUsedAt = ++this._accessCounter;
      }
    }
    const result: ICachedSection[] = [];
    for (const key of keys) {
      const entry = this._cache.get(key);
      if (entry) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Clear all cached entries. Called at end of execution.
   */
  invalidateAll(): void {
    this._cache.clear();
  }

  /**
   * Evict the least recently used entry.
   */
  private _evictLRU(): void {
    let lruKey: string | undefined;
    let lruTime = Infinity;

    for (const [key, entry] of this._cache) {
      if (entry.lastUsedAt < lruTime) {
        lruTime = entry.lastUsedAt;
        lruKey = key;
      }
    }

    if (lruKey) {
      this._cache.delete(lruKey);
    }
  }
}
