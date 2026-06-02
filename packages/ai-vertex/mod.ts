/**
 * @module AIVertexPackage
 * @path packages/ai-vertex/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer AI
 * @description Package entrypoint for @exaix/ai-vertex (Google Vertex AI provider + service-account auth).
 */

export * from "./src/constants.ts";
export * from "./src/auth/encoding.ts";
export * from "./src/auth/service_account.ts";
export * from "./src/auth/google_auth.ts";
export * from "./src/vertex_provider.ts";
export * from "./src/vertex_factory.ts";
