/**
 * @module Health
 * @path packages/core/src/health/mod.ts
 * @related-files []
 * @architectural-layer Core
 * @description Health check service barrel.
 */

export { handleHealthCheck, HealthCheckService } from "./health_check_service.ts";
export type { IHealthCheck } from "./health_check_service.ts";
