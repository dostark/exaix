/**
 * @module RoutingPolicySchema
 * @path packages/schemas/src/routing_policy.ts
 * @description Defines Zod schemas and inferred types for the routing policy layer.
 * @architectural-layer Shared
 * @related-files [packages/routing/src/routing_policy_loader.ts]
 */

import type { IRequestAnalysis } from "./request_analysis.ts";
import { z } from "zod";

export interface IRoutingContext {
  explicitIdentityId?: string;
  explicitVersion?: string;
  requestText?: string;
  requestAnalysis?: IRequestAnalysis;
  portalName?: string;
  flowStepId?: string;
  matchCriteria?: IRoutingMatchCriteria;
  traceId?: string;
  allowDynamicRouting?: boolean;
}

export const ZRoutingMatchCriteria = z.object({
  capability: z.string().min(1).optional(),
  complexityMin: z.number().min(0).max(10).optional(),
  complexityMax: z.number().min(0).max(10).optional(),
  language: z.string().min(1).optional(),
  taskType: z.string().min(1).optional(),
  portalType: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  /** Request body text for NL-based matching against description/routing_hint. */
  requestText: z.string().optional(),
});

export type IRoutingMatchCriteria = z.infer<typeof ZRoutingMatchCriteria>;

export const ZRoutingPreference = z.object({
  identityId: z.string().min(1),
  version: z.string().min(1).optional(),
  fallbackIdentityId: z.string().min(1).optional(),
  fallbackVersion: z.string().min(1).optional(),
  trafficSplit: z.number().min(0).max(1).optional(),
  enabled: z.boolean().default(true),
});

export type IRoutingPreference = z.infer<typeof ZRoutingPreference>;

export const ZRoutingRule = z.object({
  ruleId: z.string().min(1),
  priority: z.number().int().min(0).default(100),
  match: ZRoutingMatchCriteria,
  prefer: ZRoutingPreference,
});

export type IRoutingRule = z.infer<typeof ZRoutingRule>;

export const ZRoutingPolicy = z.object({
  version: z.string().default("1.0"),
  rules: z.array(ZRoutingRule).default([]),
  defaultMode: z.enum(["static", "capability_first", "policy_first"]).default(
    "policy_first",
  ),
  allowExperiments: z.boolean().default(false),
});

export type IRoutingPolicy = z.infer<typeof ZRoutingPolicy>;

export const ZRoutingCandidate = z.object({
  identityId: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  score: z.number().default(0),
  preferLocal: z.boolean().optional(),
  scoreBreakdown: z.object({
    capabilityScore: z.number().default(0),
    policyScore: z.number().default(0),
    journalScore: z.number().default(0),
    experimentScore: z.number().default(0),
  }).default({
    capabilityScore: 0,
    policyScore: 0,
    journalScore: 0,
    experimentScore: 0,
  }),
});

export type IRoutingCandidate = z.infer<typeof ZRoutingCandidate>;

export const ZRoutingPolicyDecision = z.object({
  selectedIdentityId: z.string().min(1),
  selectedVersion: z.string().min(1),
  strategy: z.enum(["explicit", "policy", "capability_fallback", "static_fallback"]),
  experimentApplied: z.boolean().optional(),
  experimentBucket: z.number().min(0).max(1).optional(),
  matchedRuleId: z.string().optional(),
  candidates: z.array(ZRoutingCandidate).default([]),
  rationale: z.string().min(1),
  decidedAt: z.string().datetime(),
});

export type IRoutingPolicyDecision = z.infer<typeof ZRoutingPolicyDecision>;
