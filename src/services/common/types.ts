/**
 * @module CommonTypesShim
 * @path src/services/common/types.ts
 * @description Compatibility shim for shared service context types now owned by @exaix/core.
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/service_context.ts"]
 */

import type * as ServiceContextTypes from "@exaix/core/types/service_context.ts";

export type IServiceContext = ServiceContextTypes.IServiceContext;
