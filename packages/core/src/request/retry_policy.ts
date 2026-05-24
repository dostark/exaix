/**
 * @module RetryPolicy
 * @path packages/core/src/request/retry_policy.ts
 * @description Configurable retry system with exponential backoff and jitter.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retry conditions (by error type)
 * - Temperature adjustment on retry
 * - IActivity logging for retry attempts
 *
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/storage-sqlite/src/database_service.ts"]
 */

import { z } from "zod";

export interface IRetryContext {
  attempt: number;
  elapsedMs: number;
  error: Error;
  delayMs: number;
  temperature: number;
}

export interface IRetryableOperationOptions {
  baseTemperature?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export type RetryAttempt = {
  attempt: number;
  error: string;
  errorType: string;
  delayMs: number;
  temperature: number;
  timestamp: string;
};

export interface IRetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  totalAttempts: number;
  totalTimeMs: number;
  retryHistory: RetryAttempt[];
}

export type RetryEventCallback = (context: IRetryContext) => void;

export interface IRetryPolicy {
  execute<T>(
    operation: (context: { temperature: number; attempt: number }) => Promise<T>,
    options?: IRetryableOperationOptions,
  ): Promise<IRetryResult<T>>;
  calculateDelay(attempt: number): number;
  isRetryable(error: Error): boolean;
  setOnRetry(callback: RetryEventCallback): this;
}

/** Error types that should trigger a retry. */
export const RETRYABLE_ERROR_TYPES: string[] = [
  "NetworkError",
  "TimeoutError",
  "RateLimitError",
  "InternalServerError",
  "ServiceUnavailableError",
  "GatewayTimeoutError",
];

/** HTTP status codes that should trigger a retry. */
export const RETRYABLE_HTTP_STATUS_CODES: string[] = [
  "429",
  "500",
  "502",
  "503",
  "504",
];

/** Error message patterns that should trigger a retry. */
export const RETRYABLE_MESSAGE_PATTERNS: string[] = [
  "rate limit",
  "timeout",
  "network",
  "connection reset",
  "socket hang up",
  "try again",
  "temporarily unavailable",
  "server error",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
];

// ============================================================================
// Configuration Schema
// ============================================================================

const DEFAULT_RETRY_POLICY_MAX_DELAY_MS = 30000;

/**
 * Zod schema for retry policy configuration
 */
export const RetryPolicyConfigSchema = z.object({
  /** Maximum number of retry attempts (excluding initial attempt) */
  maxRetries: z.number().min(0).max(10).default(3),

  /** Initial delay in milliseconds before first retry */
  initialDelayMs: z.number().min(1).max(60000).default(1000),

  /** Maximum delay in milliseconds (caps exponential growth) */
  maxDelayMs: z.number().min(1).max(300000).default(DEFAULT_RETRY_POLICY_MAX_DELAY_MS),

  /** Backoff multiplier (2 = double each time) */
  backoffMultiplier: z.number().min(1).max(5).default(2),

  /** Jitter factor (0-1, randomness added to delay) */
  jitterFactor: z.number().min(0).max(1).default(0.1),

  /** Error types that should trigger retry */
  retryableErrors: z.array(z.string()).default([...RETRYABLE_ERROR_TYPES]),

  /** Temperature increase per retry (0 = no change) */
  temperatureIncrement: z.number().min(0).max(0.5).default(0.1),

  /** Maximum temperature (caps temperature growth) */
  maxTemperature: z.number().min(0).max(2).default(1.0),
});

export type IRetryPolicyConfig = z.infer<typeof RetryPolicyConfigSchema>;

// ============================================================================
// RetryPolicy Class
// ============================================================================

/**
 * RetryPolicy implements exponential backoff with jitter
 *
 * Usage:
 * ```typescript
 * const policy = new RetryPolicy({ maxRetries: 3 });
 * const result = await policy.execute(async (ctx) => {
 *   return await llmProvider.generate(prompt, { temperature: ctx.temperature });
 * });
 * ```
 */
export class RetryPolicy implements IRetryPolicy {
  private config: IRetryPolicyConfig;
  private onRetry?: RetryEventCallback;

  constructor(config?: Partial<IRetryPolicyConfig>) {
    this.config = RetryPolicyConfigSchema.parse(config || {});
  }

  /**
   * Set callback for retry events
   */
  setOnRetry(callback: RetryEventCallback): this {
    this.onRetry = callback;
    return this;
  }

  /**
   * Execute an operation with retry logic
   *
   * @param operation - Function to execute, receives retry context
   * @param options - Optional operation-specific settings
   * @returns IRetryResult with success/failure details
   */
  async execute<T>(
    operation: (context: { temperature: number; attempt: number }) => Promise<T>,
    options?: IRetryableOperationOptions,
  ): Promise<IRetryResult<T>> {
    const startTime = Date.now();
    const maxRetries = options?.maxRetries ?? this.config.maxRetries;
    const baseTemperature = options?.baseTemperature ?? 0.7;
    const retryHistory: RetryAttempt[] = [];

    let lastError: Error | undefined;
    let currentTemperature = baseTemperature;

    // Initial attempt (attempt 0)
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check for abort signal
      if (options?.signal?.aborted) {
        return {
          success: false,
          error: new Error("Operation aborted"),
          totalAttempts: attempt,
          totalTimeMs: Date.now() - startTime,
          retryHistory,
        };
      }

      try {
        const value = await operation({
          temperature: currentTemperature,
          attempt,
        });

        return {
          success: true,
          value,
          totalAttempts: attempt + 1,
          totalTimeMs: Date.now() - startTime,
          retryHistory,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const errorType = lastError.constructor.name;
        const delayMs = attempt === 0 ? 0 : this.calculateDelay(attempt);

        retryHistory.push({
          attempt,
          error: lastError.message,
          errorType,
          delayMs,
          temperature: currentTemperature,
          timestamp: new Date().toISOString(),
        });

        // Check if error is retryable
        if (!this.isRetryable(lastError)) {
          return {
            success: false,
            error: lastError,
            totalAttempts: attempt + 1,
            totalTimeMs: Date.now() - startTime,
            retryHistory,
          };
        }

        // If we have more retries, wait and adjust temperature
        if (attempt < maxRetries) {
          const nextDelay = this.calculateDelay(attempt + 1);

          // Notify retry callback
          if (this.onRetry) {
            this.onRetry({
              attempt: attempt + 1,
              elapsedMs: Date.now() - startTime,
              error: lastError,
              delayMs: nextDelay,
              temperature: currentTemperature,
            });
          }

          // Wait before retry
          await this.delay(nextDelay);

          // Adjust temperature
          currentTemperature = Math.min(
            currentTemperature + this.config.temperatureIncrement,
            this.config.maxTemperature,
          );
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError,
      totalAttempts: maxRetries + 1,
      totalTimeMs: Date.now() - startTime,
      retryHistory,
    };
  }

  /**
   * Calculate delay for a given attempt using exponential backoff with jitter
   */
  calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    const exponentialDelay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter (randomness)
    const jitter = cappedDelay * this.config.jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Check if an error should trigger a retry
   */
  isRetryable(error: Error): boolean {
    const errorType = error.constructor.name;
    const errorMessage = error.message.toLowerCase();

    // Check by error type name
    if (this.config.retryableErrors.includes(errorType)) {
      return true;
    }

    // Check by message patterns
    const isPatternMatch = RETRYABLE_MESSAGE_PATTERNS.some((pattern) => errorMessage.includes(pattern));
    if (isPatternMatch) return true;

    // Check by HTTP status code patterns
    return RETRYABLE_HTTP_STATUS_CODES.some((code) => errorMessage.includes(code));
  }

  /**
   * Async delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): IRetryPolicyConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a RetryPolicy with default configuration
 */
export function createRetryPolicy(config?: Partial<IRetryPolicyConfig>): RetryPolicy {
  return new RetryPolicy(config);
}

/**
 * Create a RetryPolicy optimized for LLM operations
 */
export function createLLMRetryPolicy(): RetryPolicy {
  return new RetryPolicy({
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: DEFAULT_RETRY_POLICY_MAX_DELAY_MS,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    temperatureIncrement: 0.1,
    maxTemperature: 1.2,
  });
}

/**
 * Create a RetryPolicy optimized for API calls
 */
export function createAPIRetryPolicy(): RetryPolicy {
  return new RetryPolicy({
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    temperatureIncrement: 0,
    maxTemperature: 0,
  });
}
