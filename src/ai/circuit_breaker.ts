/**
 * @module CircuitBreaker
 * @path src/ai/circuit_breaker.ts
 * @description Implementation of the circuit breaker pattern for LLM providers, preventing cascading failures during service outages.
 * @architectural-layer AI
 * * @related-files [src/ai/providers.ts]
 */

import { CircuitState } from "../shared/enums.ts";
import { IModelOptions, IModelProvider } from "./types.ts";

export interface ICircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before transitioning to half-open */
  resetTimeout: number;
  /** Number of consecutive successes needed in half-open state to close circuit */
  halfOpenSuccessThreshold: number;
}

/** Error thrown when circuit is open and calls are rejected */
export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is OPEN") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Circuit breaker implementation for external service resilience
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0; // stores monotonic timestamp (performance.now()) when available
  private successCount = 0;

  constructor(private options: ICircuitBreakerOptions) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - this.lastFailureTime > this.options.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get success count (in half-open state)
   */
  getSuccessCount(): number {
    return this.successCount;
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = typeof performance !== "undefined" ? performance.now() : Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }
}

/**
 * Provider that wraps another provider with circuit breaker protection
 */
export class CircuitBreakerProvider implements IModelProvider {
  public readonly id: string;

  private circuitBreaker: CircuitBreaker;

  constructor(
    private inner: IModelProvider,
    options: ICircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      halfOpenSuccessThreshold: 2,
    },
  ) {
    this.id = `circuit-breaker-${inner.id}`;
    this.circuitBreaker = new CircuitBreaker(options);
  }

  async generate(prompt: string, options?: IModelOptions): Promise<string> {
    return await this.circuitBreaker.execute(() => this.inner.generate(prompt, options));
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.circuitBreaker.getFailureCount();
  }
}
