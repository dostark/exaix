# Phase 80: Enterprise LLM Provider Support (Vertex AI + OpenRouter)

> [!NOTE]
> **Status: Planning**
> This phase extends Exaix's LLM provider ecosystem with enterprise-grade authentication and aggregation services, prioritizing Google Vertex AI for quota/billing management and OpenRouter for multi-model access.
>
> **Business Context:** Free-tier Google AI API hits rate limits despite user having Google AI Pro subscription. Root cause: Simple API key auth doesn't access enterprise quotas.

## Executive Summary

Following Phase 26's provider flexibility improvements and Phase 28's environment variable validation, Exaix needs enterprise authentication mechanisms to unlock premium tier quotas and leverage LLM aggregation platforms.

### **Problem Statement**

**Current Limitation:**

- Users with paid Google AI Pro subscriptions hit free-tier quotas
- Simple `GOOGLE_API_KEY` authentication bypasses Vertex AI enterprise benefits
- No access to Google Cloud project-based billing and regional endpoints

**Impact:**

- Wasted subscription costs (paying for capacity that can't be accessed)
- Poor user experience (rate limit errors despite having paid tier)
- Missed features (regional data residency, advanced quotas, cost tracking)

### **Proposed Solution**

Implement two enterprise provider types:

1. **Google Vertex AI (Priority 1)** - Service account authentication for GCP projects
1. **OpenRouter (Priority 2)** - Unified API gateway to 100+ models
1. **Secure Execution (Priority 3)** - Enterprise-grade sandboxing and containerization for untrusted code
1. **Multi-language Symbol Extraction (Priority 4)** - Tree-sitter WASM for non-TS portals (Python, Rust, Go, Ruby, etc.), extending Phase 46 portal knowledge to polyglot codebases (Team/Enterprise edition)

**Key Decisions:**

- Backward compatible: existing `GOOGLE_API_KEY` continues to work
- Secure credential storage: Service account JSON via environment variable
- 🟢 **Solo Edition feature** - Available to all users immediately
- 🟣 **Future**: AWS Bedrock, Azure OpenAI reserved for Enterprise edition

---

## Goals

- [ ] Support Google Vertex AI with service account authentication
- [ ] Maintain backward compatibility with simple `GOOGLE_API_KEY`
- [ ] Add OpenRouter unified API gateway support
- [ ] Implement Secure Execution abstraction (Sandbox/Container drivers)
- [ ] Add support for Deno Sandbox (MicroVMs) for hypervisor-level isolation
- [ ] Implement Docker driver for multi-tenant tool execution
- [ ] Implement tree-sitter WASM symbol extraction driver for multi-language portal analysis (Team/Enterprise edition)
- [ ] Implement Zod validation for enterprise credentials
- [ ] Zero breaking changes to existing provider abstraction
- [ ] Complete documentation (Technical Spec, User Guide, `.copilot/`)
- [ ] Integration tests with real Vertex AI endpoints (manual verification)

---

## Current State Analysis

### Existing Provider Architecture (Post-Phase 26)

**Strengths:**

- ✅ Provider-agnostic `IModelProvider` interface
- ✅ `ProviderRegistry` with metadata (cost tier, capabilities)
- ✅ `ProviderFactory` with fallback chain support
- ✅ Zod-validated configuration schema
- ✅ Health checks and circuit breakers
- ✅ Cost tracking infrastructure

**Current Google Provider:**

```typescript
// src/ai/providers/google_provider.ts
export class GoogleProvider implements IModelProvider {
  constructor(apiKey: string, model: string, ...) {
    this.apiKey = apiKey; // Simple API key only
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }
}
```

**Limitations:**

- Only supports simple `GOOGLE_API_KEY` authentication
- No service account / OAuth2 flows
- No project-based quota access
- No regional endpoint support

---

## Comparative Analysis: Vertex AI vs Google AI API

| Feature            | Google AI API (Current)             | Vertex AI (Target)                         |
| ------------------ | ----------------------------------- | ------------------------------------------ |
| **Authentication** | Simple API key                      | Service account JSON + OAuth2              |
| **Quota**          | Free tier (very limited)            | Project-based (tied to billing)            |
| **Billing**        | Per-key (limited tracking)          | Per-project (GCP billing integration)      |
| **Endpoint**       | `generativelanguage.googleapis.com` | `{region}-aiplatform.googleapis.com`       |
| **Data Residency** | Global                              | Regional (us-central1, europe-west4, etc.) |
| **Cost Tracking**  | Manual estimation                   | GCP Cloud Billing APIs                     |
| **Models**         | Gemini only                         | Gemini + vertex-exclusive models           |
| **Availability**   | 🟢 Free tier                        | 🔵 Requires GCP project + billing          |

---

## Implementation Guidelines

### No Magic Numbers or Strings Policy

Following Phase 27's magic value externalization standards, **ALL** hardcoded values in Phase 29 implementation **MUST** be externalized to constants or configuration files.

**Prohibited:**

```typescript
// ❌ BAD: Magic numbers and strings
const tokenExpiry = now + 3600; // What is 3600?
await fetch("https://oauth2.googleapis.com/token"); // Hardcoded URL
if (response.status === 401) { // Magic status code
  throw new Error("auth failed"); // Magic error message
}
const timeout = 60000; // Magic timeout
```

**Required:**

```typescript
// ✅ GOOD: Externalized constants
import * as DEFAULTS from "../config/constants.ts";

const tokenExpiry = now + DEFAULTS.OAUTH_TOKEN_TTL_SECONDS;
await fetch(DEFAULTS.GOOGLE_OAUTH_TOKEN_ENDPOINT);
if (response.status === HTTP_STATUS.UNAUTHORIZED) {
  throw new Error(ERROR_MSG.AUTH_FAILED);
}
const timeout = DEFAULTS.VERTEX_AI_TIMEOUT_MS;
```

**Constants File Updates Required:**

Add to `src/config/constants.ts`:

```typescript
// OAuth2 Authentication
export const OAUTH_TOKEN_TTL_SECONDS = 3600; // 1 hour standard OAuth2 expiry
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

// Vertex AI Endpoints
export const VERTEX_AI_DEFAULT_REGION = "us-central1";
export const VERTEX_AI_ENDPOINT_PATTERN = "https://{region}-aiplatform.googleapis.com/v1";
export const VERTEX_AI_TIMEOUT_MS = 30000; // 30 seconds for Vertex AI requests
export const VERTEX_AI_RATE_LIMIT_RPM = 60; // 60 requests per minute

// OpenRouter
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_TIMEOUT_MS = 60000; // 60 seconds for OpenRouter
export const OPENROUTER_RATE_LIMIT_RPM = 200; // 200 requests per minute
export const OPENROUTER_DEFAULT_SITE_NAME = "Exaix";
export const OPENROUTER_DEFAULT_SITE_URL = "https://exaix.dev";

// HTTP Status Codes (if not already defined)
export const HTTP_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error Messages
export const ERROR_MSG = {
  AUTH_FAILED: "Authentication failed",
  INVALID_SERVICE_ACCOUNT: "Invalid service account JSON",
  MISSING_API_KEY: "API key required",
  VERTEX_AI_REQUEST_FAILED: "Vertex AI request failed",
  OPENROUTER_REQUEST_FAILED: "OpenRouter request failed",
  TOKEN_REFRESH_FAILED: "Failed to refresh OAuth2 token",
} as const;

// JWT Algorithm
export const JWT_ALGORITHM = "RS256" as const;
export const JWT_TYPE = "JWT" as const;
```

**Validation Checklist:**

Before submitting PR, verify:

- [ ] No numeric literals except 0, 1, -1 in production code
- [ ] No string literals for URLs, error messages, or status codes
- [ ] All timeouts reference constants
- [ ] All endpoints reference constants
- [ ] All error messages reference constants
- [ ] Rate limits defined in constants
- [ ] HTTP status codes use named constants

**Grep Commands to Detect Magic Values:**

```bash
# Detect potential magic numbers (excluding 0, 1, -1)
grep -rEn --include='*.ts' '([^a-zA-Z_]|^)([2-9][0-9]*|[1-9][0-9]{2,})' src/ai/

# Detect hardcoded URLs
grep -rEn --include='*.ts' '"https?://' src/ai/

# Detect magic error messages
grep -rEn --include='*.ts' 'throw new Error\("' src/ai/
```

**Reference:** See [Phase 27 Planning](./phase-27-magic-number-and-word-externaliztion.md) for detailed examples and rationale.

---

## Implementation Plan

### Phase 1: Vertex AI Authentication Infrastructure

**Goal:** Implement service account authentication for Google Vertex AI

**Files to Create:**

- `src/ai/providers/vertex_ai_provider.ts` (NEW)
- `src/ai/auth/google_auth.ts` (NEW)
- `src/config/vertex_config.ts` (NEW)

**Files to Modify:**

- `src/ai/provider_registry.ts` (register Vertex AI)
- `src/ai/provider_factory.ts` (add Vertex AI creation logic)
- `src/config/schema.ts` (add Vertex AI config schema)
- `templates/exa.config.sample.toml` (add Vertex AI examples)

#### Step 1.1: Google Auth Helper

**Create `src/ai/auth/google_auth.ts`:**

```typescript
import { z } from "zod";

/**
 * Google Cloud service account key schema
 * Users provide this as JSON file content via env var
 */
export const ServiceAccountKeySchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string(),
  private_key_id: z.string(),
  private_key: z.string(),
  client_email: z.string().email(),
  client_id: z.string(),
  auth_uri: z.string().url(),
  token_uri: z.string().url(),
  auth_provider_x509_cert_url: z.string().url(),
  client_x509_cert_url: z.string().url(),
});

export type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

/**
 * OAuth2 access token response
 */
interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}

/**
 * GoogleAuth handles service account authentication for Vertex AI
 */
export class GoogleAuth {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private serviceAccountKey: ServiceAccountKey) {}

  /**
   * Get valid access token, refreshing if needed
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    await this.refreshAccessToken();
    return this.accessToken!;
  }

  /**
   * Exchange service account key for OAuth2 access token
   * Uses JWT bearer token flow
   */
  private async refreshAccessToken(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    // Create JWT assertion
    const jwtHeader = {
      alg: "RS256",
      typ: "JWT",
    };

    const jwtClaim = {
      iss: this.serviceAccountKey.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: this.serviceAccountKey.token_uri,
      exp: expiry,
      iat: now,
    };

    // Sign JWT with private key
    const jwt = await this.signJWT(jwtHeader, jwtClaim);

    // Exchange JWT for access token
    const response = await fetch(this.serviceAccountKey.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Auth failed: ${response.statusText}`);
    }

    const data: AccessTokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  }

  /**
   * Sign JWT using RS256 (RSA SHA-256)
   * Uses Web Crypto API available in Deno
   */
  private async signJWT(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const encoder = new TextEncoder();

    // Base64url encode header and payload
    const headerB64 = this.base64urlEncode(JSON.stringify(header));
    const payloadB64 = this.base64urlEncode(JSON.stringify(payload));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    // Import private key
    const privateKeyPem = this.serviceAccountKey.private_key;
    const privateKey = await this.importPrivateKey(privateKeyPem);

    // Sign
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      privateKey,
      encoder.encode(unsignedToken),
    );

    const signatureB64 = this.base64urlEncode(
      new Uint8Array(signature),
    );

    return `${unsignedToken}.${signatureB64}`;
  }

  private async importPrivateKey(pem: string): Promise<CryptoKey> {
    // Remove PEM headers/footers and decode base64
    const pemContents = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  private base64urlEncode(data: string | Uint8Array): string {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

    const base64 = btoa(String.fromCharCode(...bytes));
    return base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
}

/**
 * Parse service account JSON from environment variable
 */
export function getServiceAccountFromEnv(envVar: string): ServiceAccountKey | null {
  const json = Deno.env.get(envVar);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);
    const result = ServiceAccountKeySchema.safeParse(parsed);

    if (!result.success) {
      console.warn(`Invalid service account JSON in ${envVar}:`, result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.warn(`Failed to parse service account JSON from ${envVar}:`, error);
    return null;
  }
}
```

**Success Criteria:**

- [ ] `ServiceAccountKeySchema` validates Google service account JSON structure
- [ ] `GoogleAuth.getAccessToken()` successfully authenticates and returns valid OAuth2 tokens
- [ ] Token refresh works automatically when tokens expire
- [ ] JWT signing uses Deno's Web Crypto API (no external dependencies)
- [ ] `getServiceAccountFromEnv()` safely parses and validates service account JSON
- [ ] Authentication failures provide clear error messages

#### Step 1.2: Vertex AI Provider

**Create `src/ai/providers/vertex_ai_provider.ts`:**

```typescript
import type { IModelProvider, ModelResponse } from "../types.ts";
import { GoogleAuth, type ServiceAccountKey } from "../auth/google_auth.ts";
import { RateLimiter } from "../../utils/rate_limiter.ts";

export interface VertexAIOptions {
  serviceAccount: ServiceAccountKey;
  model: string;
  region?: string; // e.g., "us-central1", "europe-west4"
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Vertex AI provider using service account authentication
 * Supports Google Cloud project-based quotas and billing
 */
export class VertexAIProvider implements IModelProvider {
  readonly name = "vertex-ai";
  private auth: GoogleAuth;
  private rateLimiter: RateLimiter;
  private baseUrl: string;

  constructor(private options: VertexAIOptions) {
    this.auth = new GoogleAuth(options.serviceAccount);
    this.rateLimiter = new RateLimiter({ requestsPerMinute: 60 });

    const region = options.region || "us-central1";
    const projectId = options.serviceAccount.project_id;
    this.baseUrl =
      `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${options.model}:generateContent`;
  }

  async generateResponse(prompt: string): Promise<ModelResponse> {
    await this.rateLimiter.wait();

    const accessToken = await this.auth.getAccessToken();

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: this.options.temperature ?? 0.7,
          maxOutputTokens: this.options.maxTokens ?? 2048,
        },
      }),
      signal: AbortSignal.timeout(this.options.timeout ?? 30000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vertex AI request failed: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // Parse Vertex AI response format
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error("No content in Vertex AI response");
    }

    return {
      content: textContent,
      model: this.options.model,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async *streamResponse(prompt: string): AsyncGenerator<string> {
    await this.rateLimiter.wait();

    const accessToken = await this.auth.getAccessToken();

    const response = await fetch(`${this.baseUrl}:streamGenerateContent`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }],
        }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Vertex AI stream failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

**Success Criteria:**

- [ ] `VertexAIProvider` implements `IModelProvider` interface
- [ ] Authenticates via `GoogleAuth` service account flow
- [ ] Constructs correct Vertex AI API endpoint with region and project ID
- [ ] Sends requests in Vertex AI's request format (contents, generationConfig)
- [ ] Parses Vertex AI response format correctly
- [ ] Handles authentication errors with clear messages
- [ ] Streaming support works for large responses
- [ ] Regional endpoints configurable (us-central1, europe-west4, etc.)

#### Step 1.3: Configuration Schema

**Update `src/config/schema.ts`:**

```typescript
// Add to ProviderConfigSchema
const VertexAIConfigSchema = z.object({
  service_account_env: z.string().default("VERTEX_AI_SERVICE_ACCOUNT"),
  region: z.string().default("us-central1"),
  model: z.string().default("gemini-2.5-flash"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().min(1).max(8192).optional(),
  timeout_ms: z.number().min(1000).max(300000).optional(),
});

// Add to ModelConfigSchema
const ModelConfigSchema = z.object({
  provider: z.enum(["mock", "ollama", "anthropic", "openai", "google", "vertex-ai", "openrouter"]),
  model: z.string(),
  // ... existing fields
});
```

**Environment Variable:**

```bash
# User providesservice account JSON as single-line env var
export VERTEX_AI_SERVICE_ACCOUNT='{"type":"service_account","project_id":"my-project",...}'
```

**exa.config.toml:**

```toml
[models.vertex]
provider = "vertex-ai"
region = "us-central1"  # or "europe-west4", "asia-southeast1"
model = "gemini-2.5-flash"
service_account_env = "VERTEX_AI_SERVICE_ACCOUNT"  # env var name
temperature = 0.7
max_tokens = 2048
```

**Success Criteria:**

- [ ] `VertexAIConfigSchema` validates all Vertex AI configuration options
- [ ] Service account JSON loaded from configurable environment variable
- [ ] Regional endpoint configuration works correctly
- [ ] Backward compatibility: existing Google provider configs unaffected
- [ ] Validation errors provide clear guidance on fixing config issues

#### Step 1.4: Gemini Model Selection Strategy

**Recommended Models (2025-2026):**

Based on [`docs/dev/json/google_models_2026012.json`](../../docs/dev/json/google_models_2026012.json) analysis:

| Tier               | Model                               | Input Limit | Output Limit | Use Case                      | Special Features            |
| ------------------ | ----------------------------------- | ----------- | ------------ | ----------------------------- | --------------------------- |
| **Default (Fast)** | `gemini-2.5-flash`                  | 1M tokens   | 65K tokens   | General use, recommended      | Thinking mode, batch, cache |
| **Ultra Fast**     | `gemini-2.5-flash-lite`             | 1M tokens   | 65K tokens   | High-volume, cost-sensitive   | Lighter, cheaper            |
| **Premium**        | `gemini-2.5-pro`                    | 1M tokens   | 65K tokens   | Complex reasoning             | Best quality, thinking mode |
| **Deep Research**  | `deep-research-pro-preview-12-2025` | 131K tokens | 65K tokens   | Advanced reasoning tasks      | Extended thinking           |
| **Future-Proof**   | `gemini-flash-latest`               | 1M tokens   | 65K tokens   | Auto-updates to latest stable | Always current              |
| **Cutting Edge**   | `gemini-3-flash-preview`            | 1M tokens   | 65K tokens   | Experimental features         | Preview access              |

**Model Selection Logic:**

Add to `src/config/constants.ts`:

```typescript
// Gemini Model Recommendations (2025-2026)
export const GEMINI_MODELS = {
  // Stable releases (recommended)
  FLASH_2_5: "gemini-2.5-flash", // Default choice
  FLASH_LITE_2_5: "gemini-2.5-flash-lite", // Ultra-cheap
  PRO_2_5: "gemini-2.5-pro", // Premium quality

  // Auto-updating aliases
  FLASH_LATEST: "gemini-flash-latest", // Tracks latest Flash
  PRO_LATEST: "gemini-pro-latest", // Tracks latest Pro

  // Preview/Experimental
  FLASH_3_PREVIEW: "gemini-3-flash-preview", // Gemini 3 preview
  PRO_3_PREVIEW: "gemini-3-pro-preview", // Gemini 3 Pro preview

  // Specialized
  DEEP_RESEARCH: "deep-research-pro-preview-12-2025", // Research tasks
  COMPUTER_USE: "gemini-2.5-computer-use-preview-10-2025", // Agentic tasks
} as const;

export const DEFAULT_VERTEX_AI_MODEL = GEMINI_MODELS.FLASH_2_5;
```

**Configuration Examples:**

```toml
# Recommended: Stable 2.5 Flash
[models.vertex-default]
provider = "vertex-ai"
model = "gemini-2.5-flash"     # Stable, fast, 1M context
region = "us-central1"
service_account_env = "VERTEX_AI_SERVICE_ACCOUNT"

# Cost-optimized: Flash Lite
[models.vertex-cheap]
provider = "vertex-ai"
model = "gemini-2.5-flash-lite"   # Even cheaper than Flash
region = "us-central1"

# Premium quality
[models.vertex-premium]
provider = "vertex-ai"
model = "gemini-2.5-pro"       # Best reasoning
region = "us-central1"

# Future-proof (auto-updates)
[models.vertex-auto]
provider = "vertex-ai"
model = "gemini-flash-latest"  # Always uses latest stable Flash
region = "us-central1"

# Deep research tasks
[models.vertex-research]
provider = "vertex-ai"
model = "deep-research-pro-preview-12-2025"
region = "us-central1"
```

**"Thinking" Mode Support:**

Models with `"thinking": true` in JSON support extended reasoning:

- ✅ `gemini-2.5-flash`
- ✅ `gemini-2.5-pro`
- ✅ `deep-research-*`
- ✅ `gemini-3-*-preview`

**Implementation Note:**

```typescript
// In VertexAIProvider constructor
if (modelSupportsThinking(options.model)) {
  // Enable extended reasoning mode
  this.thinkingEnabled = options.enableThinking ?? true;
}
```

**Success Criteria:**

- [ ] Model constants defined in `src/config/constants.ts`
- [ ] Configuration examples use 2.5+ models
- [ ] Thinking mode flag supported for capable models
- [ ] Future-proof aliases (`*-latest`) documented
- [ ] Model selection guidance in User Guide

---

### Phase 2: OpenRouter Integration

**Goal:** Add unified API gateway support for 100+ models

**Files to Create:**

- `src/ai/providers/openrouter_provider.ts` (NEW)

**Files to Modify:**

- `src/ai/provider_registry.ts` (register OpenRouter)
- `src/ai/provider_factory.ts` (add OpenRouter creation logic)
- `src/config/schema.ts` (add OpenRouter config schema)

#### Step 2.1: OpenRouter Provider

**Create `src/ai/providers/openrouter_provider.ts`:**

```typescript
import type { IModelProvider, ModelResponse } from "../types.ts";
import { RateLimiter } from "../../utils/rate_limiter.ts";

export interface OpenRouterOptions {
  apiKey: string;
  model: string; // e.g., "anthropic/claude-3-opus", "openai/gpt-4"
  baseUrl?: string; // default: "https://openrouter.ai/api/v1"
  siteName?: string; // for OpenRouter rankings/analytics
  siteUrl?: string;
  timeout?: number;
}

/**
 * OpenRouter provider - unified API gateway to 100+ models
 * Uses simple API key authentication
 */
export class OpenRouterProvider implements IModelProvider {
  readonly name = "openrouter";
  private rateLimiter: RateLimiter;
  private baseUrl: string;

  constructor(private options: OpenRouterOptions) {
    this.rateLimiter = new RateLimiter({ requestsPerMinute: 200 });
    this.baseUrl = options.baseUrl || "https://openrouter.ai/api/v1";
  }

  async generateResponse(prompt: string): Promise<ModelResponse> {
    await this.rateLimiter.wait();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.options.siteUrl || "https://exaix.dev",
        "X-Title": this.options.siteName || "Exaix",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(this.options.timeout ?? 60000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter request failed: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      model: this.options.model,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *streamResponse(prompt: string): AsyncGenerator<string> {
    await this.rateLimiter.wait();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.options.siteUrl || "https://exaix.dev",
        "X-Title": this.options.siteName || "Exaix",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter stream failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            if (line.includes("[DONE]")) continue;

            const data = JSON.parse(line.slice(6));
            const delta = data.choices[0].delta.content;
            if (delta) yield delta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

**Configuration:**

```toml
[models.openrouter]
provider = "openrouter"
model = "anthropic/claude-3-opus"  # or "openai/gpt-4", "google/gemini-pro"
api_key_env = "OPENROUTER_API_KEY"
site_name = "Exaix"
site_url = "https://exaix.dev"
```

**Success Criteria:**

- [ ] `OpenRouterProvider` implements `IModelProvider` interface
- [ ] Supports OpenRouter's unified API format (OpenAI-compatible)
- [ ] Model names use OpenRouter format (`provider/model`)
- [ ] HTTP-Referer and X-Title headers set for analytics
- [ ] API key authentication works correctly
- [ ] Streaming support functional
- [ ] Error handling provides clear messages

---

### Phase 3: Provider Factory Integration

**Goal:** Register new providers and add creation logic

**Update `src/ai/provider_factory.ts`:**

```typescript
import { VertexAIProvider } from "./providers/vertex_ai_provider.ts";
import { OpenRouterProvider } from "./providers/openrouter_provider.ts";
import { getServiceAccountFromEnv } from "./auth/google_auth.ts";

class ProviderFactory {
  static async create(config: Config): Promise<IModelProvider> {
    const options = this.resolveOptions(config);

    switch (options.provider) {
      case "vertex-ai":
        return this.createVertexAI(config, options);

      case "openrouter":
        return this.createOpenRouter(config, options);

        // ... existing cases
    }
  }

  private static createVertexAI(config: Config, options: ProviderOptions): VertexAIProvider {
    const vertexConfig = config.models?.[options.modelName]?.vertex_ai;
    const envVar = vertexConfig?.service_account_env || "VERTEX_AI_SERVICE_ACCOUNT";

    const serviceAccount = getServiceAccountFromEnv(envVar);
    if (!serviceAccount) {
      throw new Error(
        `Vertex AI requires service account JSON in ${envVar} environment variable.\\n` +
          `See docs/Exaix_User_Guide.md#vertex-ai-setup for instructions.`,
      );
    }

    return new VertexAIProvider({
      serviceAccount,
      model: options.model,
      region: vertexConfig?.region,
      temperature: vertexConfig?.temperature,
      maxTokens: vertexConfig?.max_tokens,
      timeout: vertexConfig?.timeout_ms || options.timeout,
    });
  }

  private static createOpenRouter(config: Config, options: ProviderOptions): OpenRouterProvider {
    const apiKey = this.getEnvOrFail("OPENROUTER_API_KEY", "OpenRouter");

    const orConfig = config.models?.[options.modelName]?.openrouter;

    return new OpenRouterProvider({
      apiKey,
      model: options.model,
      baseUrl: orConfig?.base_url,
      siteName: orConfig?.site_name,
      siteUrl: orConfig?.site_url,
      timeout: orConfig?.timeout_ms || options.timeout,
    });
  }
}
```

**Success Criteria:**

- [ ] `ProviderFactory.create()` supports "vertex-ai" and "openrouter" providers
- [ ] Vertex AI creation validates service account JSON before instantiation
- [ ] OpenRouter creation validates API key presence
- [ ] Error messages guide users to documentation for setup
- [ ] Backward compatibility maintained for existing providers

---

### Phase 4: Provider Registry Metadata

**Goal:** Register providers with appropriate metadata

**Update `src/ai/provider_registry.ts`:**

```typescript
// Register Vertex AI
ProviderRegistry.register(new VertexAIProvider(/* placeholder */), {
  name: "vertex-ai",
  description: "Google Vertex AI (Enterprise)",
  capabilities: ["chat", "streaming", "vision", "long-context"],
  costTier: "PAID",
  pricingTier: "medium",
  strengths: ["enterprise-quotas", "regional-endpoints", "gcp-billing"],
});

// Register OpenRouter
ProviderRegistry.register(new OpenRouterProvider(/* placeholder */), {
  name: "openrouter",
  description: "OpenRouter Unified API Gateway",
  capabilities: ["chat", "streaming", "multi-model"],
  costTier: "PAID",
  pricingTier: "variable", // depends on selected model
  strengths: ["model-variety", "auto-fallback", "unified-billing"],
});
```

**Success Criteria:**

- [ ] Vertex AI registered with "PAID" cost tier and "enterprise-quotas" strength
- [ ] OpenRouter registered with "multi-model" capability
- [ ] Metadata enables intelligent provider selection via existing Phase 26 logic
- [ ] Documentation reflects new provider options

---

### Phase 5: Testing Strategy

#### Step 5.1: Unit Tests

**Files to Create:**

- `tests/ai/auth/google_auth_test.ts`
- `tests/ai/providers/vertex_ai_provider_test.ts`
- `tests/ai/providers/openrouter_provider_test.ts`

**Test Coverage:**

1. **GoogleAuth:**
   - [ ] Service account JSON validation
   - [ ] JWT signing produces valid tokens
   - [ ] Token refresh logic works
   - [ ] Expired tokens trigger refresh
   - [ ] Invalid service account JSON rejected

1. **VertexAIProvider:**
   - [ ] Constructs correct Vertex AI endpoint
   - [ ] Sends properly formatted requests
   - [ ] Parses Vertex AI responses
   - [ ] Handles authentication errors
   - [ ] Regional endpoints configurable

1. **OpenRouterProvider:**
   - [ ] Constructs correct OpenRouter endpoint
   - [ ] Sets required headers (HTTP-Referer, X-Title)
   - [ ] Parses OpenRouter responses
   - [ ] Handles API key errors
   - [ ] Streaming works correctly

**Success Criteria:**

- [ ] All unit tests pass
- [ ] Code coverage \u003e 90% for new modules
- [ ] Edge cases covered (auth failures, malformed responses, timeouts)

#### Step 5.2: Integration Tests (Manual)

**Rationale:** Real Vertex AI / OpenRouter tests require paid API access and credentials. Manual verification recommended.

**Manual Test Scenarios:**

1. **Vertex AI Setup:**

   ```bash
   # 1. Create GCP project and enable Vertex AI API
   # 2. Create service account with Vertex AI User role
   # 3. Download service account JSON
   export VERTEX_AI_SERVICE_ACCOUNT='...json...'

   # 4. Test with exactl
   exactl request "Hello, Vertex AI!" --model vertex
   ```

1. **OpenRouter Setup:**

   ```bash
   export OPENROUTER_API_KEY="sk-or-..."

   exactl request "Test OpenRouter" --model openrouter
   ```

**Success Criteria:**

- [ ] Vertex AI authenticates successfully with service account
- [ ] Vertex AI requests return valid responses
- [ ] OpenRouter requests work with unified API
- [ ] Cost tracking reflects Vertex AI / OpenRouter usage
- [ ] Error messages guide users through setup issues

---

### Phase 6: Documentation

#### Step 6.1: Technical Specification

**Update `docs/dev/Exaix_Technical_Spec.md`:**

Add section 2.0.1.5: **Enterprise Providers**

````markdown
#### Enterprise Providers 🟢 Solo Edition

| Provider       | Endpoint                             | Authentication       | Use Case                                 |
| -------------- | ------------------------------------ | -------------------- | ---------------------------------------- |
| **Vertex AI**  | `{region}-aiplatform.googleapis.com` | Service account JSON | GCP projects, enterprise quotas, billing |
| **OpenRouter** | `openrouter.ai/api/v1`               | API key              | Unified access to 100+ models            |

**Vertex AI Setup:**

Vertex AI requires a Google Cloud project with billing enabled and a service account with the "Vertex AI User" role.

1. **Create GCP Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create new project or select existing
   - Enable Vertex AI API
   - Enable billing

2. **Create Service Account:**
   ```bash
   gcloud iam service-accounts create exaix-vertex \\
     --description="Exaix Vertex AI access" \\
     --display-name="Exaix Vertex AI"

   gcloud projects add-iam-policy-binding PROJECT_ID \\
     --member="serviceAccount:exaix-vertex@PROJECT_ID.iam.gserviceaccount.com" \\
     --role="roles/aiplatform.user"

   gcloud iam service-accounts keys create ~/exaix-vertex-key.json \\
     --iam-account=exaix-vertex@PROJECT_ID.iam.gserviceaccount.com
   ```
````

1. **Configure Exaix:**

   ```bash
   export VERTEX_AI_SERVICE_ACCOUNT=$(cat ~/exaix-vertex-key.json)
   ```

   ```toml
   # exa.config.toml
   [models.vertex]
   provider = "vertex-ai"
   region = "us-central1"
   model = "gemini-2.5-flash"
   service_account_env = "VERTEX_AI_SERVICE_ACCOUNT"
   ```

**OpenRouter Setup:**

1. Get API key from [openrouter.ai](https://openrouter.ai/keys)
1. Export as environment variable:

   ```bash
   export OPENROUTER_API_KEY="sk-or-v1-..."
   ```

1. Configure model:

   ```toml
   [models.openrouter]
   provider = "openrouter"
   model = "anthropic/claude-3-opus"  # or any supported model
   ```

**Success Criteria:**

- [ ] Technical Spec documents Vertex AI setup process
- [ ] OpenRouter configuration examples provided
- [ ] Service account creation instructions clear and complete
- [ ] Environment variable configuration documented

#### Step 6.2: User Guide

**Update `docs/Exaix_User_Guide.md`:**

Add section 2.4.4: **Enterprise Provider Setup**

````markdown
### 2.4.4 Enterprise Providers (Vertex AI, OpenRouter)

Exaix supports enterprise LLM providers for users with paid subscriptions who need:

- Higher rate limits and quotas
- Access to premium models
- Unified billing across providers
- Regional data residency

#### Vertex AI (Google Cloud)

**When to use:**

- You have a Google AI Pro subscription but hit free-tier rate limits
- You need project-based quotas and GCP billing integration
- You require regional endpoints for data residency

**Setup steps:**

1. **Prerequisites:**
   - Google Cloud account with billing enabled
   - GCP project with Vertex AI API enabled
   - Service account with "Vertex AI User" role

2. **Create service account:**
   Follow the [Technical Spec](/docs/dev/Exaix_Technical_Spec.md#vertex-ai-setup) for detailed `gcloud` commands.

3. **Configure Exaix:**
   ```bash
   export VERTEX_AI_SERVICE_ACCOUNT=$(cat ~/path/to/service-account-key.json)
   ```
````

```toml
[models.vertex]
provider = "vertex-ai"
region = "us-central1"  # or europe-west4, asia-southeast1
model = "gemini-2.5-flash"
temperature = 0.7
max_tokens = 2048
```

1. **Test:**

   ```bash
   exactl request "Test Vertex AI" --model vertex
   ```

**Troubleshooting:**

- **"Invalid service account JSON":** Ensure JSON is valid and includes all required fields
- **"Permission denied":** Verify service account has "Vertex AI User" role
- **"Quota exceeded":** Check GCP billing and quota limits in Cloud Console

#### OpenRouter (Unified API Gateway)

**When to use:**

- You want access to 100+ models via single API key
- You need automatic fallback and load balancing
- You want unified billing across multiple providers

**Setup steps:**

1. Get API key from [openrouter.ai/keys](https://openrouter.ai/keys)
1. Configure Exaix:

   ```bash
   export OPENROUTER_API_KEY="sk-or-v1-..."
   ```

   ```toml
   [models.openrouter]
   provider = "openrouter"
   model = "anthropic/claude-3-opus"  # or any model from openrouter.ai/models
   ```

1. Test:

   ```bash
   exactl request "Test OpenRouter" --model openrouter
   ```

**Supported models:** See [openrouter.ai/models](https://openrouter.ai/models) for full list.

**Success Criteria:**

- [ ] User Guide provides clear setup instructions for both providers
- [ ] Prerequisites listed upfront
- [ ] Troubleshooting section addresses common issues
- [ ] Links to external resources (GCP Console, OpenRouter docs)

#### Step 6.3: Agent Documentation

**Update `.copilot/source/exaix.md`:**

Add section on enterprise provider usage patterns.

**Success Criteria:**

- [ ] `.copilot/` documentation explains when to use enterprise providers
- [ ] Code examples show proper configuration patterns
- [ ] Security best practices documented (service account JSON handling)

---

### Phase 7: Secure Enterprise Execution (Sandboxes & Containers)

**Goal:** Provide hypervisor or container-level isolation for agent tool execution in multi-tenant environments.

**Files to Create:**

- `src/services/sandbox/driver.ts` (Interface)
- `src/services/sandbox/deno_sandbox_driver.ts` (Deno Sandbox/MicroVMs)
- `src/services/sandbox/docker_driver.ts` (Docker/OCI)

**Files to Modify:**

- `src/services/tool_registry.ts` (Integrate SandboxDriver)
- `src/config/schema.ts` (Add sandbox selection config)

#### Step 7.1: Sandbox Driver Interface

Define a standard interface for executing tools in isolated environments.

```typescript
export interface SandboxDriver {
  setup(options: SandboxOptions): Promise<void>;
  execute(command: string, args: string[], env: Record<string, string>): Promise<ExecutionResult>;
  cleanup(): Promise<void>;
}
```

#### Step 7.2: Deno Sandbox Integration

Leverage Deno Sandbox MicroVMs for ultra-fast, secure execution.

```typescript
export class DenoSandboxDriver implements SandboxDriver {
  // Implementation using Deno Sandbox SDK
}
```

#### Step 7.3: Docker Driver Integration

Provide a standard Docker driver for on-premise or legacy container support.

```typescript
export class DockerDriver implements SandboxDriver {
  // Implementation using Docker API / CLI
}
```

**Success Criteria:**

- [ ] `SandboxDriver` interface allows transparent switching between drivers
- [ ] Agents can run tools in Deno Sandbox with < 1s startup
- [ ] Resource limits (CPU/MEM) enforced at the hypervisor/container level
- [ ] Network egress restricted via sandbox configuration

---

#### Step 7.4: Tree-sitter WASM Symbol Extraction (Team/Enterprise Edition)

**Goal:** Extend portal knowledge gathering (Phase 46) to **all programming languages** via tree-sitter WASM — enabling the same `symbolMap` quality for Python, Rust, Go, Java, Ruby, C/C++, and other portals that `deno doc --json` cannot serve.

> 🟡 **Team Edition** — available when `[portal_knowledge] tree_sitter_extraction = true`
> 🔵 **Enterprise Edition** — enabled by default; runs automatically in `standard`/`deep` modes

**Files to create:**

- `src/services/portal_knowledge/tree_sitter_extractor.ts` (NEW)
- `src/services/portal_knowledge/wasm/` (directory for grammar WASM blobs)

**Architecture notes:**

- Implements the same `extractSymbols(portalPath, fileList, limit) → Promise<ISymbolEntry[]>` contract as Phase 46 Strategy 6
- Loads grammar WASM files via the `npm:web-tree-sitter` specifier in Deno
- Supported grammars bundled: `tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-go`, `tree-sitter-java`, `tree-sitter-ruby`, `tree-sitter-c`, `tree-sitter-cpp`
- Language auto-detection from `techStack.primaryLanguage` (set by Strategy 1 in Phase 46)
- Dispatch: `typescript`/`javascript` → `deno doc` (Phase 46 Strategy 6); all others → tree-sitter WASM (this step)
- Extracts: function/method definitions, class declarations, public interfaces — no bodies
- PageRank scoring via cross-file symbol reference graph (same algorithm as Phase 46 Strategy 6)
- Grammar WASM files sourced from tree-sitter NPM packages; bundled at build time; checked in under `src/services/portal_knowledge/wasm/`
- Edition gate: reads `[portal_knowledge] tree_sitter_extraction` from `exa.config.toml`; no-op on Solo edition

**Success Criteria:**

- [ ] Python portal produces `symbolMap` with function and class signatures
- [ ] Rust portal produces `symbolMap` with `pub fn` and `pub struct` signatures
- [ ] Go portal produces `symbolMap` with exported function and type signatures
- [ ] Language dispatch routes TS/JS portals to `deno doc`, all others to tree-sitter
- [ ] Falls back to `[]` on unsupported language (does not block analysis)
- [ ] WASM grammar loading works in Deno's sandbox permission model
- [ ] PageRank scoring consistent with Phase 46 Strategy 6 output format
- [ ] Edition gate (`tree_sitter_extraction` config flag) enforced: disabled on Solo (no-op), opt-in on Team, default on Enterprise

**Planned tests** (`tests/services/portal_knowledge/tree_sitter_extractor_test.ts`):

- `[TreeSitterExtractor] extracts Python function and class signatures`
- `[TreeSitterExtractor] extracts Rust pub fn and pub struct signatures`
- `[TreeSitterExtractor] extracts Go exported function signatures`
- `[TreeSitterExtractor] routes TypeScript portal to deno doc strategy`
- `[TreeSitterExtractor] returns empty array for unsupported language`
- `[TreeSitterExtractor] respects DEFAULT_SYMBOL_MAP_LIMIT`
- `[TreeSitterExtractor] edition gate disables extraction on Solo`
- `[TreeSitterExtractor] edition gate enables extraction on Enterprise by default`

### Functional Requirements

- [ ] **FR1: Vertex AI Authentication**
  - [ ] Service account JSON successfully parsed from environment variable
  - [ ] OAuth2 access tokens generated and refreshed automatically
  - [ ] JWT signing works with Web Crypto API (no external dependencies)

- [ ] **FR2: Vertex AI API Integration**
  - [ ] Requests sent to correct regional endpoint
  - [ ] Responses parsed correctly
  - [ ] Streaming support functional
  - [ ] Error handling provides actionable error messages

- [ ] **FR3: OpenRouter Integration**
  - [ ] Supports OpenRouter's unified API format
  - [ ] Model names validated against OpenRouter naming convention
  - [ ] Streaming works correctly
  - [ ] Rate limiting appropriate for OpenRouter quotas

- [ ] **FR4: Backward Compatibility**
  - [ ] Existing `GoogleProvider` (simple API key) continues to work
  - [ ] No breaking changes to existing provider abstraction
  - [ ] Existing configs work without modification

- [ ] **FR5: Configuration Validation**
  - [ ] Zod schemas validate all new configuration options
  - [ ] Invalid service account JSON rejected with clear messages
  - [ ] Missing API keys cause graceful failures with setup guidance

- [ ] **FR6: Multi-language Symbol Extraction (Team/Enterprise)**
  - [ ] Tree-sitter WASM grammars load in Deno sandbox permission model
  - [ ] Python, Rust, Go, Java, Ruby portals produce valid `symbolMap`
  - [ ] Language dispatch routes TS/JS to `deno doc`, all others to tree-sitter
  - [ ] Edition gate enforced: disabled on Solo (no-op), opt-in on Team, default on Enterprise
  - [ ] `symbolMap` output conforms to `ISymbolEntry[]` schema defined in Phase 46

### Non-Functional Requirements

- [ ] **NFR1: Security**
  - [ ] Service account JSON only stored in environment variables (not config files)
  - [ ] Private keys never logged or exposed in error messages
  - [ ] OAuth2 tokens cached securely in memory only

- [ ] **NFR2: Performance**
  - [ ] Token refresh adds < 100ms latency on first request
  - [ ] Subsequent requests use cached tokens (no refresh overhead)
  - [ ] Streaming latency comparable to other providers

- [ ] **NFR3: Code Quality**
  - [ ] **Zero magic numbers or strings** - All values externalized to `src/config/constants.ts`
  - [ ] All URLs, timeouts, rate limits, error messages use named constants
  - [ ] HTTP status codes use `HTTP_STATUS` enum
  - [ ] Code passes magic value detection grep commands

- [ ] **NFR4: Documentation**
  - [ ] Technical Spec includes detailed Vertex AI setup guide
  - [ ] User Guide provides troubleshooting for common issues
  - [ ] `.copilot/` documentation updated for agents

- [ ] **NFR4: Testing**
  - [ ] Unit tests cover \u003e90% of new code
  - [ ] Manual integration tests verify real API functionality
  - [ ] Error scenarios tested comprehensively

---

## Risks and Mitigations

| Risk                                  | Impact   | Likelihood | Mitigation                                            |
| ------------------------------------- | -------- | ---------- | ----------------------------------------------------- |
| **R1:** Vertex AI API changes         | High     | Low        | Pin to specific API version, monitor breaking changes |
| **R2:** Service account JSON exposure | Critical | Medium     | Validate no logging, env-only storage, security docs  |
| **R3:** OpenRouter API instability    | Medium   | Medium     | Implement fallback to direct providers                |
| **R4:** User setup complexity         | Medium   | High       | Detailed docs, setup validation scripts               |
| **R5:** Cost tracking inaccuracy      | Medium   | Low        | Use GCP Billing APIs for Vertex AI (future)           |

---

## Future Enhancements (Out of Scope)

- **🟣 Enterprise Edition:**
  - AWS Bedrock integration
  - Azure OpenAI integration
  - Advanced cost analytics (GCP Billing API integration)
  - Multi-tenant service account management

- **Phase 30+:**
  - Workload Identity Federation (Google Cloud Run, GKE)
  - Automatic quota monitoring and alerts
  - Cost optimization recommendations
  - Regional endpoint auto-selection based on latency

---

## Related Documents

- [Phase 26: LLM Provider Flexibility](./phase-26-llm-provider-flexibility.md) - Provider architecture foundation
- [Phase 28: Environment Variable Cleanup](./phase-28-env-var-cleanup-and-validation.md) - Zod validation patterns
- [Technical Specification](../../docs/dev/Exaix_Technical_Spec.md) - Provider ecosystem overview
- [User Guide](../../docs/Exaix_User_Guide.md) - End-user setup instructions

---

## Implementation Timeline

| Phase       | Tasks                          | Duration      | Dependencies    |
| ----------- | ------------------------------ | ------------- | --------------- |
| **Phase 1** | Vertex AI auth + provider      | 2-3 days      | None            |
| **Phase 2** | OpenRouter integration         | 1 day         | None (parallel) |
| **Phase 3** | Sandbox & Container Drivers    | 2-3 days      | None (parallel) |
| **Phase 4** | Factory + registry integration | 0.5 days      | Phases 1, 2, 3  |
| **Phase 5** | Testing (unit + manual)        | 1-2 days      | Phase 4         |
| **Phase 6** | Documentation                  | 1 day         | Phase 5         |
| **Total**   |                                | **7-10 days** |                 |

**Estimated Effort:** 40-56 hours (senior developer)

---

## Document Status

- **Created:** 2026-01-20
- **Last Updated:** 2026-02-17
- **Status:** Draft (Integrated)
- **Approved By:** Pending review
- **Next Steps:** Review with team, prioritize Vertex AI vs Secure Execution

---

## Notes

- **Security First:** Sandbox execution is critical for multi-tenant and production environments.
- **Deno Stack:** Deno Sandbox offers the best performance profile for AI agent workflows.
- **Enterprise Ready:** This integrated plan positions Exaix as a secure, enterprise-grade agentic framework.
