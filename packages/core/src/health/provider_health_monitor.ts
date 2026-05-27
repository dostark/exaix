/**
 * @module ProviderHealthMonitor
 * @path packages/core/src/health/provider_health_monitor.ts
 * @description Background polling loop for per-provider health checks.
 * Periodically calls HealthCheckService.checkProvider() for registered
 * providers and tracks status, last check time, and consecutive failures.
 * @architectural-layer Services
 * @related-files ["packages/core/src/health/health_check_service.ts"]
 */

import type { HealthCheckService } from "./health_check_service.ts";

export enum ProviderHealthVerdict {
  HEALTHY = "healthy",
  UNHEALTHY = "unhealthy",
  UNKNOWN = "unknown",
}

export interface IProviderHealthStatus {
  status: ProviderHealthVerdict;
  lastCheck: number | null;
  consecutiveFailures: number;
}

export class ProviderHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly statuses = new Map<string, IProviderHealthStatus>();

  constructor(
    private readonly healthService: HealthCheckService,
    private readonly providerNames: string[],
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getProviderStatuses(): Record<string, IProviderHealthStatus> {
    const result: Record<string, IProviderHealthStatus> = {};
    for (const name of this.providerNames) {
      result[name] = this.statuses.get(name) ?? {
        status: ProviderHealthVerdict.UNKNOWN,
        lastCheck: null,
        consecutiveFailures: 0,
      };
    }
    return result;
  }

  async pollOnce(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    for (const name of this.providerNames) {
      try {
        const healthy = await this.healthService.checkProvider(name);
        const existing = this.statuses.get(name) ?? {
          status: ProviderHealthVerdict.UNKNOWN,
          lastCheck: null,
          consecutiveFailures: 0,
        };
        this.statuses.set(name, {
          status: healthy ? ProviderHealthVerdict.HEALTHY : ProviderHealthVerdict.UNHEALTHY,
          lastCheck: Date.now(),
          consecutiveFailures: healthy ? 0 : existing.consecutiveFailures + 1,
        });
      } catch {
        const existing = this.statuses.get(name) ?? {
          status: ProviderHealthVerdict.UNKNOWN,
          lastCheck: null,
          consecutiveFailures: 0,
        };
        this.statuses.set(name, {
          status: ProviderHealthVerdict.UNHEALTHY,
          lastCheck: Date.now(),
          consecutiveFailures: existing.consecutiveFailures + 1,
        });
      }
    }
  }
}
