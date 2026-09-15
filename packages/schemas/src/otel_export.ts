/**
 * @module OtelExportSchemas
 * @path packages/schemas/src/otel_export.ts
 * @description Strict privacy-safe schemas for OTel export lifecycle audit events.
 * @architectural-layer Schemas
 * @dependencies [zod]
 * @related-files [packages/core/src/events/domain_event_types.ts]
 */

import { z } from "zod";

const DestinationSchema = z.object({
  destination_scheme: z.enum(["http", "https"]),
  destination_host: z.string().min(1).max(253),
  destination_port: z.number().int().min(1).max(65_535),
  record_count: z.number().int().nonnegative(),
}).strict();

export const OtelExportStartedPayloadSchema = DestinationSchema;
export const OtelExportCompletedPayloadSchema = DestinationSchema.extend({
  span_count: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
  retry_count: z.number().int().nonnegative(),
}).strict();
export const OtelExportFailedPayloadSchema = DestinationSchema.extend({
  duration_ms: z.number().nonnegative(),
  error_code: z.string().min(1).max(128),
  retry_count: z.number().int().nonnegative(),
}).strict();

export type IOtelExportStartedPayload = z.infer<typeof OtelExportStartedPayloadSchema>;
export type IOtelExportCompletedPayload = z.infer<typeof OtelExportCompletedPayloadSchema>;
export type IOtelExportFailedPayload = z.infer<typeof OtelExportFailedPayloadSchema>;
