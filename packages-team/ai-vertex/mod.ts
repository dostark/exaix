/**
 * @module AIVertexTeamPackage
 * @path packages-team/ai-vertex/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer Team-AI
 * @description Package entrypoint for @exaix-team/ai-vertex (Google Vertex AI provider + service-account auth). Team-only per D-providers.
 */

export * from "./src/constants.ts";
export * from "./src/auth/encoding.ts";
export * from "./src/auth/service_account.ts";
export * from "./src/auth/google_auth.ts";
export * from "./src/vertex_provider.ts";
export * from "./src/vertex_factory.ts";
