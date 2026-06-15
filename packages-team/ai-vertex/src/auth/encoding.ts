/**
 * @module VertexAuthEncoding
 * @path packages/ai-vertex/src/auth/encoding.ts
 * @related-files ["packages/ai-vertex/src/auth/google_auth.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix-team/ai-vertex/src/constants.ts"]
 * @description Overflow-safe base64url encoding used for JWT assertion signing.
 */

import { BASE64_CHUNK_SIZE } from "../constants.ts";

/**
 * Base64url-encode a string or byte array. Encodes in fixed-size chunks so large
 * inputs (e.g. RSA signatures) never overflow the call stack via argument spread.
 */
export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
