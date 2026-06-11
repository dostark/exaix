---
id: "550e8400-e29b-41d4-a716-446655440002"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "security-first"
name: "Security-First Development"
version: "2.0.0"
description: "Integrates secure-by-default practices across the full development lifecycle — input validation, injection prevention, path safety, auth, secrets, dependency hygiene, and security testing — applicable to any portal language or framework"

triggers:
  keywords:
    # Auth / identity
    - auth
    - authentication
    - authorization
    - login
    - logout
    - session
    - token
    - jwt
    - oauth
    - saml
    - permission
    - role
    - access
    # Secrets / credentials
    - password
    - secret
    - api-key
    - apikey
    - credential
    - encryption
    - decrypt
    - certificate
    - private-key
    # Data / storage
    - database
    - query
    - sql
    - nosql
    - redis
    - migration
    - sensitive
    - pii
    # File / path / process
    - file
    - path
    - upload
    - download
    - directory
    - subprocess
    - command
    - exec
    - spawn
    # Network / web
    - http
    - api
    - endpoint
    - webhook
    - cors
    - header
    - cookie
    - request
    - url
    # Security actions
    - security
    - vulnerability
    - audit
    - sanitize
    - validate
    - injection
  task_types:
    - feature
    - bugfix
    - security
    - security-review
    - audit
    - authentication
    - implementation
    - refactor
  file_patterns:
    - "**/auth/**"
    - "**/security/**"
    - "**/login/**"
    - "**/session/**"
    - "**/handlers/**"
    - "**/routes/**"
    - "**/api/**"
    - "**/middleware/**"
    - "**/db/**"
    - "**/database/**"
    - "**/models/**"
    - "**/upload/**"
    - "**/*auth*.ts"
    - "**/*security*.ts"
    - "**/*handler*.ts"
    - "**/*route*.ts"
    - "**/*middleware*.ts"
    - "**/*query*.ts"
    - "**/*command*.ts"
    - "**/*exec*.ts"
    - "**/*.env*"
    - "**/Dockerfile*"
    - "**/docker-compose*.yml"
  tags:
    - security
    - authentication
    - authorization
    - injection
    - validation

constraints:
  # Input
  - "Validate all external input (HTTP body, query params, CLI args, env vars, file content) at the entry boundary with a schema validator — never deep in business logic"
  - "Use allowlists over denylists; reject unknown fields"
  # Path / filesystem
  - "Resolve all filesystem paths to their real absolute path before any permission or boundary check; never compare with string startsWith or indexOf alone"
  - "Reject any path that escapes the intended root after resolution"
  # Injection
  - "Use parameterized queries or an ORM for all database operations — never build SQL by string concatenation"
  - "Use argument arrays (never shell strings) for subprocess commands; never pass user input as part of a shell command string"
  - "Never call eval, new Function(), exec(string), or dynamically import a specifier derived from user input"
  - "Escape output for the target context (HTML, JSON, SQL, shell) before rendering"
  # Auth
  - "Fail closed: deny by default; a missing or invalid permission check must block, not allow"
  - "Perform the authorization check AFTER path/resource resolution, not before"
  - "Verify authentication on every request to a protected resource — never rely on route ordering alone"
  # Secrets
  - "Never log, print, include in error messages, or serialize secrets (API keys, passwords, tokens) to disk in readable form"
  - "Load secrets from environment variables or a dedicated secret manager — never hardcode them"
  - "Keep secret values alive in memory for the shortest possible lifetime"
  # Errors / logging
  - "Return generic error messages to callers; log detailed diagnostics server-side only"
  - "Never expose stack traces, internal paths, database schema, or user enumeration hints in responses"
  - "Emit an audit-trail event for every authentication decision, permission denial, and sensitive data access"
  # Dependencies
  - "Pin every dependency to an exact version; do not use @latest or floating ranges in production"
  - "Audit new dependencies for native/FFI code, excessive permissions, or known CVEs before adding them"
  # Transport
  - "Enforce TLS for all network communication; never fall back to plain HTTP for sensitive data"
  - "Set security-relevant HTTP response headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)"

output_requirements:
  - "All user-controlled inputs validated with a schema (Zod, Joi, pydantic, etc.) at the entry point"
  - "No hardcoded secrets, credentials, or API keys anywhere in source or config files"
  - "SQL / NoSQL queries use parameterized form; no string-interpolated identifiers from input"
  - "Subprocess invocations use argument arrays; no shell=true with user-derived strings"
  - "Access-denied error messages are generic; details go to server-side logs only"
  - "At least one security test per control, asserting rejection-by-validation (not rejection-by-runtime-failure)"
  - "All new dependencies pinned to exact versions"

quality_criteria:
  - name: "OWASP 2021 Coverage"
    description: "Code addresses all relevant OWASP Top 10:2021 items for the feature's surface"
    weight: 25
  - name: "Input Validation"
    description: "All external inputs schema-validated at the boundary; allowlist-based"
    weight: 20
  - name: "Injection Prevention"
    description: "SQL, command, template, and expression injection vectors closed"
    weight: 20
  - name: "Path & Filesystem Safety"
    description: "realPath-resolved boundary checks; no string-only traversal guards"
    weight: 10
  - name: "Auth Boundary"
    description: "Every side-effect checks permissions after resolution; fail-closed"
    weight: 10
  - name: "Secret Management"
    description: "Secrets never in source, logs, errors, or plain-text serialization"
    weight: 10
  - name: "Security Tests"
    description: "Controls are verified by tests asserting validation rejection, not runtime error"
    weight: 5

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Security-First Development

Security is a design constraint, not a post-hoc audit. Apply each section below
to every feature that touches input, files, databases, subprocesses, network, or
authentication. The threat model for agent-authored code is **LLM output reaches
an attack sink** — validate and constrain at every boundary.

---

## 0. Threat Modelling (do this first)

Before writing a line of code, answer:

1. **What are the entry points?** (HTTP body, query params, CLI args, file content, env vars, webhook payload, inter-service calls)
1. **What are the sinks?** (database writes, filesystem writes, subprocesses, network calls, rendered output)
1. **What is the blast radius if this path is exploited?** (data exfiltration, remote code execution, privilege escalation, DoS)
1. **Which OWASP 2021 items apply?** (see §8 checklist)

Document the answers in a `<!-- security: -->` comment on the relevant function or
module when the risk is non-obvious.

---

## 1. Input Validation

Validate at the system **boundary** — the first place untrusted data enters your
code. Never re-validate deep in business logic; never skip validation in "internal"
paths that could be reached via an indirect call.

```typescript
// ✅ Validate with a schema at the entry point
import { z } from "zod";
const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(["viewer", "editor"]),   // allowlist, not free string
});
const body = CreateUserSchema.parse(await request.json());

// ❌ Trust the shape of external data
const { email, role } = await request.json();
```

**Rules:**

- Validate data type, length, format, and range.
- Use **allowlists** for enumerations (roles, statuses, column names); reject anything not in the list.
- Strip or reject unknown fields — do not forward them to downstream systems.
- For file uploads: validate MIME type by content inspection, not extension; cap file size; sanitize filenames.
- Re-validate after any transformation that could change the trust level.

---

## 2. Path Traversal & Filesystem Safety

String-only checks (`startsWith`, `includes(".."), replace`) are bypassable via
URL encoding, Unicode normalization, and symlinks. Always resolve to the real
absolute path first, then check containment.

```typescript
// ✅ Resolve symlinks, then verify containment
import { resolve, relative } from "node:path";
import { realpath } from "node:fs/promises";

async function safeRead(root: string, userInput: string): Promise<string> {
  const realRoot = await realpath(resolve(root));
  const target = resolve(realRoot, userInput);
  const realTarget = await realpath(target).catch(() => target); // non-existent → use resolved
  if (!realTarget.startsWith(realRoot + "/") && realTarget !== realRoot) {
    throw new Error("Access denied");  // generic — never echo the paths
  }
  return readFile(realTarget, "utf8");
}

// ❌ String-only check is bypassable
if (userInput.includes("..")) throw new Error("bad path"); // symlinks bypass this
const content = readFileSync(join(root, userInput));
```

**Rules:**

- Resolve symlinks (`realpath`) on **both** the root and the target before comparison.
- Use the resolved path for all subsequent operations — do not re-derive from the original input.
- For non-existent targets, resolve the nearest existing ancestor.
- Error messages must be **generic** — never echo the denied path back to the caller.
- Apply the same check to archive extraction (zip-slip), URL-based path segments, and redirect targets.

---

## 3. Injection Prevention

### 3a. SQL / NoSQL

```typescript
// ✅ Parameterized query
const user = await db.query(
  "SELECT * FROM users WHERE id = $1 AND tenant = $2",
  [userId, tenantId],
);

// ❌ String interpolation — trivially injectable
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

For **identifiers** (column names, table names, ORDER BY targets) — which cannot
be parameterized — allowlist them explicitly:

```typescript
const SORTABLE_COLUMNS = new Set(["created_at", "name", "email"] as const);
if (!SORTABLE_COLUMNS.has(sortBy)) throw new Error("Invalid sort field");
const rows = await db.query(`SELECT * FROM items ORDER BY ${sortBy}`);
// ✅ safe only because sortBy was allowlisted above
```

### 3b. Command injection

```typescript
// ✅ Argument array — the OS never invokes a shell
import { spawn } from "node:child_process";
const proc = spawn("git", ["log", "--oneline", "-n", "10"], { cwd: repoPath });

// ❌ Shell string — user input can inject commands
exec(`git log ${userBranch}`);   // userBranch = "; rm -rf /"
```

**Additional rules:**

- Never pass `shell: true` (Node.js) or equivalent when arguments include user data.
- Allowlist accepted subcommands and flags; reject `--allow-*`, `-c`, `-C`, and code-executing runtimes (`eval`, `exec`) passed as arguments.
- Validate and restrict the working directory to an authorized path.

### 3c. Expression / template injection

```typescript
// ✅ Parse and evaluate in a sandboxed evaluator
import { evaluateExpression } from "./safe_expression.ts"; // allowlisted roots only
const result = evaluateExpression(condition, { results, request });

// ❌ Dynamic code execution
const result = new Function("results", "request", `return ${condition}`)(results, request);
```

- Never use `eval`, `new Function()`, or dynamic `import()` with a user-supplied specifier.
- For template engines: use auto-escaping engines; never pass raw user data into unescaped template slots.

---

## 4. Authentication & Authorization

```typescript
// ✅ Explicit permission check after resource resolution
const resource = await resolveResource(request.params.id, session.tenantId);
if (!session.permissions.includes("resource:write")) {
  throw new ForbiddenError("Insufficient permissions");  // generic, no resource detail
}
await resource.update(body);

// ❌ Security through obscurity or order
// "Only admins know this URL, so we don't check"
```

**Rules:**

- **Fail closed** — deny by default; a missing or misconfigured check must block, not allow.
- Perform the authorization check **after** resource resolution (so the resolved identity is checked, not the raw input).
- Never rely on route ordering, URL obscurity, or client-side state for access control.
- For multi-tenant systems, always scope every query to the authenticated tenant's ID.
- For sensitive mutations (delete, privilege changes), require re-authentication or a confirmation token.
- Session tokens: use `HttpOnly; Secure; SameSite=Strict` cookies or short-lived signed JWTs; invalidate on logout.

---

## 5. Secret Management

```typescript
// ✅ Load from environment; never log
const apiKey = process.env.PAYMENTS_API_KEY;
if (!apiKey) throw new Error("PAYMENTS_API_KEY is not configured");
// Use apiKey — do not log it, do not include in error messages

// ❌ Hardcoded
const apiKey = "sk-prod-1234abcd";

// ❌ Logged by accident
logger.info(`Calling payments API with key=${apiKey}`);
```

**Rules:**

- Load secrets from environment variables or a secret manager (Vault, AWS Secrets Manager, etc.) — never from source code, config files committed to VCS, or CLI arguments (process lists are world-readable).
- Minimize the lifetime of a secret value in memory; clear it after use where the language allows.
- Rotate secrets on a schedule and on any suspected exposure.
- Never include secrets in error messages, log lines, HTTP responses, or serialized state.
- Use `.gitignore` + pre-commit hooks to prevent accidental `.env` commits; add secret-scanning to CI.

---

## 6. Secure Data Handling

```typescript
// ✅ Key derivation for passwords (Argon2id preferred; bcrypt acceptable)
import { hash, verify } from "@node-rs/argon2";
const stored = await hash(plainPassword);           // store this
const ok = await verify(stored, candidatePassword); // verify this

// ❌ Reversible or weak
const stored = Buffer.from(password).toString("base64");  // trivially reversible
const stored = createHash("md5").update(password).digest("hex");  // rainbow-table vulnerable
```

**Rules:**

- Passwords: use a memory-hard KDF (Argon2id > bcrypt > scrypt). Never SHA-1/MD5/plain.
- Data at rest: AES-256-GCM for symmetric encryption; store IV alongside ciphertext, never reuse IVs.
- Data in transit: enforce TLS 1.2+; disable deprecated cipher suites; use HSTS.
- PII minimization: collect only what is necessary; define retention periods; anonymize or delete on schedule.
- For cryptographic randomness use the platform's CSPRNG (`crypto.getRandomValues`, `secrets.token_bytes`, etc.) — never `Math.random()`.

---

## 7. Error Handling & Audit Logging

```typescript
// ✅ Generic external message; detailed internal log; audit event
try {
  const result = await performSensitiveOperation(userId, resourceId);
  auditLog.emit("resource.accessed", { userId, resourceId, outcome: "success" });
  return result;
} catch (err) {
  auditLog.emit("resource.access.failed", { userId, resourceId, reason: err.message });
  logger.error("Sensitive operation failed", { err, userId, resourceId }); // server-side only
  throw new Error("Operation failed");  // generic to caller — no internal detail
}

// ❌ Leaks internal structure
throw new Error(`Query failed: SELECT * FROM users WHERE id='${userId}' — ${err.message}`);
```

**Rules:**

- Log the detail server-side; return a generic message to the caller.
- Never expose stack traces, SQL queries, internal file paths, or user-enumeration hints (e.g. "email not found" vs. "password incorrect" — use the same message for both).
- Emit a structured **audit event** for: authentication decisions, permission denials, sensitive data reads, configuration changes, and unusual volume/rate patterns.
- Never swallow errors silently — uncaught failures may leave the system in an inconsistent state.

---

## 8. Transport & HTTP Security

```typescript
// ✅ Security headers on every response
response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
response.headers.set("Content-Security-Policy", "default-src 'self'");
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("X-Content-Type-Options", "nosniff");
response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
```

**Rules:**

- Validate the `Host` header on local/loopback HTTP endpoints to prevent DNS-rebinding.
- Validate `Origin` on state-changing requests (POST/PUT/DELETE) to prevent CSRF.
- Set `SameSite=Strict` on session cookies or use the `Double Submit Cookie` pattern.
- Enforce a strict CSP; avoid `unsafe-inline` and `unsafe-eval`.
- For external webhooks: verify a shared HMAC-SHA256 signature before processing the payload — fail closed (no signature configured → reject every payload).
- Rate-limit authentication endpoints and sensitive operations.

---

## 9. Dependency Security

**Rules:**

- Pin every dependency to an **exact version** in the lock file; commit the lock file.
- Before adding a new dependency, evaluate: Does it have native/FFI code? What permissions does it need? Does it have a security history?
- Run a vulnerability scanner (`npm audit`, `pip audit`, `deno task audit`, Snyk, etc.) in CI; fail the build on high-severity CVEs.
- Prefer well-maintained packages with a clear security disclosure process.
- Minimize the dependency tree: prefer a built-in or a small focused package over a large framework dependency for security-sensitive operations.
- For native/FFI dependencies: assess whether the build-time or runtime download is verified (checksums, provenance); prefer zero-native-dep alternatives.

---

## 10. Security Testing

A control without a test is as good as no control. Every security boundary needs
a test that verifies **rejection by validation**, not rejection by runtime failure.

```typescript
// ✅ Tests validation fires — not that a file happens to be missing
Deno.test("file handler rejects path traversal attempt", async () => {
  const result = await handler({ path: "../../etc/passwd" });
  assertEquals(result.status, 403);
  assertStringIncludes(result.body, "Access denied"); // validation message, not OS error
});

// ❌ This test is green even if the control never runs
Deno.test("file handler fails on bad path", async () => {
  await assertRejects(() => handler({ path: "../../etc/passwd" })); // any throw passes
});
```

**Required test types per control:**

| Control | Required test |
| ------- | ------------- |
| Input validation | Rejects schema violations (wrong type, over-length, invalid enum value) |
| Path traversal guard | Rejects `../` traversal; rejects symlink escape; allows valid path |
| SQL parameterization | Injection payload stored literally, not executed (check DB state) |
| Command allowlist | Rejects blocked subcommands/flags; allows permitted ones |
| Auth boundary | Unauthenticated request → 401; unauthorized identity → 403; authorized → succeeds |
| HMAC / webhook | No secret configured → reject; bad signature → reject; valid signature → accept |
| Error messages | Denied response body does not contain internal paths or stack traces |

Tag security tests so the dedicated CI job picks them up: use `[security]` in the
test name for test runners that filter by name pattern.

---

## 11. OWASP Top 10:2021 Checklist

Run through this before marking a feature complete:

- [ ] **A01 Broken Access Control** — every resource enforces authorization; fail-closed; no IDOR
- [ ] **A02 Cryptographic Failures** — PII/secrets encrypted at rest and in transit; no MD5/SHA-1 for passwords; no reused IVs
- [ ] **A03 Injection** — parameterized queries; argument arrays for subprocesses; no `eval`/`new Function`; output escaped for context
- [ ] **A04 Insecure Design** — threat model documented; principle of least privilege applied; defense in depth
- [ ] **A05 Security Misconfiguration** — security headers set; debug/verbose modes disabled in production; default credentials changed; unnecessary features disabled
- [ ] **A06 Vulnerable & Outdated Components** — all dependencies pinned; CVE scan in CI; no abandoned packages
- [ ] **A07 Identification & Authentication Failures** — strong password policy (or passkeys/SSO); session invalidated on logout; brute-force protection; MFA for privileged actions
- [ ] **A08 Software & Data Integrity Failures** — dependency lock file committed; CI pipeline integrity validated; deserialized data validated before use; no unsigned auto-update
- [ ] **A09 Security Logging & Monitoring Failures** — audit trail for auth events, permission denials, config changes; anomaly alerting; logs retained per policy
- [ ] **A10 Server-Side Request Forgery (SSRF)** — outbound URLs allowlisted; internal network segments blocked; redirects validated
